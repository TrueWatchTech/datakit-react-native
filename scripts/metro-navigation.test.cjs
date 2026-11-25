const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'example');
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const { resolve } = appRequire('metro-resolver');
const createDefaultContext = appRequire(
  'metro-resolver/src/createDefaultContext'
);
const { transformSync } = appRequire('@babel/core');
const config = require('../example/metro.config');

// Use Metro's resolver with the example's configuration and installed packages.
function resolveModule(resolver, originModulePath, moduleName, platform) {
  const lookup = (filename) => {
    const blocked = [resolver.blockList].flat().filter(Boolean);
    if (blocked.some((pattern) => pattern.test(filename)))
      return { exists: false };
    try {
      const stat = fs.statSync(filename);
      return {
        exists: true,
        type: stat.isDirectory() ? 'd' : 'f',
        realPath: fs.realpathSync(filename),
      };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
        return { exists: false };
      throw error;
    }
  };
  const getPackage = (filename) =>
    lookup(filename).type === 'f'
      ? JSON.parse(fs.readFileSync(filename, 'utf8'))
      : null;
  const context = createDefaultContext({
    ...resolver,
    originModulePath,
    allowHaste: false,
    assetExts: new Set(resolver.assetExts),
    mainFields: resolver.resolverMainFields,
    preferNativePlatform: true,
    doesFileExist: (filename) => lookup(filename).type === 'f',
    unstable_fileSystemLookup: lookup,
    getPackage,
    getPackageForModule(filename) {
      let directory = path.dirname(filename);
      while (directory !== path.dirname(directory)) {
        const packageJson = getPackage(path.join(directory, 'package.json'));
        if (packageJson)
          return {
            rootPath: directory,
            packageJson,
            packageRelativePath: path.relative(directory, filename),
          };
        if (path.basename(directory) === 'node_modules') break;
        directory = path.dirname(directory);
      }
      return null;
    },
    unstable_logWarning: (message) => assert.fail(message),
  });
  return resolve(context, moduleName, platform).filePath;
}

function loadViewRegistry() {
  const filename = appRequire.resolve(
    'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry'
  );
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    babelrc: false,
    configFile: false,
    presets: [appRequire.resolve('@babel/preset-flow')],
    plugins: [appRequire.resolve('@babel/plugin-transform-modules-commonjs')],
  });
  const exports = {};
  vm.runInNewContext(code, { exports, require: appRequire, __DEV__: true });
  return exports;
}

for (const platform of ['ios', 'android']) {
  test(`${platform}: app and workspace adapter register RNNModalViewManager once`, () => {
    const appEntry = resolveModule(
      config.resolver,
      path.join(appRoot, 'src/RNNApp.tsx'),
      'react-native-navigation',
      platform
    );
    const adapterEntry = resolveModule(
      config.resolver,
      path.join(
        root,
        'packages/react-native-navigation/src/FTRumReactNativeNavigationTracking.ts'
      ),
      'react-native-navigation',
      platform
    );
    const registry = loadViewRegistry();
    const loaded = new Set();
    const registrations = [];
    // Evaluate the real Modal module from both resolved packages, using Metro's
    // per-filename module cache and RN's real duplicate-registration check.
    for (const entry of [appEntry, adapterEntry]) {
      const filename = path.join(path.dirname(entry), 'components/Modal.js');
      if (loaded.has(filename)) continue;
      loaded.add(filename);
      vm.runInNewContext(
        fs.readFileSync(filename, 'utf8'),
        {
          exports: {},
          require(name) {
            if (name !== 'react-native') return appRequire(name);
            return {
              requireNativeComponent(viewName) {
                registrations.push(viewName);
                return registry.register(viewName, () => ({}));
              },
              Dimensions: { get: () => ({ height: 800 }) },
              StyleSheet: { create: (styles) => styles },
            };
          },
        },
        { filename }
      );
    }
    assert.deepEqual(registrations, ['RNNModalViewManager']);
    const expected = appRequire.resolve('react-native-navigation');
    assert.equal(appEntry, expected);
    assert.equal(adapterEntry, expected);
  });
}

for (const directory of ['example', 'example-new-architecture']) {
  test(`${directory}: Session Replay uses the app's React and native view registry`, () => {
    const exampleRoot = path.join(root, directory);
    const { resolver } = require(path.join(exampleRoot, 'metro.config.js'));
    const origin = path.join(
      root,
      'packages/react-native-session-replay/src/index.tsx'
    );
    const exampleRequire = createRequire(path.join(exampleRoot, 'package.json'));
    for (const name of [
      'react',
      'react-native',
      'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry',
    ]) {
      for (const platform of ['android', 'ios']) {
        assert.equal(
          resolveModule(resolver, origin, name, platform),
          exampleRequire.resolve(name)
        );
      }
    }
  });
}
