const assert = require('chai').assert;
const CONFIG_MODULE_FILE_NAME = '../config/config';
const DEFAULT_ENVIRONMENT_NAME = "Development";

describe('config', function() {
  it('should have default values', function() {
    const subject = require(CONFIG_MODULE_FILE_NAME);
    checkDefaults(subject);
    assert.equal(subject.environmentName, DEFAULT_ENVIRONMENT_NAME);
  });
  it('should have default values when TARGET_ENV file is missing', function() {
    process.env.TARGET_ENV = "missing_env";
    // Invalidate cached config module so we can load it again with new TARGET_ENV
    delete require.cache[require.resolve(CONFIG_MODULE_FILE_NAME)];
    const subject = require(CONFIG_MODULE_FILE_NAME);
    checkDefaults(subject);
    assert.equal(subject.environmentName, DEFAULT_ENVIRONMENT_NAME);
  });
  it('should override with environment values', function() {
    process.env.TARGET_ENV = "test";
    // Invalidate cached config module so we can load it again with new TARGET_ENV
    delete require.cache[require.resolve(CONFIG_MODULE_FILE_NAME)];
    const subject = require(CONFIG_MODULE_FILE_NAME);
    checkDefaults(subject);
    assert.equal(subject.environmentName, "Test");
  });
});

function checkDefaults(subject) {
  assert.equal(subject.port, 3000);
  assert.equal(subject.clusterStateCacheTtl, 30 * 60 * 1000);
  assert.equal(subject.aws.apiDelay, 100);
  assert.equal(subject.aws.configFile, './aws_config.json');
  assert.equal(subject.aws.listInstancesPageSize, 100);
  assert.equal(subject.aws.describeInstancesPageSize, 100);
  assert.equal(subject.aws.listTasksPageSize, 100);
  assert.equal(subject.aws.describeTasksPageSize, 100);
  assert.equal(subject.aws.maxSimultaneousDescribeTasksCalls, 2);
  assert.equal(subject.aws.maxSimultaneousDescribeTaskDefinitionCalls, 1);
}
