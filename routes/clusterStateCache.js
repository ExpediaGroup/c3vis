const cache = require('memory-cache');

class ClusterStateCache {
  constructor(ttl) {
    this.ttl = ttl;
  }

  put(key, value, ttl = this.ttl) {
    console.debug(`Added cache entry for '${key}' with ${ttl}ms TTL`);
    cache.put(key, value, ttl, function(key, value) {
      console.debug(`Cached value for '${key}' cluster expired after ${ttl}ms`);
    });
  };

  get(key) {
    return cache.get(key);
  };

}

module.exports = new ClusterStateCache();
module.exports.ClusterStateCache = ClusterStateCache;
