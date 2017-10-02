const AWS_API_DELAY = 100;
const debug = require('debug')('api');
const express = require('express');
const router = express.Router();
const fs = require('fs');
// See: https://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html
const AWS = require('aws-sdk-promise');
const batchPromises = require('batch-promises');
// AWS variable now has default credentials from Shared Credentials File or Environment Variables.
// Override default credentials with ./aws_config.json if it exists
const AWS_CONFIG_FILE = './aws_config.json';
if (fs.existsSync(AWS_CONFIG_FILE)) {
  console.log(`Updating with settings from '${AWS_CONFIG_FILE}'...`);
  AWS.config.update(JSON.parse(fs.readFileSync(AWS_CONFIG_FILE, 'utf8')));
}
console.log(`Targeting AWS region '${AWS.config.region}'`);

const utils = require('./utils');

const taskDefinitionCache = require('memory-cache');

const ecs = new AWS.ECS();
const ec2 = new AWS.EC2();
const maxSize = 100;

/* Home page */

router.get('/', function (req, res, next) {
  res.render('index', {
    title: 'c3vis - Cloud Container Cluster Visualizer',
    useStaticData: req.query.static,
    resourceType: req.query.resourceType ? req.query.resourceType : 'memory'
  });
});

/* API endpoints
 * =============
 * Endpoints take a "?static=true" query param to enable testing with static data when AWS credentials aren't available
 */

router.get('/api/instance_summaries_with_tasks', function (req, res, next) {
  console.log(`/api/instance_summaries_with_tasks: cluster='${req.query.cluster}', live=${!req.query.static})`);
  debugLog(`Headers: ${JSON.stringify(req.headers, null, 4)}`);
  if (!req.query.cluster) {
    send400Response("Please provide a 'cluster' parameter", res);
  } else {
    const cluster = req.query.cluster;
    const live = req.query.static !== 'true';
    if (live) {
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
              return index % maxSize === 0 ? listAllContainerInstanceArns.slice(index, index + maxSize) : null;
            }).filter(function (instances) {
              return instances;
            });
            return batchPromises(1, containerInstanceBatches, containerInstanceBatch => new Promise((resolve, reject) => {
              // The containerInstanceBatch iteratee will fire after each batch
              debugLog(`\tCalling ecs.describeContainerInstances for Container Instance batch: ${containerInstanceBatch}`);
              resolve(ecs.describeContainerInstances({
                cluster: cluster,
                containerInstances: containerInstanceBatch
              }).promise().then(delayPromise(AWS_API_DELAY)));
            }));
          }
        })
        .then(function (describeContainerInstancesResponses) {
          if (!describeContainerInstancesResponses || describeContainerInstancesResponses.length === 0) {
            return new Promise(function (resolve, reject) {
              console.warn("No Container Instances found");
              res.json([]);
            });
          } else {
            const containerInstances = describeContainerInstancesResponses.reduce(function (acc, current) {
              return acc.concat(current.data.containerInstances);
            }, []);
            const ec2instanceIds = containerInstances.map(function (i) {
              return i.ec2InstanceId;
            });
            console.log(`Found ${ec2instanceIds.length} ec2InstanceIds: ${ec2instanceIds}`);
            return ec2.describeInstances({
              InstanceIds: ec2instanceIds
            }).promise()
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
                res.json(instanceSummaries);
              });
          }
        })
        .catch(function (err) {
          sendErrorResponse(err, res);
        });
    } else {
      // Return some static instance details with task details
      const instanceSummaries = JSON.parse(fs.readFileSync("public/test_data/ecs_instance_summaries_with_tasks-" + cluster + ".json", "utf8"));
      res.json(instanceSummaries);
    }
  }
});

router.get('/api/cluster_names', function (req, res, next) {
  const live = req.query.static !== 'true';
  if (live) {
    ecs.listClusters({}, function (err, data1) {
      if (err) {
        sendErrorResponse(err, res);
      } else {
        res.json(data1.clusterArns.map(function (str) {
          return str.substring(str.indexOf("/") + 1)
        }));
      }
    });
  } else {
    res.json(["demo-cluster-8", "demo-cluster-50", "demo-cluster-75", "demo-cluster-100"]);
  }
});

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
  const params = {cluster: cluster, maxResults: maxSize};
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
  const params = {cluster: cluster, maxResults: maxSize};
  if (token) {
    params['nextToken'] = token;
  }
  debugLog(`\tCalling ecs.listTasks with token: ${token} ...`);
  return ecs.listTasks(params).promise()
    .then(delayPromise(AWS_API_DELAY))
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
            return index % maxSize === 0 ? allTaskArns.slice(index, index + maxSize) : null;
          }).filter(function (tasks) {
            return tasks;
          });
        }
      })
      .then(function (taskBatches) {
        // Batch the batches :) - describe up to 2 batches of batches of maxSize ARNs at a time
        // Without batchPromises, we will fire all ecs.describeTasks calls one after the other and could run into API rate limit issues
        return batchPromises(2, taskBatches, taskBatch => new Promise((resolve, reject) => {
          // The iteratee will fire after each batch
          debugLog(`\tCalling ecs.describeTasks for Task batch: ${taskBatch}`);
          resolve(ecs.describeTasks({cluster: cluster, tasks: taskBatch}).promise()
            .then(delayPromise(AWS_API_DELAY)));
        }));
      })
      .then(function (describeTasksResponses) {
        tasksArray = describeTasksResponses.reduce(function (acc, current) {
          return acc.concat(current.data.tasks);
        }, []);
        console.log(`Found ${tasksArray.length} tasks`);
        // Wait for the responses from 20 describeTaskDefinition calls before invoking another 20 calls
        // Without batchPromises, we will fire all ecs.describeTaskDefinition calls one after the other and could run into API rate limit issues
        return batchPromises(1, tasksArray, task => new Promise((resolve, reject) => {
          const cachedTaskDef = taskDefinitionCache.get(task.taskDefinitionArn);
          if (cachedTaskDef) {
            debugLog(`\tReusing cached Task Definition for Task Definition ARN: ${task.taskDefinitionArn}`);
            resolve(cachedTaskDef);
          } else {
            debugLog(`\tCalling ecs.describeTaskDefinition for Task Definition ARN: ${task.taskDefinitionArn}`);
            resolve(ecs.describeTaskDefinition({taskDefinition: task.taskDefinitionArn}).promise()
              .then(delayPromise(AWS_API_DELAY))
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
        console.log(`Found ${taskDefs.length} task definitions`);
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
  console.log(err.stack.split("\n"));
  res.status(500).send(err.message);
}

function debugLog(msg) {
  debug(msg);
}

// Introduce a delay to prevent Rate Exceeded errors
// From: https://blog.raananweber.com/2015/12/01/writing-a-promise-delayer/
// NOTE: https://www.npmjs.com/package/promise-pause does not work as the aws-sdk-promise library does not return a Promise but a thenable object
function delayPromise(delay) {
  //return a function that accepts a single variable
  return function (data) {
    //this function returns a promise.
    return new Promise(function (resolve, reject) {
      debugLog(`Pausing for ${delay}ms...`);
      setTimeout(function () {
        //a promise that is resolved after "delay" milliseconds with the data provided
        resolve(data);
      }, delay);
    });
  }
}

module.exports = router;
