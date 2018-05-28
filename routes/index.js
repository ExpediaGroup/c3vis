const config = require('../config/config');
const debug = require('debug')('api');
const express = require('express');
const router = express.Router();
const fs = require('fs');
const moment = require('moment');
const AWS = require('aws-sdk-promise');
const batchPromises = require('batch-promises');
// AWS variable has default credentials from Shared Credentials File or Environment Variables.
//   (see: https://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html)
// Override default credentials with configFile (e.g. './aws_config.json') if it exists
if (fs.existsSync(config.aws.configFile)) {
  console.log(`Updating with settings from '${config.aws.configFile}'...`);
  AWS.config.update(JSON.parse(fs.readFileSync(config.aws.configFile, 'utf8')));
}
console.log(`Targeting AWS region '${AWS.config.region}'`);

const utils = require('./utils');

const FetchStatus = require('./fetchStatus');
const ClusterState = require('./clusterState');
const clusterStateCache = require('../routes/clusterStateCache');
const clusterStateCacheTtl = config.clusterStateCacheTtl;
const taskDefinitionCache = require('memory-cache');
const promiseDelayer = require('./promiseDelayer');
const staticClusterDataProvider = require('./staticClusterDataProvider.js');

const ecs = new AWS.ECS();
const ec2 = new AWS.EC2();

/* Home page */

router.get('/', function (req, res, next) {
  res.render('index', {
    title: 'c3vis - Cloud Container Cluster Visualizer',
    useStaticData: staticDataRequested(req),
    resourceType: req.query.resourceType ? req.query.resourceType : 'memory'
  });
});

function staticDataRequested(req) {
  return req.query.static ? (req.query.static.toLowerCase() === "true") : false;
}

/* API endpoints
 * =============
 * Endpoints take a "?static=true" query param to enable testing with static data when AWS credentials aren't available
 */

router.get('/api/instance_summaries_with_tasks', function (req, res, next) {
  Promise.resolve()
  .then(function() {
    debugLog(`Headers: ${JSON.stringify(req.headers, null, 4)}`);
    if (!req.query.cluster) {
      send400Response("Please provide a 'cluster' parameter", res);
      reject("No 'cluster' parameter provided.");
    } else {
      const clusterName = req.query.cluster;
      const useStaticData = staticDataRequested(req);
      const forceRefresh = req.query.forceRefresh === 'true';
      return getInstanceSummariesWithTasks(res, clusterName, useStaticData, forceRefresh);
    }
  })
  .catch(function (err) {
    const reason = new Error(`Failed getting instance summaries: ${err}`);
    reason.stack += `\nCaused By:\n` + err.stack;
    sendErrorResponse(reason, res);
  });
});

function getInstanceSummariesWithTasks(res, clusterName, useStaticData, forceRefresh) {
  return Promise.resolve(getOrInitializeClusterState(clusterName, forceRefresh))
  .then(function(clusterState) {
    if (clusterState == null) {
      throw new Error(`clusterState for '${clusterName}' cluster not cached and could not be initialised.`);
    } else if (clusterState.fetchStatus === FetchStatus.ERROR) {
      // Server previously encountered an error while asynchronously processing cluster. Send error to client.
      console.log(`Sending current state to client with fetchStatus '${clusterState.fetchStatus}'.`);
      sendErrorResponse(clusterState.errorDetails, res);
      return clusterState;
    } else {
      // Send current state to client. If only just initialised, next then() block will process in background while client polls periodically
      console.log(`Sending current state to client with fetchStatus '${clusterState.fetchStatus}'.`);
      res.json(clusterState);
      return clusterState;
    }
  })
  .then(function(clusterState) {
    if (clusterState.fetchStatus === FetchStatus.INITIAL) {
      // Populate cluster state in the background while client polls asynchronously
      if (useStaticData) {
        populateStaticClusterStateWithInstanceSummaries(clusterName);
      } else {
        populateClusterStateWithInstanceSummaries(clusterName);
      }
    }
  })
  .catch(function(err) {
    console.log(`${err}\n${err.stack}`);
    setClusterStateError(clusterName, err);
    // NOTE: Don't re-throw here, to avoid 'UnhandledPromiseRejectionWarning' in router calling function
  });
}

