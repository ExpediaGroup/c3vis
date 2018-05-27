module.exports = {
  environmentName: undefined,
  port: process.env.PORT || 3000,
  clusterStateCacheTtl: 30 * 60 * 1000,  // Invalidate clusters in cache after 30 minutes
  aws: {
    configFile: './aws_config.json',
    apiDelay: 100, // milliseconds to pause between AWS API calls to prevent API rate limiting
    listInstancesPageSize: 100,          // max 100
    describeInstancesPageSize: 100,      // max 100
    listTasksPageSize: 100,              // max 100
    describeTasksPageSize: 100,          // max 100
    maxSimultaneousDescribeTasksCalls: 2,
    maxSimultaneousDescribeTaskDefinitionCalls: 1,
  }
};
