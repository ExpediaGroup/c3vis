// TODO: Convert DEBUG_LOGGING to configuration
var DEBUG_LOGGING = true;

var express = require('express');
var router = express.Router();
var fs = require('fs');
// See: https://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html
var AWS = require('aws-sdk-promise');
var sleep = require('sleep');
var batchPromises = require('batch-promises');
// AWS variable now has default credentials from Shared Credentials File or Environment Variables.
// Override default credentials with ./aws_config.json if it exists
var AWS_CONFIG_FILE = './aws_config.json';
if (fs.existsSync(AWS_CONFIG_FILE)) {
  console.log(`Updating with settings from '${AWS_CONFIG_FILE}'...`);
  AWS.config.update(JSON.parse(fs.readFileSync(AWS_CONFIG_FILE, 'utf8')));
}
console.log(`Targeting AWS region '${AWS.config.region}'`);


var utils = require('./utils');

var ecs = new AWS.ECS();
var ec2 = new AWS.EC2();
var maxSize = 100;

/* Home page */

router.get('/', function(req, res, next) {
  res.render('index', { title: 'c3vis - Cloud Container Cluster Visualizer', useStaticData: req.query.static, resourceType: req.query.resourceType ? req.query.resourceType : 'memory' });
});

/* API endpoints
 * =============
 * Endpoints take a "?static=true" query param to enable testing with static data when AWS credentials aren't available
 */