function populateStaticClusterStateWithInstanceSummaries(clusterName) {
  console.log(`populateStaticClusterStateWithInstanceSummaries(${clusterName})`);
  updateClusterState(clusterName, FetchStatus.FETCHING, {});
  try {
    // Return some static instance details with task details
    const instanceSummaries = staticClusterDataProvider.getStaticClusterData(clusterName);
    updateClusterState(clusterName, FetchStatus.FETCHED, instanceSummaries);
  } catch (err) {
    console.log(`${err}\n${err.stack}`);
    setClusterStateError(clusterName, `Encountered error processing static file for '${clusterName}' cluster: ${err}`);
  }
}

function updateClusterState(clusterName, status, instanceSummaries) {
  console.log(`Setting fetch status to "${status}" for cluster "${clusterName}"`);
  const clusterState = getOrInitializeClusterState(clusterName);
  clusterState.fetchStatus = status;
  clusterState.instanceSummaries = instanceSummaries;
  console.log(`Updated: clusterState for '${clusterName}' cluster = ${JSON.stringify(clusterState)}`)
}

function getOrInitializeClusterState(clusterName, forceRefresh = false) {
  // NOTE: Cache will return null if cluster is not yet cached OR if cluster entry has expired
  let clusterState = clusterStateCache.get(clusterName);
  if (clusterState != null && forceRefresh) {
    console.log(`Client requested a force refresh of cluster data already cached at ${clusterState.createTimestamp} (${moment(clusterState.createTimestamp).fromNow()})`);
  }
  if (clusterState == null || forceRefresh) {
    clusterState = new ClusterState(clusterName);
    clusterStateCache.put(clusterName, clusterState, clusterStateCacheTtl);
  }
  return clusterState;
}

function setClusterStateError(clusterName, errorDetails) {
  console.log(`Setting errorDetails for '${clusterName}' cluster to: ${errorDetails}`);
  const clusterState = getOrInitializeClusterState(clusterName);
  clusterState.fetchStatus = FetchStatus.ERROR;
  clusterState.errorDetails = errorDetails;
}

function populateClusterStateWithInstanceSummaries(cluster) {
  console.log(`populateClusterStateWithInstanceSummaries(${cluster})`);
  updateClusterState(cluster, FetchStatus.FETCHING, {});

  let tasksArray = [];
  getTasksWithTaskDefinitions(cluster)
  .then(function (tasksResult) {
    tasksArray = tasksResult;
    return listAllContainerInstances(cluster);
  })
  .then(function (listAllContainerInstanceArns) {
    debugLog(`\tFound ${listAllContainerInstanceArns.length} ContainerInstanceARNs...`);
    if (listAllContainerInstanceArns.length === 0) {
      return new Promise(function (resolve, reject) {
        resolve(null);
      });
    } else {
      const containerInstanceBatches = listAllContainerInstanceArns.map(function (instances, index) {
        return index % config.aws.describeInstancesPageSize === 0 ? listAllContainerInstanceArns.slice(index, index + config.aws.describeInstancesPageSize) : null;
      }).filter(function (instances) {
        return instances;
      });
      return batchPromises(1, containerInstanceBatches, containerInstanceBatch => new Promise((resolve, reject) => {
        // The containerInstanceBatch iteratee will fire after each batch
        debugLog(`\tCalling ecs.describeContainerInstances for Container Instance batch: ${containerInstanceBatch}`);
        resolve(ecs.describeContainerInstances({
          cluster: cluster,
          containerInstances: containerInstanceBatch
        }).promise().then(promiseDelayer.delay(config.aws.apiDelay)));
      }));
    }
  })
  .then(function (describeContainerInstancesResponses) {
    if (!describeContainerInstancesResponses || describeContainerInstancesResponses.length === 0) {
      return new Promise(function (resolve, reject) {
        console.warn("No Container Instances found");
        updateClusterState(cluster, FetchStatus.FETCHED, []);
      });
    } else {
      const containerInstances = describeContainerInstancesResponses.reduce(function (acc, current) {
        return acc.concat(current.data.containerInstances);
      }, []);
      const ec2instanceIds = containerInstances.map(function (i) {
        return i.ec2InstanceId;
      });
      console.log(`Found ${ec2instanceIds.length} ec2InstanceIds for cluster '${cluster}': ${ec2instanceIds}`);
      return ec2.describeInstances({InstanceIds: ec2instanceIds}).promise()
      .then(function (ec2Instances) {
        const instances = [].concat.apply([], ec2Instances.data.Reservations.map(function (r) {
          return r.Instances
        }));
        const privateIpAddresses = instances.map(function (i) {
          return i.PrivateIpAddress
        });
        console.log(`\twith ${privateIpAddresses.length} matching Private IP addresses: ${privateIpAddresses}`);
        const instanceSummaries = containerInstances.map(function (instance) {
          const ec2IpAddress = instances.find(function (i) {
            return i.InstanceId === instance.ec2InstanceId
          }).PrivateIpAddress;
          return {
            "ec2IpAddress": ec2IpAddress,
            "ec2InstanceId": instance.ec2InstanceId,
            "ec2InstanceConsoleUrl": "https://console.aws.amazon.com/ec2/v2/home?region=" + AWS.config.region + "#Instances:instanceId=" + instance.ec2InstanceId,
            "ecsInstanceConsoleUrl": "https://console.aws.amazon.com/ecs/home?region=" + AWS.config.region + "#/clusters/" + cluster + "/containerInstances/" + instance["containerInstanceArn"].substring(instance["containerInstanceArn"].lastIndexOf("/") + 1),
            "registeredCpu": utils.registeredCpu(instance),
            "registeredMemory": utils.registeredMemory(instance),
            "remainingCpu": utils.remainingCpu(instance),
            "remainingMemory": utils.remainingMemory(instance),
            "tasks": tasksArray.filter(function (t) {
              return t.containerInstanceArn === instance.containerInstanceArn;
            })
          }
        });
        updateClusterState(cluster, FetchStatus.FETCHED, instanceSummaries);
      });
    }
  })
  .catch(function(err) {
    setClusterStateError(cluster, err);
  });
}

