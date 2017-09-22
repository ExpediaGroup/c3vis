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
  console.error(message || "Error");
  showMessage(graph, message, 'red');
}

function showMessage(graph, message, color) {
  graph.append("text").attr("x", 0).attr("y", 20).attr("fill", color).text(message || "Error");
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

function addD3DataToTask(task, resourceType, y0) {
  var resourceAllocation = task.taskDefinition.containerDefinitions.reduce(function (sum, b) { return sum + (resourceType == ResourceEnum.MEMORY ? b.memory : b.cpu); }, 0);
  var y1 = y0 + resourceAllocation;
  task.d3Data = {
    name: taskFamilyAndRevision(task),
    resourceAllocation: resourceAllocation, // sum of all containers' resource (memory/cpu) allocation
    y0: y0,
    y1: y1
  };
  return y1;
}

function registeredResource(d, resourceType) {
  if (resourceType == ResourceEnum.MEMORY) {
    return d.registeredMemory;
  } else if (resourceType == ResourceEnum.CPU) {
    return d.registeredCpu;
  } else {
    throw "Unknown resource type: " + resourceType;
  }
}

function remainingResource(d, resourceType) {
  if (resourceType == ResourceEnum.MEMORY) {
    return d.remainingMemory;
  } else if (resourceType == ResourceEnum.CPU) {
    return d.remainingCpu;
  } else {
    throw "Unknown resource type: " + resourceType;
  }
}

function renderGraph(chartDivId, legendDivId, cluster, resourceTypeText, onCompletion, onError) {
  var showTaskBreakdown = true;  // TODO: Parameterise
  try {
    var resourceType = parseResourceType(resourceTypeText, ResourceEnum.MEMORY);
    var topMargin = 20;
    var bottomMargin = 100;
    var rightMargin = 50;
    var leftMargin = 50;
    var graphWidth = (window.apiResponseData.length > 50 ? 1300 : 1000) - leftMargin - rightMargin; //establishes width based on data set size
    var graphHeight = 520 - topMargin - bottomMargin;
    var totalHeight = 400;

    var colorRange = d3.scale.ordinal().range(colorbrewer.Pastel1[9].concat(colorbrewer.Pastel2[8]).concat(colorbrewer.Set1[9]).concat(colorbrewer.Set2[8]).concat(colorbrewer.Set3[12]));
    var xRange = d3.scale.ordinal().rangeRoundBands([10, graphWidth], .1);
    var yRange = d3.scale.linear().rangeRound([graphHeight, 0]);
    var xAxis = d3.svg.axis().scale(xRange).orient("bottom");
    var yAxis = d3.svg.axis().scale(yRange).orient("left").tickFormat(d3.format(".2s"));

    // Main graph area
    d3.select('#' + chartDivId).select("svg").remove();
    var graph = d3.select('#' + chartDivId)
        .append("svg")
        .attr("class", "cluster-graph")
        .attr("id", "cluster-graph")
        .attr("width", graphWidth + leftMargin + rightMargin)
        .attr("height", totalHeight + topMargin + bottomMargin)
        .attr("float", "left")
        .append("g").attr("transform", "translate(" + leftMargin + "," + topMargin + ")");

    if (window.apiResponseError) {
      var errorMsg = "Server Error: " + (window.apiResponseError instanceof XMLHttpRequest ? window.apiResponseError.responseText : JSON.stringify(window.apiResponseError));
      handleError(errorMsg, graph, onError);
      return graph;
    }

    if (window.apiResponseData.length == 0) {
      showInfo(graph, "No instances are registered for the '" + cluster + "' cluster.");
      onCompletion();
      return graph;
    }

    var uniqueTaskDefs = window.apiResponseData.reduce(function (acc, current) {
      return acc.concat(current.tasks.map(function (t) {
        return taskFamilyAndRevision(t);
      }))
    }, []);
    uniqueTaskDefs = uniqueTaskDefs.filter(function (elem, pos) {
      return uniqueTaskDefs.indexOf(elem) == pos;
    });
    uniqueTaskDefs.sort();

    colorRange.domain(uniqueTaskDefs);

    window.apiResponseData.forEach(function (instance) {
      // Add d3Data to each task for later display
      var y0 = 0;
      instance.tasks.forEach(function(task) {
        y0 = addD3DataToTask(task, resourceType, y0);
      });
    });

    // Set X axis ordinal domain range to be list of server names
    xRange.domain(window.apiResponseData.map(function (d) {
      return d.ec2IpAddress;
    }));

    // Calculate maximum resource (memory/cpu) across all servers
    var maxResource = d3.max(window.apiResponseData, function (d) {
      return registeredResource(d, resourceType);
    });
    // Set Y axis linear domain range from 0 to maximum memory/cpu in bytes
    yRange.domain([0, toBytes(maxResource)]);

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
          window.open(ecsInstanceConsoleUrl(window.apiResponseData, d), '_blank');
        }
      },
      {
        title: 'Open EC2 Instance Console',
        action: function(elm, d, i) {
          window.open(ec2InstanceConsoleUrl(window.apiResponseData, d), '_blank');
        }
      }
    ];

    xAxisLabels.selectAll("text")
        .attr("cursor", "pointer")
        .on('contextmenu', d3.contextMenu(menu))
        // X axis tooltip
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
        .text(resourceLabel(resourceType));

    // TODO: Request task data in parallel with instance data. Draw instance outline first then draw task boxes
    // Create svg elements for each server
    var instance = graph.selectAll(".instance")
        .data(window.apiResponseData)
        .enter().append("g")
        .attr("class", "g")
        .attr("transform", function (d) {
          return "translate(" + xRange(d.ec2IpAddress) + ",0)";
        });

    // For each server, draw entire resource (memory/cpu) available as grey rect
    instance.append("rect")
        .attr("class", "instance-block")
        .attr("width", xRange.rangeBand())
        .attr("y", function (d) {
          return yRange(toBytes(registeredResource(d, resourceType)))
        })
        .attr("height", function (d) {
          return yRange(toBytes(maxResource - (registeredResource(d, resourceType))));
        });

    if (showTaskBreakdown) {
      // For each task on each server, represent resource (memory/cpu) allocation as a rect
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
            return d.d3Data.name + "  (" + resourceLabel(resourceType) + ": " + d.d3Data.resourceAllocation + ")";
          });

      // Draw legend

      var taskData = uniqueTaskDefs.sort();
      var longestLength = taskData.reduce(function (a, b) { return a.length > b.length ? a : b; }, []).length;

      // TODO: Add hover highlight of related blocks
      d3.select('#' + legendDivId).select("svg").remove();
      var svg2 = d3.select('#' + legendDivId)
          .append("svg")
          .attr("class", "cluster-legend")
          .attr("id", "cluster-legend")
          .attr("width", (longestLength * 10) + 20)
          .attr("height", (20 * taskData.length) + 20);

      var legend = svg2.append("g")
          .attr("class", "legend");

      legend.selectAll('rect')
          .data(taskData)
          .enter()
          .append("rect")
          .attr("x", 1)
          .attr("y", function(d, i) { return ((i *  20) + topMargin); })
          .attr("width", 18)
          .attr("height", 18)
          .style("fill", function (d) { return colorRange(d); })
          .style("stroke-width", 0.5)
          .style("stroke", "rgb(51, 51, 51)");

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
      // For each each server, represent total cpu allocation as a single orange rect
      instance.append("rect")
          .attr("width", xRange.rangeBand())
          .attr("y", function (d) {
            var usedCpu = toBytes(registeredResource(d, resourceType)) - toBytes(remainingResource(d, resourceType));
            return yRange(usedCpu)
          })
          .attr("height", function (d) {
            return yRange(toBytes(remainingResource(d, resourceType))) - yRange(toBytes(registeredResource(d, resourceType)));
          })
          .style("fill", "orange")
          .style("stroke", "grey");
    }

    return graph;

  } catch (e) {
    handleError(e.stack ? e.stack : e, graph, onError);
  } finally {
    onCompletion();
  }
}

function populateGraph(useStaticData, chartDivId, legendDivId, cluster, resourceTypeText, onCompletion, onError) {
  try {
    if (!cluster && !useStaticData) {
      handleError("Please select a cluster.", graph, onError);
      return;
    }

    var clusterParam = "cluster=" + (cluster ? cluster : "default");
    var optionalStaticParam = (useStaticData ? "&static=true" : "");
    var c3visApiUrl = "/api/instance_summaries_with_tasks?" + clusterParam + optionalStaticParam;

    // after a GET all data from API begin drawing graph
    d3.json(c3visApiUrl, function (apiResponseError, apiResponseData) {
      // TODO: Display multiple graphs if server returns > 100 instances

      window.apiResponseError = apiResponseError;
      window.apiResponseData = apiResponseData;
      console.log("For debugging: window.apiResponseData, window.apiResponseError");

      renderGraph(chartDivId, legendDivId, cluster, resourceTypeText, onCompletion, onError);
    });
  } catch (e) {
    handleError("ERROR. Uncaught Exception: " + e, graph, onError);
  }
}
