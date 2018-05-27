const subject = require('../config/config');
const assert = require('chai').assert;

describe('config', function() {
  it('should have default values', function() {
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
  });
});