router.get('/api/cluster_names', function (req, res, next) {
  const useStaticData = staticDataRequested(req);
  getClusterNames(useStaticData, res);
});

function getClusterNames(useStaticData, res) {
  if (useStaticData) {
    res.json(["demo-cluster-8", "demo-cluster-50", "demo-cluster-75", "demo-cluster-100", "invalid"]);
  } else {
    ecs.listClusters({}, function (err, data1) {
      if (err) {
        sendErrorResponse(err, res);
      } else {
        res.json(data1.clusterArns.map(function (str) {
          return str.substring(str.indexOf("/") + 1)
        }));
      }
    });
  }
}

function listAllContainerInstances(cluster) {
  return new Promise(function (resolve, reject) {
    listContainerInstanceWithToken(cluster, null, [])
      .then(function (containerInstanceArns) {
        resolve(containerInstanceArns);
      })
      .catch(function (err) {
        reject(err);
      });
  });
}

function listContainerInstanceWithToken(cluster, token, instanceArns) {
  const params = {cluster: cluster, maxResults: config.aws.listInstancesPageSize};
  if (token) {
    params['nextToken'] = token;
  }
  debugLog("Calling ecs.listContainerInstances...");
  return ecs.listContainerInstances(params).promise()
    .then(function (listContainerInstanceResponse) {
      const containerInstanceArns = instanceArns.concat(listContainerInstanceResponse.data.containerInstanceArns);
      const nextToken = listContainerInstanceResponse.data.nextToken;
      if (containerInstanceArns.length === 0) {
        return [];
      } else if (nextToken) {
        return listContainerInstanceWithToken(cluster, nextToken, containerInstanceArns);
      } else {
        return containerInstanceArns;
      }
    });
}

function listAllTasks(cluster) {
  return new Promise(function (resolve, reject) {
    listTasksWithToken(cluster, null, [])
      .then(function (allTasks) {
        resolve(allTasks);
      }).catch(function (err) {
      reject(err);
    });
  });
}

function listTasksWithToken(cluster, token, tasks) {
  const params = {cluster: cluster, maxResults: config.aws.listTasksPageSize};
  if (token) {
    params['nextToken'] = token;
  }
  debugLog(`\tCalling ecs.listTasks with token: ${token} ...`);
  // TODO: Handle errors, e.g.: (node:27333) UnhandledPromiseRejectionWarning: ClusterNotFoundException: Cluster not found.
  return ecs.listTasks(params).promise()
    .then(promiseDelayer.delay(config.aws.apiDelay))
    .then(function (tasksResponse) {
      debugLog(`\t\tReceived tasksResponse with ${tasksResponse.data.taskArns.length} Task ARNs`);
      const taskArns = tasks.concat(tasksResponse.data.taskArns);
      const nextToken = tasksResponse.data.nextToken;
      if (taskArns.length === 0) {
        return [];
      } else if (nextToken) {
        return listTasksWithToken(cluster, nextToken, taskArns);
      } else {
        debugLog(`\t\tReturning ${taskArns.length} taskArns from listTasksWithToken: ${taskArns}`);
        return taskArns;
      }
    });
}

