const path = require('path');
const fs = require('fs');
const { createConfig } = require('@openedx/frontend-build');

const config = createConfig('webpack-prod');

// Use local frontend-platform instead of npm package
const frontendPlatformPath = path.resolve('/openedx/frontend-platform/dist');

// Verify frontend-platform exists before setting up aliases
if (!fs.existsSync(frontendPlatformPath)) {
  console.error(`ERROR: Frontend-platform not found at ${frontendPlatformPath}`);
  console.error('Current directory:', __dirname);
  console.error('Checking if path exists...');
  try {
    const stats = fs.statSync(frontendPlatformPath);
    console.error('Path exists, stats:', stats);
  } catch (e) {
    console.error('Path does not exist:', e.message);
  }
  throw new Error(`Frontend-platform not found at ${frontendPlatformPath}`);
}

// Ensure resolve and resolve.alias exist
if (!config.resolve) {
  config.resolve = {};
}
if (!config.resolve.alias) {
  config.resolve.alias = {};
}

// Merge aliases with existing ones
config.resolve.alias = {
  ...config.resolve.alias,
  '@src': path.resolve(__dirname, 'src'),
  // Ensure React, React Router, and react-redux resolve from node_modules (not from frontend-platform)
  // This prevents React from resolving to null when imported in frontend-platform components
  // and ensures react-redux context is shared between MFE and frontend-platform
  'react': path.resolve(__dirname, 'node_modules/react'),
  'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
  'react-router': path.resolve(__dirname, 'node_modules/react-router'),
  'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
  'react-redux': path.resolve(__dirname, 'node_modules/react-redux'),
  // Alias @edx/frontend-platform modules to use local build instead of npm package
  // Only alias the specific @edx/frontend-platform modules, not all modules
  '@edx/frontend-platform': frontendPlatformPath,
  '@edx/frontend-platform/i18n': path.join(frontendPlatformPath, 'i18n'),
  '@edx/frontend-platform/analytics': path.join(frontendPlatformPath, 'analytics'),
  '@edx/frontend-platform/auth': path.join(frontendPlatformPath, 'auth'),
  '@edx/frontend-platform/logging': path.join(frontendPlatformPath, 'logging'),
  '@edx/frontend-platform/react': path.join(frontendPlatformPath, 'react'),
};

console.log('[Webpack Config] Frontend-platform aliases configured:', {
  frontendPlatformPath,
  aliases: Object.keys(config.resolve.alias).filter(k => k.includes('frontend-platform')),
});

module.exports = config;
