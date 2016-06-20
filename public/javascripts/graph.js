/* See http://bl.ocks.org/mbostock/3886208 for D3 stacked bar chart documentation */

function taskFamilyAndRevision(t) {
  return t.taskDefinitionArn.substring(t.taskDefinitionArn.lastIndexOf('/') + 1)
}

function toBytes(megabytes) {
  return megabytes * 1000000;
}

function showInfo(graph, message) {
  console.log(message);
  showMessage(graph, message, 'black');
}

function showError(graph, message) {
  console.error(message);
  showMessage(graph, message, 'red');
}

function showMessage(graph, message, color) {
  graph.append("text").attr("x", 0).attr("y", 20).attr("fill", color).text(message);
}

function handleError(errorMsg, graph, onError) {
  showError(graph, errorMsg);
  onError(errorMsg);
}

function ecsInstanceConsoleUrl(data, ec2IpAddress) {
  instance = data.find(function (element, index, array) { return element.ec2IpAddress == ec2IpAddress; });
  return instance != null ? instance.ecsInstanceConsoleUrl : null;
}

function ec2InstanceConsoleUrl(data, ec2IpAddress) {
  instance = data.find(function (element, index, array) { return element.ec2IpAddress == ec2IpAddress; });
  return instance != null ? instance.ec2InstanceConsoleUrl : null;
}

function ec2InstanceId(data, ec2IpAddress) {
  instance = data.find(function (element, index, array) { return element.ec2IpAddress == ec2IpAddress; });
  return instance != null ? instance.ec2InstanceId : null;
}

function copyToClipboard(text) {
  var copyElement = document.createElement('input');
  copyElement.setAttribute('type', 'text');
  copyElement.setAttribute('value', text);
  copyElement = document.body.appendChild(copyElement);
  copyElement.select();
  try {
    if (!document.execCommand('copy')) {
      throw "document.execCommand('copy') is not supported or enabled"
    }
  } catch (e) {
    console.log("document.execCommand('copy'); is not supported");
    window.prompt('Copy this to clipboard (Ctrl+C or Cmd+C):', text);
  } finally {
    copyElement.remove();
  }
}

