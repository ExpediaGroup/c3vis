FetchStatus = require('./fetchStatus.js');

class ClusterState {
  constructor(clusterName) {
    this.clusterName = clusterName;
    this.fetchStatus = FetchStatus.INITIAL;
    this.createTimestamp = new Date();
    this.instanceSummaries = {};
    this.errorDetails = null;
  }
}

module.exports = ClusterState;
