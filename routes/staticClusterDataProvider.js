fileUtils = require('./fileUtils.js');

const STATIC_DATA_PATH = "public/test_data";

function getStaticClusterData(clusterName) {
  const path = `${STATIC_DATA_PATH}/ecs_instance_summaries_with_tasks-${clusterName}.json`;
  return fileUtils.readJsonFile(path);
}

module.exports.STATIC_DATA_PATH = STATIC_DATA_PATH;
module.exports.getStaticClusterData = getStaticClusterData;