function drawGraph(useStaticData, cluster, onCompletion, onError) {
  try {
    var showTaskBreakdown = true;  // TODO: Parameterise

    if (!cluster && !useStaticData) {
      handleError("Please select a cluster.", graph, onError);
      return;
    }

    var clusterParam = "cluster=" + (cluster ? cluster : "default");
    var optionalStaticParam = (useStaticData ? "&static=true" : "");
    var c3visApiUrl = "/api/instance_summaries_with_tasks?" + clusterParam + optionalStaticParam;

    // after a GET all data from API begin drawing graph
    d3.json(c3visApiUrl, function (error, data) {
      // TODO: Display multiple graphs if server returns > 100 instances

      console.log(data);

      try {
        window.error = error;
        window.instance_summaries_with_tasks = data;
        console.log("For debugging: window.instance_summaries_with_tasks, window.error");

        var topMargin = 20;
        var bottomMargin = 100;
        var rightMargin = 50;
        var leftMargin = 50;
        var graphWidth = (data.length > 50 ? 1300 : 1000) - leftMargin - rightMargin; //establishes width based on data set size
        var graphHeight = 520 - topMargin - bottomMargin;
        var totalHeight = 400;

        var colorRange = d3.scale.ordinal().range(colorbrewer.Pastel1[9].concat(colorbrewer.Pastel2[8]).concat(colorbrewer.Set1[9]).concat(colorbrewer.Set2[8]).concat(colorbrewer.Set3[12]));
        var xRange = d3.scale.ordinal().rangeRoundBands([10, graphWidth], .1);
        var yRange = d3.scale.linear().rangeRound([graphHeight, 0]);
        var xAxis = d3.svg.axis().scale(xRange).orient("bottom");
        var yAxis = d3.svg.axis().scale(yRange).orient("left").tickFormat(d3.format(".2s"));

        // Main graph area
        d3.selectAll("svg").remove();
        var graph = d3.select("#div-chart")
          .append("svg")
          .attr("class", "cluster-graph")
          .attr("id", "cluster-graph")
          .attr("width", graphWidth + leftMargin + rightMargin)
          .attr("height", totalHeight + topMargin + bottomMargin)
          .attr("float", "left")
          .append("g").attr("transform", "translate(" + leftMargin + "," + topMargin + ")");

        if (error) {
          var errorMsg = "Server Error: " + (error instanceof XMLHttpRequest ? error.responseText : JSON.stringify(error));
          handleError(errorMsg, graph, onError);
          return;
        }

        if (data.length == 0) {
          showInfo(graph, "No instances are registered for the '" + cluster + "' cluster.");
          onCompletion();
          return;
        }

        var uniqueTaskDefs = data.reduce(function (acc, current) {
          return acc.concat(current.tasks.map(function (t) {
            return taskFamilyAndRevision(t);
          }))
        }, []);
        uniqueTaskDefs = uniqueTaskDefs.filter(function (elem, pos) {
          return uniqueTaskDefs.indexOf(elem) == pos;
        });
        uniqueTaskDefs.sort();

        colorRange.domain(uniqueTaskDefs);

        data.forEach(function (instance) {
          var y0 = 0;
          instance.tasks.forEach(function (task) {
            memoryUsage = task.taskDefinition.containerDefinitions.reduce(function (sum, b) {
              return sum + b.memory;
            }, 0);
            // Add d3Data to each task for later display
            task.d3Data = {
              name: taskFamilyAndRevision(task),
              totalMemory: memoryUsage, // sum of all containers' memory
              y0: y0,
              y1: y0 += memoryUsage
            }
          });
        });

        // Set X axis ordinal domain range to be list of server names
        xRange.domain(data.map(function (d) {
          return d.ec2IpAddress;
        }));

        // Calculate maximum memory across all servers
        var maxMemory = d3.max(data, function (d) {
          return d.registeredMemory;
        });
        // Set Y axis linear domain range from 0 to maximum memory in bytes
        yRange.domain([0, toBytes(maxMemory)]);

        // Draw X axis
        var xAxisLabels = graph.append("g")
          .attr("class", "graph-axis")
          .attr("transform", "translate(0," + graphHeight + ")")
          .call(xAxis);

        var menu = [
          {
            title: 'Copy IP Address',
            action: function(elm, d, i) {
              copyToClipboard(d);
            }
          },
          {
            title: 'Open ECS Container Instance Console',
            action: function(elm, d, i) {
              window.open(ecsInstanceConsoleUrl(data, d), '_blank');
            }
          },
          {
            title: 'Open EC2 Instance Console',
            action: function(elm, d, i) {
              window.open(ec2InstanceConsoleUrl(data, d), '_blank');
            }
          }
        ];

        xAxisLabels.selectAll("text")
          .attr("cursor", "pointer")
          .on('contextmenu', d3.contextMenu(menu))
          // Use ecsInstanceConsoleUrl as hover tooltip
          .append("svg:title")
          .text(function (d) {
            return "Right-click for options";
          });

        // Rotate X axis labels 90 degrees if bar is wide enough to cause overlapping
        if (xRange.rangeBand() < 80) {
          xAxisLabels.selectAll("text")
            .attr("y", 0)
            .attr("x", 9)
            .attr("dy", ".35em")
            .attr("transform", "rotate(90)")
            .style("text-anchor", "start");
        }

        // Make the font smaller if bar is wide enough to cause overlapping
        if (xRange.rangeBand() < 14) {
          xAxisLabels.selectAll("text")
            .attr("class", "graph-axis-small")
        }

        // Draw Y axis
        graph.append("g")
          .attr("class", "graph-axis")
          .call(yAxis)
          .append("text")
          .attr("transform", "rotate(-90)")
          .attr("y", 6)
          .attr("dy", ".71em")
          .style("text-anchor", "end")
          .text("Memory");

        // TODO: Request task data in parallel with instance data. Draw instance outline first then draw task boxes
        // Create svg elements for each server
        var instance = graph.selectAll(".instance")
          .data(data)
          .enter().append("g")
          .attr("class", "g")
          .attr("transform", function (d) {
            return "translate(" + xRange(d.ec2IpAddress) + ",0)";
          });

        // For each server, draw entire memory available as grey rect
        instance.append("rect")
          .attr("class", "instance-block")
          .attr("width", xRange.rangeBand())
          .attr("y", function (d) {
            return yRange(toBytes(d.registeredMemory))
          })
          .attr("height", function (d) {
            return yRange(toBytes(maxMemory - d.registeredMemory));
          });

        if (showTaskBreakdown) {
          // For each task on each server, represent memory usage as a rect
          instance.selectAll(".task")
            .data(function (d) {
              return d.tasks;
            })
            .enter().append("rect")
            .attr("class", "task-block")
            .attr("width", xRange.rangeBand())
            .attr("y", function (d) {
              return yRange(toBytes(d.d3Data.y1));
            })
            .attr("height", function (d) {
              return yRange(toBytes(d.d3Data.y0)) - yRange(toBytes(d.d3Data.y1));
            })
            .style("fill", function (d) {
              return colorRange(d.d3Data.name);
            })
            // Use name as hover tooltip
            .append("svg:title")
            .text(function (d) {
              return d.d3Data.name;
            });

          // Draw legend

          var taskData = uniqueTaskDefs.sort();

          // TODO: Add hover highlight of related blocks
          var svg2 = d3.select("#div-legend")
                .append("svg")
                .attr("class", "cluster-legend")
                .attr("id", "cluster-legend")
                .attr("width", 200)
                .attr("height", (20 * taskData.length) + 20);

          var legend = svg2.append("g")
                .attr("class", "legend");

          legend.selectAll('rect')
                .data(taskData)
                .enter()
                .append("rect")
                .attr("y", function(d, i) { return ((i *  20) + topMargin); })
                .attr("width", 18)
                .attr("height", 18)
                .style("fill", function (d) { return colorRange(d); });

          legend.selectAll('text')
                .data(taskData)
                .enter()
                .append("text")
                .attr("x", 25)
                .attr("width", 5)
                .attr("height", 5)
                .attr("y", function(d, i) { return ((i *  20) + topMargin + 12); })
                .text(function(d) { return d; });

          

        } else {
          // For each each server, represent total memory usage as a single orange rect
          instance.append("rect")
            .attr("width", xRange.rangeBand())
            .attr("y", function (d) {
              var usedMemory = toBytes(d.registeredMemory) - toBytes(d.remainingMemory);
              return yRange(usedMemory)
            })
            .attr("height", function (d) {
              return yRange(toBytes(d.remainingMemory)) - yRange(toBytes(d.registeredMemory));
            })
            .style("fill", "orange")
            .style("stroke", "grey");
        }

        onCompletion();

      } catch (e) {
        handleError("Server Error: " + e, graph, onError);
      }
    });
  } catch (e) {
    handleError("ERROR. Uncaught Exception: " + e, graph, onError);
  }
}
