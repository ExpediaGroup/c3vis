const subject = require('../routes/clusterStateCache');
const assert = require('chai').assert;

describe('ClusterStateCache', function() {
  describe('#put()', function() {
    it('should return null for missing cluster', function() {
      assert.equal(subject.get("a"), null);
    });
    // TODO: Solve subject.put() preventing test from stopping
    // it('should store value', function() {
    //   subject.put("a", 123);
    //   assert.equal(subject.get("a"), 123);
    // });
  });
  describe('#get()', function() {
    it('should expire after TTL', function() {
      subject.put("b", 123, 200);
      setTimeout(() => {
        assert.equal(subject.get("b"), null);
      }, 400);
    });
  });
});