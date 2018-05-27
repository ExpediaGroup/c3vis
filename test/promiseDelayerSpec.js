const subject = require('../routes/promiseDelayer');
const assert = require('chai').assert;

const DELAY_MILLIS = 200;
const ACCEPTABLE_DELTA_MILLIS = 10;
const DUMMY_DATA = "dummy data";

function checkElapsedTimeWithinAcceptableDelta(timeBeforeDelay, timeAfterDelay) {
  const elapsedTime = timeAfterDelay - timeBeforeDelay;
  assert.approximately(elapsedTime, DELAY_MILLIS, ACCEPTABLE_DELTA_MILLIS, `Expected elapsed time to be roughly ${DELAY_MILLIS}ms but was ${elapsedTime}ms`)
}

describe('PromiseDelayer', function () {
  describe('#delayPromise', function () {
    it('delays a promise and passes through data', function () {
      let timeBeforeDelay;
      let timeAfterDelay;
      return Promise.resolve()
      .then(() => {
        timeBeforeDelay = new Date();
        return DUMMY_DATA
      })
      .then(subject.delay(DELAY_MILLIS))
      .then((data) => {
        timeAfterDelay = new Date();
        checkElapsedTimeWithinAcceptableDelta(timeBeforeDelay, timeAfterDelay);
        assert.equal(data, DUMMY_DATA)
      });
    });
    it('delays a promise with no data', function () {
      let timeBeforeDelay;
      let timeAfterDelay;
      return Promise.resolve()
      .then(() => {
        timeBeforeDelay = new Date();
      })
      .then(subject.delay(DELAY_MILLIS))
      .then(() => {
        timeAfterDelay = new Date();
        checkElapsedTimeWithinAcceptableDelta(timeBeforeDelay, timeAfterDelay);
      });
    });
  });
});
