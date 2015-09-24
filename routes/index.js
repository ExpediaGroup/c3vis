var express = require('express');
var router = express.Router();
var fs = require('fs');
// See: https://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html
var AWS = require('aws-sdk-promise');
// AWS variable now has default credentials from Shared Credentials File or Environment Variables.
// Override default credentials with ./aws_config.json if it exists
var DEFAULT_AWS_REGION = 'us-east-1';
var AWS_CONFIG_FILE = './aws_config.json';
if (fs.existsSync(AWS_CONFIG_FILE)) {
  console.log("Loading settings from '" + AWS_CONFIG_FILE + "'...");
  AWS.config.loadFromPath(AWS_CONFIG_FILE);
  console.log("  default region: " + AWS_CONFIG_FILE + ": '" + AWS.config.region + "'");
}
var ENV_AWS_REGION = process.env.AWS_REGION;
if (ENV_AWS_REGION) {
  console.log("Using AWS_REGION env value: '" + ENV_AWS_REGION + "' as default region.");
  AWS.config.update({region: ENV_AWS_REGION});
}

if (typeof AWS.config.region == 'undefined') {
  console.log("AWS_REGION env var not set and not provided in '" + process.cwd() + AWS_CONFIG_FILE + "' file. Defaulting region to '" + DEFAULT_AWS_REGION + "'.");
  AWS.config.update({region: DEFAULT_AWS_REGION});
}

var utils = require('./utils');

var ecs = new AWS.ECS();

/* Home page */

router.get('/', function(req, res, next) {
  res.render('index', { title: 'c3vis - Cloud Container Cluster Visualizer', useStaticData: req.query.static });
});

/* API endpoints
 * =============
 * Endpoints take a "?static=true" query param to enable testing with static data when AWS credentials aren't available
 */

router.get('/api/instance_summaries_with_tasks', function (req, res, next) {
  console.log("/api/instance_summaries_with_tasks: cluster='" + req.query.cluster + "', live=" + req.query.static + ")");
  if (!req.query.cluster) {
    send400Response("Please provide a 'cluster' parameter", res);
  } else {
    var cluster = req.query.cluster;
    var live = req.query.static != 'true';
    if (live) {
      var tasksArray = [];
      getTasksWithTaskDefinitions(cluster)
        .then(function (tasksResult) {
          tasksArray = tasksResult;
          // TODO: Return more than 100 instances.
          // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/ECS.html#listContainerInstances-property
          // maxResults — (Integer) The maximum number of container instance results returned by ListContainerInstances in paginated output.
          // When this parameter is used, ListContainerInstances only returns maxResults results in a single page along with a nextToken response element.
          // The remaining results of the initial request can be seen by sending another ListContainerInstances request with the returned nextToken value.
          // This value can be between 1 and 100. If this parameter is not used, then ListContainerInstances returns up to 100 results and a nextToken value if applicable.
          return ecs.listContainerInstances({cluster: cluster, maxResults: 100}).promise()
        })
        .then(function (listContainerInstancesResponse) {
          if (listContainerInstancesResponse.data.containerInstanceArns.length == 0) {
            return new Promise(function (resolve, reject) {
              resolve(null);
            });
          } else {
            // TODO: To return more than 100 instances, process listContainerInstancesResponse.data.nextToken
            // ... by sending nextToken to ecs.listContainerInstances and accumulating containerInstanceArns before calling describeContainerInstances
            return ecs.describeContainerInstances({
              cluster: cluster,
              containerInstances: listContainerInstancesResponse.data.containerInstanceArns
            }).promise();
          }
        })
        .then(function (describeContainerInstancesResponse) {
          if (!describeContainerInstancesResponse) {
            return new Promise(function (resolve, reject) {
              res.json([]);
            });
          } else {
            var instanceSummaries = describeContainerInstancesResponse.data.containerInstances.map(function (instance) {
              return {
                "ec2InstanceId": instance.ec2InstanceId,
                "ec2InstanceConsoleUrl": "https://console.aws.amazon.com/ec2/v2/home?region=" + AWS.config.region + "#Instances:instanceId=" + instance.ec2InstanceId,
                "ecsInstanceConsoleUrl": "https://console.aws.amazon.com/ecs/home?region=" + AWS.config.region + "#/clusters/" + cluster + "/containerInstances/" + instance["containerInstanceArn"].substring(instance["containerInstanceArn"].lastIndexOf("/")+1),
                "registeredCPU": utils.registeredCPU(instance),
                "registeredMemory": utils.registeredMemory(instance),
                "remainingCPU": utils.remainingCPU(instance),
                "remainingMemory": utils.remainingMemory(instance),
                "tasks": tasksArray.filter(function (t) {
                  return t.containerInstanceArn == instance.containerInstanceArn
                })
              }
            });
            res.json(instanceSummaries);
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
    res.json(["demo-cluster-8", "demo-cluster-50"]);
  }
});

function getTasksWithTaskDefinitions(cluster) {
  return new Promise(function (resolve, reject) {
    var tasksArray = [];
    ecs.listTasks({cluster: cluster}).promise()
      .then(function (listTasksResponse) {
        console.log("listTasksResponse.taskArns: " + listTasksResponse.data.taskArns);
        if (listTasksResponse.data.taskArns.length == 0) {
          // No tasks
          resolve([]);
        } else {
          return ecs.describeTasks({
            cluster: cluster,
            tasks: listTasksResponse.data.taskArns
          }).promise();
        }
      })
      .then(function (describeTasksResponse) {
        tasksArray = describeTasksResponse.data.tasks;
        return Promise.all(tasksArray.map(function (t) {
          return ecs.describeTaskDefinition({
            taskDefinition: t.taskDefinitionArn
          }).promise()
        }))
      })
      .then(function (taskDefs) {
        // Fill in task details in tasksArray with taskDefinition details (e.g. memory, cpu)
        taskDefs.forEach(function (taskDef) {
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
        reject(err)
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
