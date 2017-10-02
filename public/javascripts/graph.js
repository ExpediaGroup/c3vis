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
  if (graph !== null) {
    graph.append("text").attr("x", 0).attr("y", 20).attr("fill", color).text(message || "Error");
  }
}

function handleError(errorMsg, graph, onError) {
  showError(graph, errorMsg);
  onError(errorMsg);
}

function ecsInstanceConsoleUrl(data, ec2IpAddress) {
  const instance = data.find(function (element, index, array) {
    return element.ec2IpAddress == ec2IpAddress;
  });
  return instance != null ? instance.ecsInstanceConsoleUrl : null;
}

function ec2InstanceConsoleUrl(data, ec2IpAddress) {
  const instance = data.find(function (element, index, array) {
    return element.ec2IpAddress == ec2IpAddress;
  });
  return instance != null ? instance.ec2InstanceConsoleUrl : null;
}

function ec2InstanceId(data, ec2IpAddress) {
  const instance = data.find(function (element, index, array) {
    return element.ec2IpAddress == ec2IpAddress;
  });
  return instance != null ? instance.ec2InstanceId : null;
}

function copyToClipboard(text) {
  let copyElement = document.createElement('input');
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
  const resourceAllocation = task.taskDefinition.containerDefinitions.reduce(function (sum, b) {
    return sum + (resourceType == ResourceEnum.MEMORY ? b.memory : b.cpu);
  }, 0);
  const y1 = y0 + resourceAllocation;
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

function recreateMainGraphElement(chartDivId, graphWidth, leftMargin, rightMargin, totalHeight, topMargin, bottomMargin) {
  d3.select('#' + chartDivId).select("svg").remove();
  return d3.select('#' + chartDivId)
    .append("svg")
    .attr("class", "cluster-graph")
    .attr("id", "cluster-graph")
    .attr("width", graphWidth + leftMargin + rightMargin)
    .attr("height", totalHeight + topMargin + bottomMargin)
    .attr("float", "left")
    .append("g").attr("transform", "translate(" + leftMargin + "," + topMargin + ")");
}

const GRAPH_TOP_MARGIN = 20;
const GRAPH_BOTTOM_MARGIN = 100;
const RIGHT_MARGIN = 50;
const LEFT_MARGIN = 50;
const GRAPH_HEIGHT = 520 - GRAPH_TOP_MARGIN - GRAPH_BOTTOM_MARGIN;
const TOTAL_HEIGHT = 400;
const DEFAULT_GRAPH_WIDTH = 1000;
const EXPANDED_GRAPH_WIDTH = 1300;

function renderGraph(chartDivId, legendDivId, cluster, resourceTypeText, onCompletion, onError) {
  if (window.apiResponseError) {
    const errorMsg = "Server Error: " + (window.apiResponseError instanceof XMLHttpRequest ? window.apiResponseError.responseText : JSON.stringify(window.apiResponseError));
    const graph = recreateMainGraphElement(chartDivId, DEFAULT_GRAPH_WIDTH, LEFT_MARGIN, RIGHT_MARGIN, TOTAL_HEIGHT, GRAPH_TOP_MARGIN, GRAPH_BOTTOM_MARGIN);
    handleError(errorMsg, graph, onError);
    return graph;
  }

  const showTaskBreakdown = true;  // TODO: Parameterise

  try {
    const resourceType = parseResourceType(resourceTypeText, ResourceEnum.MEMORY);
    const graphWidth = window.apiResponseError ? DEFAULT_GRAPH_WIDTH : (window.apiResponseData.length > 50 ? EXPANDED_GRAPH_WIDTH : DEFAULT_GRAPH_WIDTH) - LEFT_MARGIN - RIGHT_MARGIN; //establishes width based on data set size
    const colorRange = d3.scale.ordinal().range(colorbrewer.Pastel1[9].concat(colorbrewer.Pastel2[8]).concat(colorbrewer.Set1[9]).concat(colorbrewer.Set2[8]).concat(colorbrewer.Set3[12]));
    const xRange = d3.scale.ordinal().rangeRoundBands([10, graphWidth], .1);
    const yRange = d3.scale.linear().rangeRound([GRAPH_HEIGHT, 0]);
    const xAxis = d3.svg.axis().scale(xRange).orient("bottom");
    const yAxis = d3.svg.axis().scale(yRange).orient("left").tickFormat(d3.format(".2s"));

    // Main graph area
    const graph = recreateMainGraphElement(chartDivId, graphWidth, LEFT_MARGIN, RIGHT_MARGIN, TOTAL_HEIGHT, GRAPH_TOP_MARGIN, GRAPH_BOTTOM_MARGIN);

    if (window.apiResponseData.length == 0) {
      showInfo(graph, "No instances are registered for the '" + cluster + "' cluster.");
      onCompletion();
      return graph;
    }

    let uniqueTaskDefs = window.apiResponseData.reduce(function (acc, current) {
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
      let y0 = 0;
      instance.tasks.forEach(function (task) {
        y0 = addD3DataToTask(task, resourceType, y0);
      });
    });

    // Set X axis ordinal domain range to be list of server names
    xRange.domain(window.apiResponseData.map(function (d) {
      return d.ec2IpAddress;
    }));

    // Calculate maximum resource (memory/cpu) across all servers
    const maxResource = d3.max(window.apiResponseData, function (d) {
      return registeredResource(d, resourceType);
    });
    // Set Y axis linear domain range from 0 to maximum memory/cpu in bytes
    yRange.domain([0, toBytes(maxResource)]);

    // Draw X axis
    const xAxisLabels = graph.append("g")
      .attr("class", "graph-axis")
      .attr("transform", "translate(0," + GRAPH_HEIGHT + ")")
      .call(xAxis);

    const menu = [
      {
        title: 'Copy IP Address',
        action: function (elm, d, i) {
          copyToClipboard(d);
        }
      },
      {
        title: 'Open ECS Container Instance Console',
        action: function (elm, d, i) {
          window.open(ecsInstanceConsoleUrl(window.apiResponseData, d), '_blank');
        }
      },
      {
        title: 'Open EC2 Instance Console',
        action: function (elm, d, i) {
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
    const instance = graph.selectAll(".instance")
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

      const taskData = uniqueTaskDefs.sort();
      const longestLength = taskData.reduce(function (a, b) {
        return a.length > b.length ? a : b;
      }, []).length;

      // TODO: Add hover highlight of related blocks
      d3.select('#' + legendDivId).select("svg").remove();
      const svg2 = d3.select('#' + legendDivId)
        .append("svg")
        .attr("class", "cluster-legend")
        .attr("id", "cluster-legend")
        .attr("width", (longestLength * 10) + 20)
        .attr("height", (20 * taskData.length) + 20);

      const legend = svg2.append("g")
        .attr("class", "legend");

      legend.selectAll('rect')
        .data(taskData)
        .enter()
        .append("rect")
        .attr("x", 1)
        .attr("y", function (d, i) {
          return ((i * 20) + GRAPH_TOP_MARGIN);
        })
        .attr("width", 18)
        .attr("height", 18)
        .style("fill", function (d) {
          return colorRange(d);
        })
        .style("stroke-width", 0.5)
        .style("stroke", "rgb(51, 51, 51)");

      legend.selectAll('text')
        .data(taskData)
        .enter()
        .append("text")
        .attr("x", 25)
        .attr("width", 5)
        .attr("height", 5)
        .attr("y", function (d, i) {
          return ((i * 20) + GRAPH_TOP_MARGIN + 12);
        })
        .text(function (d) {
          return d;
        });

    } else {
      // For each each server, represent total cpu allocation as a single orange rect
      instance.append("rect")
        .attr("width", xRange.rangeBand())
        .attr("y", function (d) {
          const usedCpu = toBytes(registeredResource(d, resourceType)) - toBytes(remainingResource(d, resourceType));
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
    handleError(e.stack ? e.stack : e, null, onError);
  } finally {
    onCompletion();
  }
}

function populateGraph(useStaticData, chartDivId, legendDivId, cluster, resourceTypeText, onCompletion, onError) {
  try {
    if (!cluster && !useStaticData) {
      handleError("Please select a cluster.", null, onError);
      return;
    }

    const clusterParam = "cluster=" + (cluster ? cluster : "default");
    const optionalStaticParam = (useStaticData ? "&static=true" : "");
    const c3visApiUrl = "/api/instance_summaries_with_tasks?" + clusterParam + optionalStaticParam;

    // after a GET all data from API begin drawing graph
    d3.json(c3visApiUrl, function (apiResponseError, apiResponseData) {
      // TODO: Display multiple graphs if server returns > 100 instances

              window.apiResponseError = apiResponseError;
              window.apiResponseData = apiResponseData;
              console.log("For debugging: window.apiResponseData, window.apiResponseError");

              renderGraph(chartDivId, legendDivId, cluster, resourceTypeText, onCompletion, onError);
            });
  } catch (e) {
    handleError("ERROR. Uncaught Exception: " + e, null, onError);
  }
}
