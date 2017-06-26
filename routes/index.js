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
  console.log("Updating with settings from '" + AWS_CONFIG_FILE + "'...");
  AWS.config.update(JSON.parse(fs.readFileSync(AWS_CONFIG_FILE, 'utf8')));
  console.log("  default region: " + AWS_CONFIG_FILE + ": '" + AWS.config.region + "'");
}


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
  console.log("/api/instance_summaries_with_tasks: cluster='" + req.query.cluster + "', live=" + !req.query.static + ")");
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
          if (listAllContainerInstanceArns.length == 0) {
            return new Promise(function (resolve, reject) {
              resolve(null);
            });
          } else {
            return ecs.describeContainerInstances({
                cluster: cluster,
                containerInstances: listAllContainerInstanceArns
            }).promise();
          }
        })
        .then(function (describeContainerInstancesResponse) {
          if (!describeContainerInstancesResponse) {
            return new Promise(function (resolve, reject) {
              res.json([]);
            });
          } else {
            containerInstances = describeContainerInstancesResponse.data.containerInstances;
            var ec2instanceIds = containerInstances.map(function (i) { return i.ec2InstanceId; });
            console.log("\nFound the following", ec2instanceIds.length, "ec2InstanceIds in cluster '", cluster, "':", ec2instanceIds);
            return ec2.describeInstances({
              InstanceIds: ec2instanceIds
            }).promise()
            .then(function (ec2Instances) {
              var instances = [].concat.apply([], ec2Instances.data.Reservations.map(function (r) { return r.Instances }));
              var privateIpAddresses = instances.map(function (i) {return i.PrivateIpAddress});
              console.log("\nMatching Private IP addressess:", privateIpAddresses);
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
    var params = {cluster: cluster, maxResults: maxSize};
    if (token) {
        params['nextToken'] = token;
    }
    //console.log("\nCalling ecs.listTasks with token", token);
    return ecs.listTasks(params).promise()
            .then(function(tasksResponse) {
                //console.log("\nReceived tasksResponse", tasksResponse);
                var taskArns = tasks.concat(tasksResponse.data.taskArns);
                var nextToken = tasksResponse.data.nextToken;
                if (taskArns.length == 0) {
                    return [];
                } else if (nextToken) {
                    return listTasksWithToken(cluster, nextToken, taskArns);
                } else {
                    //console.log("\nReturning taskArns from listTasksWithToken", taskArns);
                    return taskArns;
                }
            });
}

function findTaskDefinition(task, attempt) {
    return ecs.describeTaskDefinition({taskDefinition: task.taskDefinitionArn}).promise().catch(function (err) {
        sleep.sleep(attempt);
        if (attempt <= 5) {
            //console.log("\n  Reattempting findTaskDefinition for", task.taskDefinitionArn);
            return findTaskDefinition(task, ++attempt);
        } else {
            //console.log("\n  REJECTing findTaskDefinition for", task.taskDefinitionArn, "after", attempt, "attempts");
            return Promise.reject(err);
        }
    });
}

function getTasksWithTaskDefinitions(cluster) {
  console.log("Getting Tasks annotated with Task Definitions for cluster '", cluster, "'...");
  return new Promise(function (resolve, reject) {
    var tasksArray = [];
      listAllTasks(cluster)
          .then(function (allTaskArns) {
              if (allTaskArns.length == 0) {
                  console.log("\nNo Task ARNs found");
                  resolve([]);
              } else {
                  var taskBatches = allTaskArns.map(function (tasks, index) {
                      return index % maxSize===0 ? allTaskArns.slice(index, index + maxSize) : null;
                  }).filter(function(tasks) {
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
                //console.log("\nCalling ecs.describeTasks for", taskBatch);
                resolve(ecs.describeTasks({cluster: cluster, tasks: taskBatch}).promise());
              }));
          })
          .then(function (describeTasksResponses) {
                tasksArray = describeTasksResponses.reduce(function(acc, current){
                    return acc.concat(current.data.tasks);
                }, []);
                console.log("\Found", tasksArray.length, "tasks");
                // Wait for the responses from 20 describeTaskDefinition calls before invoking another 20 calls
                // Without batchPromises, we will fire all ecs.describeTaskDefinition calls one after the other and could run into API rate limit issues
                return batchPromises(20, tasksArray, task => new Promise((resolve, reject) => {
                    //console.log("Calling describeTaskDefinition for", task.taskDefinitionArn);
                    resolve(ecs.describeTaskDefinition({taskDefinition: task.taskDefinitionArn}).promise()
                        .then(function (taskDefinition) {
                          //console.log("  Got taskDefinition for", task.taskDefinitionArn);
                          return taskDefinition;
                        })
                        .catch(function (err) {
                          //console.log("  FAILED ecs.describeTaskDefinition() for", task.taskDefinitionArn, ":", err);
                          return Promise.reject(err);
                    }));
                  }));
        })
        .then(function (taskDefs) {
            console.log("\nFound", taskDefs.length, "task definitions");
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
  res.status(400).send("Error: " + errMsg);
}

function sendErrorResponse(err, res) {
  console.log(err);
  console.log(err.stack.split("\n"));
  res.status(500).send(err.message);
}

module.exports = router;
