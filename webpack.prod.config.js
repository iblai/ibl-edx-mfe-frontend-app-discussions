const path = require('path');
const getBaseConfig = require('@openedx/frontend-build/lib/webpack.config.js');

const config = getBaseConfig('webpack-prod');

// Add any custom configurations here

module.exports = config;
