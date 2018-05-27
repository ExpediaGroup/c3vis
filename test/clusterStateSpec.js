const ClusterState = require('../routes/clusterState');
const FetchStatus = require("../routes/fetchStatus");
const subject = new ClusterState();
const assert = require('chai').assert;

describe('ClusterState', function() {
  describe('#constructor()', function() {
    it('should set default values', function() {
      const subject = new ClusterState("MyClusterName");
      assert.equal(subject.clusterName, "MyClusterName");
      assert.equal(subject.errorDetails, null);
      assert.equal(subject.fetchStatus, FetchStatus.INITIAL);
      assert.deepEqual(subject.instanceSummaries, {});
    });
  });
});
