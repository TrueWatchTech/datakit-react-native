const path = require('path');
const pakCore = require('../packages/react-native-mobile/package.json');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');

const modules = [
  ...Object.keys(pakCore.peerDependencies),
  // The app and workspace adapter must load the same copy of the navigation library.
  'react-native-navigation',
];

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  projectRoot: __dirname,
  watchFolders: [root],
  resetCache: true,

  resolver: {
    resolveRequest(context, moduleName, platform) {
      // Workspace packages must use the same React and native view registry as the app.
      if (
        modules.some(name => moduleName === name || moduleName.startsWith(name + '/'))
      ) {
        return context.resolveRequest(
          {...context, originModulePath: path.join(__dirname, 'package.json')},
          moduleName,
          platform,
        );
      }
      return context.resolveRequest(context, moduleName, platform);
    },

    unstable_enablePackageExports: true,
    unstable_conditionNames: ['react-native', 'browser', 'require', 'default'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
