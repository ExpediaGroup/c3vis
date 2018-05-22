# c3vis Configuration

Server-side settings are configurable via configuration files.  Default settings for all environments can be found in [config/defaults.js](config/defaults.js).

## Environment Overrides

Different environments may require different settings (e.g. rate at which you want to make AWS API calls may be different on a laptop vs production environment).
Settings can be overridden per environment by adding entries to a config file with a name matching the `NODE_ENV` environment variable.
E.g. if `NODE_ENV` = `test`, the `config/env/test.js` file overrides will be applied and override the settings in `config/defaults.js`.

Blank files are provided for the following configuration files:

`NODE_ENV`|Configuration File
----------|------------------
`null`|[config/env/dev.js](config/env/dev.js) (`dev` environment is assumed if `NODE_ENV` not set
`"dev"`|[config/env/dev.js](config/env/dev.js)
`"test"`|[config/env/test.js](config/env/test.js)
`"prod"`|[config/env/prod.js](config/env/prod.js)

## Configuration Options

The following configuration options are available:

Config Key|Description|Default
------------- |-------------|-----
`port`|Server port to listen on|`3000`
`clusterStateCacheTtl`|Expiry time (in milliseconds) per cluster data entry in cluster state cache|`1800000` (30 mins)
`aws.configFile`|Configuration file containing AWS SDK configuration|`./aws_config.json`
`aws.apiDelay`|Number of milliseconds to pause between AWS API calls to prevent API rate limiting|`100` 
`aws.listInstancesPageSize`|Number of Instances to retrieve per `listInstances` ECS API call (max `100`)|`100`          
`aws.describeInstancesPageSize`|Number of Instances to retrieve per `describeInstances` ECS API call (max `100`)|`100`     
`aws.listTasksPageSize`|Number of Tasks to retrieve per `listTasks` ECS API call (max `100`)|`100`             
`aws.describeTasksPageSize`|Number of Tasks to retrieve per `describeTasks` ECS API call (max `100`)|`100`         
`aws.maxSimultaneousDescribeTasksCalls`|Number of `describeTasks` ECS API calls to make in quick succession before waiting for results|`2`
`aws.maxSimultaneousDescribeTaskDefinitionCalls`|Number of `describeTaskDefinitions` ECS API calls to make in quick succession before waiting for results|`1`

## AWS SDK Configuration

See [AWS_SDK_CONFIGURATION](AWS_SDK_CONFIGURATION.md)
