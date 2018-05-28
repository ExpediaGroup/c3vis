class PromiseDelayer {
  delay(ms) {
    return function(data) {
      return new Promise(resolve => setTimeout(() => resolve(data), ms));
    };
  }
}

module.exports = new PromiseDelayer();
