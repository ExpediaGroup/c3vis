/* See http://bl.ocks.org/mbostock/3886208 for D3 stacked bar chart documentation */

function taskFamilyAndRevision(t) {
  return t.taskDefinitionArn.substring(t.taskDefinitionArn.lastIndexOf('/') + 1)
}

// ECS API returns memory as MBs and CPU as CPU Units
// For memory we want to convert from MBs (e.g. 4096 MBs) to bytes (4096000) to show correct units on Y axis
function translateResourceAmountForYAxis(resourceAmount, resourceType) {
  if (resourceType == ResourceEnum.MEMORY) {
    return resourceAmount * 1000000;
  } else if (resourceType == ResourceEnum.CPU) {
    return resourceAmount;
  } else {
    throw "Unknown resource type: " + resourceType;
  }
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

function renderErrorGraph(chartDivId, errorMsg, onError) {
  const graph = recreateMainGraphElement(chartDivId, DEFAULT_GRAPH_WIDTH, LEFT_MARGIN, RIGHT_MARGIN, TOTAL_HEIGHT, GRAPH_TOP_MARGIN, GRAPH_BOTTOM_MARGIN);
  handleError(errorMsg, graph, onError);
  return graph;
}

function errorResponseText(apiResponseError) {
  const errorMsg = apiResponseError instanceof XMLHttpRequest
      ? apiResponseError.responseText
      : JSON.stringify(apiResponseError);
  return `Server Error: ${errorMsg}`;
}

function renderGraph(timestampDivId, chartDivId, legendDivId, cluster, resourceTypeText, onCompletion, onError) {
  if (window.apiResponseError) {
    const apiResponseError = window.apiResponseError;
    const errorMsg = `Server Error: ${errorResponseText(apiResponseError)}`;
    return renderErrorGraph(chartDivId, errorMsg, onError);
  } else if (window.apiResponseData == null || window.apiResponseData.instanceSummaries === null) {
    const errorMsg = "Response from server contains no data.";
    return renderErrorGraph(chartDivId, errorMsg, onError);
  }

  const showTaskBreakdown = true;  // TODO: Parameterise

  const instanceSummaries = window.apiResponseData.instanceSummaries;
  const createTimestamp = window.apiResponseData.createTimestamp;
  const localizedClusterCacheTimestamp = new Date(Date.parse(createTimestamp));

  try {
    const resourceType = parseResourceType(resourceTypeText, ResourceEnum.MEMORY);
    const graphWidth = window.apiResponseError ? DEFAULT_GRAPH_WIDTH : (instanceSummaries.length > 50 ? EXPANDED_GRAPH_WIDTH : DEFAULT_GRAPH_WIDTH) - LEFT_MARGIN - RIGHT_MARGIN; //establishes width based on data set size
    const colorRange = d3.scale.ordinal().range(colorbrewer.Pastel1[9].concat(colorbrewer.Pastel2[8]).concat(colorbrewer.Set1[9]).concat(colorbrewer.Set2[8]).concat(colorbrewer.Set3[12]));
    const xRange = d3.scale.ordinal().rangeRoundBands([10, graphWidth], .1);
    const yRange = d3.scale.linear().rangeRound([GRAPH_HEIGHT, 0]);
    const xAxis = d3.svg.axis().scale(xRange).orient("bottom");
    const yAxis = d3.svg.axis().scale(yRange).orient("left").tickFormat(d3.format(".2s"));

    // Main graph area
    const graph = recreateMainGraphElement(chartDivId, graphWidth, LEFT_MARGIN, RIGHT_MARGIN, TOTAL_HEIGHT, GRAPH_TOP_MARGIN, GRAPH_BOTTOM_MARGIN);

    if (instanceSummaries.length == 0) {
      showInfo(graph, "No instances are registered for the '" + cluster + "' cluster.");
      onCompletion();
      return graph;
    }

    // TODO: Move this to footer
    graph.append("g")
      .attr("class", "fetch-timestamp")
      .append("text")
      .text(localizedClusterCacheTimestamp ? `Fetched: ${localizedClusterCacheTimestamp}` : "No fetch timestamp available");

    let uniqueTaskDefs = instanceSummaries.reduce(function (acc, current) {
      return acc.concat(current.tasks.map(function (t) {
        return taskFamilyAndRevision(t);
      }))
    }, []);
    uniqueTaskDefs = uniqueTaskDefs.filter(function (elem, pos) {
      return uniqueTaskDefs.indexOf(elem) == pos;
    });
    uniqueTaskDefs.sort();

    colorRange.domain(uniqueTaskDefs);

    instanceSummaries.forEach(function (instance) {
      // Add d3Data to each task for later display
      let y0 = 0;
      instance.tasks.forEach(function (task) {
        y0 = addD3DataToTask(task, resourceType, y0);
      });
    });

    // Set X axis ordinal domain range to be list of server names
    xRange.domain(instanceSummaries.map(function (d) {
      return d.ec2IpAddress;
    }));

    // Calculate maximum resource (memory/cpu) across all servers
    const maxResource = d3.max(instanceSummaries, function (d) {
      return registeredResource(d, resourceType);
    });
    // Set Y axis linear domain range from 0 to maximum memory/cpu in bytes
    yRange.domain([0, translateResourceAmountForYAxis(maxResource, resourceType)]);

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
          window.open(ecsInstanceConsoleUrl(instanceSummaries, d), '_blank');
        }
      },
      {
        title: 'Open EC2 Instance Console',
        action: function (elm, d, i) {
          window.open(ec2InstanceConsoleUrl(instanceSummaries, d), '_blank');
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
      .data(instanceSummaries)
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
        return yRange(translateResourceAmountForYAxis(registeredResource(d, resourceType), resourceType))
      })
      .attr("height", function (d) {
        return yRange(translateResourceAmountForYAxis(maxResource - (registeredResource(d, resourceType)), resourceType));
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
          return yRange(translateResourceAmountForYAxis(d.d3Data.y1, resourceType));
        })
        .attr("height", function (d) {
          return yRange(translateResourceAmountForYAxis(d.d3Data.y0, resourceType)) - yRange(translateResourceAmountForYAxis(d.d3Data.y1, resourceType));
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
          const usedCpu = translateResourceAmountForYAxis(registeredResource(d, resourceType), resourceType) - translateResourceAmountForYAxis(remainingResource(d, resourceType), resourceType);
          return yRange(usedCpu)
        })
        .attr("height", function (d) {
          return yRange(translateResourceAmountForYAxis(remainingResource(d, resourceType), resourceType)) - yRange(translateResourceAmountForYAxis(registeredResource(d, resourceType), resourceType));
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

function calculateInterval(attemptIndex, defaultInterval) {
  // For first 4 attempts, take shorter but progressively longer intervals.
  // E.g. if defaultInterval = 5000 then take 1s,2s,3s,4s for first 4 attempts respectively
  return attemptIndex < 5 ? attemptIndex * (defaultInterval / 5) : defaultInterval;
}

function pollUntilFetched(c3visApiUrl, forceRefresh, attemptIndex, onFetched, onError) {
  const interval = 5000;
  const maxAttempts = 120;

  if (attemptIndex >= maxAttempts) {
    const errorMsg = `Could not successfully retrieve cluster details from '${c3visApiUrl}' after ${maxAttempts} polling attempts.`;
    onError(errorMsg);
    return;
  }

  const optionalForceRefreshParam = (forceRefresh ? "&forceRefresh=true" : "");
  const updatedC3visApiUrl = c3visApiUrl + optionalForceRefreshParam;

  console.log(`Polling '${updatedC3visApiUrl}' until found in 'fetched' state.  Attempt #${attemptIndex}/${maxAttempts}`);

  // TODO: Upgrade to D3 v5, convert to use promises

  d3.json(updatedC3visApiUrl, function (apiResponseError, apiResponseData) {
    // TODO: Display multiple graphs if server returns > 100 instances
    if (apiResponseError != null) {
      window.apiResponseError = apiResponseError;
      console.debug(`  window.apiResponseError set to '${window.apiResponseError}'`);
      onError(errorResponseText(apiResponseError));
    }
    if (apiResponseData != null) {
      window.apiResponseData = apiResponseData;
      console.debug(`  window.apiResponseData contains response data for cluster '${apiResponseData.clusterName}'.`);
      if (apiResponseData.errorDetails != null) {
        onError(`Server Error: ${apiResponseData.errorDetails}`);
      } else {
        console.debug(`  Found '${apiResponseData.fetchStatus}' status in response from '${c3visApiUrl}'`);
        if (apiResponseData.fetchStatus === 'fetched') {
          onFetched();
        } else {
          console.debug(`  Not yet fetched, trying again after ${calculateInterval(attemptIndex, interval)}ms`);
          setTimeout(function () {
            // Use forceRefresh=false to ensure server is instructed to refresh only once at start of polling loop
            pollUntilFetched(c3visApiUrl, false, attemptIndex + 1, onFetched, onError)
          }, calculateInterval(attemptIndex, interval));
        }
      }
    }
  });
}

function populateGraph(useStaticData, forceRefresh, timestampDivId, chartDivId, legendDivId, cluster, resourceTypeText, onCompletion, onError) {
  try {
    if (!cluster && !useStaticData) {
      handleError("Please select a cluster.", null, onError);
      return;
    }

    const clusterParam = "cluster=" + (cluster ? cluster : "default");
    const optionalStaticParam = (useStaticData ? "&static=true" : "");
    const c3visApiUrl = "/api/instance_summaries_with_tasks?" + clusterParam + optionalStaticParam;

    window.fetchStatus = '';
    console.debug(`Requesting '${c3visApiUrl}'...`);
    // TODO: Timeout after 10mins
    pollUntilFetched(c3visApiUrl, forceRefresh, 1, function() {
      renderGraph(timestampDivId, chartDivId, legendDivId, cluster, resourceTypeText, onCompletion, onError);
    }, function(e) {
      renderErrorGraph(chartDivId, `${e.message || JSON.stringify(e)}`, onError);
    });
  } catch (e) {
    console.error(e.stack);
    renderErrorGraph(chartDivId, `ERROR. Uncaught Exception: ${e}`, onError);
  }
}
