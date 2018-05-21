const _ = require('lodash');

// Assume running in 'dev' environment if NODE_ENV environment variable not defined
const targetEnvironment = (process.env.NODE_ENV || 'dev');

// Load default configuration from defaults.js
// and extend with environment-specific configuration
module.exports = _.merge(
    require('./defaults.js'),
    require(`./env/${targetEnvironment}.js`) || {}
);