function getTasksWithTaskDefinitions(cluster) {
  console.log(`Getting Tasks annotated with Task Definitions for cluster '${cluster}'...`);
  return new Promise(function (resolve, reject) {
    let tasksArray = [];
    listAllTasks(cluster)
      .then(function (allTaskArns) {
        if (allTaskArns.length === 0) {
          console.warn("\tNo Task ARNs found");
          resolve([]);
        } else {
          return allTaskArns.map(function (tasks, index) {
            return index % config.aws.describeTasksPageSize === 0 ? allTaskArns.slice(index, index + config.aws.describeTasksPageSize) : null;
          }).filter(function (tasks) {
            return tasks;
          });
        }
      })
      .then(function (taskBatches) {
        // Describe up to maxSimultaneousDescribeTasksCalls (e.g. 2) pages of describeTasksPageSize (e.g. 100) ARNs at a time
        // Without batchPromises, we will fire all ecs.describeTasks calls one after the other and could run into API rate limit issues
        return batchPromises(config.aws.maxSimultaneousDescribeTasksCalls, taskBatches, taskBatch => new Promise((resolve, reject) => {
          // The iteratee will fire after each batch
          debugLog(`\tCalling ecs.describeTasks for Task batch: ${taskBatch}`);
          resolve(ecs.describeTasks({cluster: cluster, tasks: taskBatch}).promise()
            .then(promiseDelayer.delay(config.aws.apiDelay)));
        }));
      })
      .then(function (describeTasksResponses) {
        tasksArray = describeTasksResponses.reduce(function (acc, current) {
          return acc.concat(current.data.tasks);
        }, []);
        console.log(`Found ${tasksArray.length} tasks for cluster '${cluster}'`);
        // Wait for the responses from maxSimultaneousDescribeTaskDefinitionCalls describeTaskDefinition calls before invoking another maxSimultaneousDescribeTaskDefinitionCalls calls
        // Without batchPromises, we will fire all ecs.describeTaskDefinition calls one after the other and could run into API rate limit issues
        return batchPromises(config.aws.maxSimultaneousDescribeTaskDefinitionCalls, tasksArray, task => new Promise((resolve, reject) => {
          const cachedTaskDef = taskDefinitionCache.get(task.taskDefinitionArn);
          if (cachedTaskDef) {
            debugLog(`\tReusing cached Task Definition for Task Definition ARN: ${task.taskDefinitionArn}`);
            resolve(cachedTaskDef);
          } else {
            debugLog(`\tCalling ecs.describeTaskDefinition for Task Definition ARN: ${task.taskDefinitionArn}`);
            resolve(ecs.describeTaskDefinition({taskDefinition: task.taskDefinitionArn}).promise()
              .then(promiseDelayer.delay(config.aws.apiDelay))
              .then(function (taskDefinition) {
                debugLog(`\t\tReceived taskDefinition for ARN "${task.taskDefinitionArn}". Caching in memory.`);
                taskDefinitionCache.put(task.taskDefinitionArn, taskDefinition);
                return taskDefinition;
              })
              .catch(function (err) {
                debugLog(`\t\tFAILED ecs.describeTaskDefinition call for '${task.taskDefinitionArn}': ${err}`);
                return Promise.reject(err);
              }));
          }
        }));
      })
      .then(function (taskDefs) {
        console.log(`Found ${taskDefs.length} task definitions for cluster '${cluster}'`);
        // Fill in task details in tasksArray with taskDefinition details (e.g. memory, cpu)
        taskDefs.forEach(function (taskDef) {
          tasksArray
            .filter(function (t) {
              return t["taskDefinitionArn"] === taskDef.data.taskDefinition.taskDefinitionArn;
            })
            .forEach(function (t) {
              t["taskDefinition"] = taskDef.data.taskDefinition;
            });
        });
        resolve(tasksArray);
      })
      .catch(function (err) {
        console.error("\nCaught error in getTasksWithTaskDefinitions():", err);
        reject(err);
      });
  });
}

function send400Response(errMsg, res) {
  console.log(errMsg);
  res.status(400).send(`Error: ${errMsg}`);
}

function sendErrorResponse(err, res) {
  console.log(err);
  res.status(500).send(err.message || err);
}

function debugLog(msg) {
  debug(msg);
}

module.exports = router;
