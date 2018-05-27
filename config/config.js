const lodash = require('lodash');
const TARGET_ENV = process.env.TARGET_ENV || 'dev';

function _loadDefaultConfig() {
  return require('./defaults.js');
}

function _loadOverrideConfig(targetEnvironment) {
  try {
    // Extend configuration with environment-specific configuration
    console.debug(`Overriding default configuration with '${targetEnvironment}' environment configuration from ${_overrideConfigFilename(targetEnvironment)} (TARGET_ENV=${process.env.TARGET_ENV}, NODE_ENV=${process.env.NODE_ENV})`);
    return require(_overrideConfigFilename(targetEnvironment));
  } catch (err) {
    console.error(`ERROR: Could not load configuration file for target environment '${targetEnvironment}'. Skipping. (${err})`);
    return {}
  }
}

function _overrideConfigFilename(targetEnvironment) {
  return `./env/${targetEnvironment}.js`;
}

module.exports = lodash.merge(_loadDefaultConfig(), _loadOverrideConfig(TARGET_ENV));
