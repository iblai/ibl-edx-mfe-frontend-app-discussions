const getBaseConfig = require('@edx/frontend-build/lib/getBaseConfig');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');

const baseConfig = getBaseConfig('webpack');

const { plugins } = baseConfig;
const htmlWebpackPluginIndex = plugins.findIndex(plugin => plugin.constructor && plugin.constructor.name === 'HtmlWebpackPlugin');
if (htmlWebpackPluginIndex !== -1) {
  plugins[htmlWebpackPluginIndex] = new HtmlWebpackPlugin({
    inject: true, // Appends script tags linking to the webpack bundles at the end of the body
    template: path.resolve(process.cwd(), 'public/index.html'),
    FAVICON_URL: process.env.FAVICON_URL || null,
    OPTIMIZELY_PROJECT_ID: process.env.OPTIMIZELY_PROJECT_ID || null,
    NODE_ENV: process.env.NODE_ENV || null,
    MFE_STATIC_CSS_DOMAIN: process.env.MFE_STATIC_CSS_DOMAIN || null,
  });
}

baseConfig.plugins = plugins;
module.exports = baseConfig;