router.get('/api/instance_summaries_with_tasks', function (req, res, next) {
  console.log(`/api/instance_summaries_with_tasks: cluster='${req.query.cluster}', live=${!req.query.static})`);
  if (!req.query.cluster) {
    send400Response("Please provide a 'cluster' parameter", res);
  } else {
    var cluster = req.query.cluster;
    var live = req.query.static != 'true';
    if (live) {
      var tasksArray = [];
      var containerInstances = [];
      getTasksWithTaskDefinitions(cluster)
        .then(function (tasksResult) {
          tasksArray = tasksResult;
            return listAllContainerInstances(cluster);
        })
        .then(function (listAllContainerInstanceArns) {
            debugLog(`\tFound ${listAllContainerInstanceArns.length} ContainerInstanceARNs...`);
          if (listAllContainerInstanceArns.length == 0) {
            return new Promise(function (resolve, reject) {
              resolve(null);
            });
          } else {
              let containerInstanceBatches = listAllContainerInstanceArns.map(function (instances, index) {
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
                  }).promise());
              }));
          }
        })
        .then(function (describeContainerInstancesResponses) {
          if (!describeContainerInstancesResponses || describeContainerInstancesResponses.length == 0) {
            return new Promise(function (resolve, reject) {
              console.warn("No Container Instances found");
              res.json([]);
            });
          } else {
            let containerInstances = describeContainerInstancesResponses.reduce(function(acc, current){
              return acc.concat(current.data.containerInstances);
            }, []);
            let ec2instanceIds = containerInstances.map(function (i) { return i.ec2InstanceId; });
            console.log(`Found ${ec2instanceIds.length} ec2InstanceIds: ${ec2instanceIds}`);
            return ec2.describeInstances({
              InstanceIds: ec2instanceIds
            }).promise()
            .then(function (ec2Instances) {
              var instances = [].concat.apply([], ec2Instances.data.Reservations.map(function (r) { return r.Instances }));
              var privateIpAddresses = instances.map(function (i) {return i.PrivateIpAddress});
              console.log(`\twith ${privateIpAddresses.length} matching Private IP addresses: ${privateIpAddresses}`);
              var instanceSummaries = containerInstances.map(function (instance) {
                var ec2IpAddress = instances.find(function (i) {return i.InstanceId == instance.ec2InstanceId}).PrivateIpAddress;
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
                      return t.containerInstanceArn == instance.containerInstanceArn;
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
      var instanceSummaries = JSON.parse(fs.readFileSync("public/test_data/ecs_instance_summaries_with_tasks-" + cluster + ".json", "utf8"));
      res.json(instanceSummaries);
    }
  }
});

router.get('/api/cluster_names', function (req, res, next) {
  var live = req.query.static != 'true';
  if (live) {
    ecs.listClusters({}, function(err, data1) {
      if (err) {
        sendErrorResponse(err, res);
      } else {
        res.json(data1.clusterArns.map(function(str){return str.substring(str.indexOf("/")+1)}));
      }
    });
  } else {
    res.json(["demo-cluster-8", "demo-cluster-50", "demo-cluster-75", "demo-cluster-100"]);
  }
});

function listAllContainerInstances(cluster) {
    return new Promise(function (resolve, reject) {
        listContainerInstanceWithToken(cluster, null, [])
            .then (function(containerInstanceArns) {
                resolve(containerInstanceArns);
            }).catch (function (err) {
                reject(err);
            });
    });
}

function listContainerInstanceWithToken(cluster, token, instanceArns) {
    var params = {cluster: cluster, maxResults: maxSize};
    if (token) {
        params['nextToken'] = token;
    }
    return ecs.listContainerInstances(params).promise()
            .then(function(listContainerInstanceResponse) {
                var containerInstanceArns = instanceArns.concat(listContainerInstanceResponse.data.containerInstanceArns);
                var nextToken = listContainerInstanceResponse.data.nextToken;
                if (containerInstanceArns.length == 0) {
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
            .then (function(allTasks) {
                resolve(allTasks);
            }).catch (function (err) {
                reject(err);
            });
    });
}

function listTasksWithToken(cluster, token, tasks) {
    let params = {cluster: cluster, maxResults: maxSize};
    if (token) {
        params['nextToken'] = token;
    }
    debugLog(`\tIn listTasksWithToken(), calling ecs.listTasks with token ${token}`);
    return ecs.listTasks(params).promise()
            .then(function(tasksResponse) {
                debugLog(`\t\tReceived tasksResponse with ${tasksResponse.data.taskArns.length} Task ARNs`);
                let taskArns = tasks.concat(tasksResponse.data.taskArns);
                let nextToken = tasksResponse.data.nextToken;
                if (taskArns.length == 0) {
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
              if (allTaskArns.length == 0) {
                  console.warn("\tNo Task ARNs found");
                  resolve([]);
              } else {
                  let taskBatches = allTaskArns.map(function (tasks, index) {
                      return index % maxSize === 0 ? allTaskArns.slice(index, index + maxSize) : null;
                  }).filter(function (tasks) {
                      return tasks;
                  });
                  return taskBatches;
              }
          })
          .then(function (taskBatches) {
              // Batch the batches :) - describe up to 2 batches of batches of maxSize ARNs at a time
              // Without batchPromises, we will fire all ecs.describeTasks calls one after the other and could run into API rate limit issues
              return batchPromises(2, taskBatches, taskBatch => new Promise((resolve, reject) => {
                  // The iteratee will fire after each batch
                  debugLog(`\tCalling ecs.describeTasks for Task batch: ${taskBatch}`);
                  resolve(ecs.describeTasks({cluster: cluster, tasks: taskBatch}).promise());
              }));
          })
          .then(function (describeTasksResponses) {
                tasksArray = describeTasksResponses.reduce(function(acc, current){
                    return acc.concat(current.data.tasks);
                }, []);
                console.log(`Found ${tasksArray.length} tasks`);
                // Wait for the responses from 20 describeTaskDefinition calls before invoking another 20 calls
                // Without batchPromises, we will fire all ecs.describeTaskDefinition calls one after the other and could run into API rate limit issues
                return batchPromises(20, tasksArray, task => new Promise((resolve, reject) => {
                    debugLog(`\tCalling describeTaskDefinition for Task Definition ARN: ${task.taskDefinitionArn}`);
                    // TODO: Don't ask for same task definition more than once
                    resolve(ecs.describeTaskDefinition({taskDefinition: task.taskDefinitionArn}).promise()
                        .then(function (taskDefinition) {
                          debugLog(`\t\tReceived taskDefinition for ${task.taskDefinitionArn}`);
                          return taskDefinition;
                        })
                        .catch(function (err) {
                          debugLog(`\t\tFAILED ecs.describeTaskDefinition() for '${task.taskDefinitionArn}': ${err}`);
                          return Promise.reject(err);
                    }));
                  }));
        })
        .then(function (taskDefs) {
            console.log(`Found ${taskDefs.length} task definitions`);
            // Fill in task details in tasksArray with taskDefinition details (e.g. memory, cpu)
            taskDefs.forEach(function(taskDef) {
            tasksArray
                .filter(function (t) {
                   return t["taskDefinitionArn"] == taskDef.data.taskDefinition.taskDefinitionArn;
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
    if (DEBUG_LOGGING) {
        console.info(msg);
    }
}

module.exports = router;
