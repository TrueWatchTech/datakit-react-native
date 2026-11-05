const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const commonRequiredFiles = [
  'package.json',
  'lib/commonjs/index.js',
  'lib/module/index.js',
  'lib/typescript/index.d.ts',
];
const packages = [
  {
    directory: 'react-native-mobile',
    name: '@truewatchtech/react-native-mobile',
    requiredFiles: [
      ...commonRequiredFiles,
      'src/index.tsx',
      'FTMobileReactNativeSDK.podspec',
    ],
    requiresNativeSource: true,
  },
  {
    directory: 'react-native-session-replay',
    name: '@truewatchtech/react-native-session-replay',
    requiredFiles: [
      ...commonRequiredFiles,
      'src/index.tsx',
      'FTSessionReplayReactNative.podspec',
    ],
    requiresNativeSource: true,
  },
  {
    directory: 'react-native-babel-plugin',
    name: '@truewatchtech/react-native-mobile-babel-plugin',
    requiredFiles: [...commonRequiredFiles, 'src/index.ts', 'README.md'],
    requiresNativeSource: false,
  },
  {
    directory: 'react-navigation',
    name: '@truewatchtech/mobile-react-navigation',
    requiredFiles: [
      ...commonRequiredFiles,
      'README.md',
      'src/index.ts',
      'src/FTRumReactNavigationTracking.ts',
      'lib/commonjs/FTRumReactNavigationTracking.js',
      'lib/module/FTRumReactNavigationTracking.js',
      'lib/typescript/FTRumReactNavigationTracking.d.ts',
    ],
    requiresNativeSource: false,
  },
  {
    directory: 'react-native-navigation',
    name: '@truewatchtech/mobile-react-native-navigation',
    requiredFiles: [
      ...commonRequiredFiles,
      'README.md',
      'src/index.ts',
      'src/FTRumReactNativeNavigationTracking.ts',
      'lib/commonjs/FTRumReactNativeNavigationTracking.js',
      'lib/module/FTRumReactNativeNavigationTracking.js',
      'lib/typescript/FTRumReactNativeNavigationTracking.d.ts',
    ],
    requiresNativeSource: false,
  },
];
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|hotfix)(?:[.-][0-9A-Za-z-]+)*)?$/;
const run = (args, capture = false) =>
  execFileSync(args[0], args.slice(1), {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function validateWorkspace(version) {
  if (
    read('package.json').private !== true ||
    read('lerna.json').version !== version
  )
    throw new Error('Workspace identity or version mismatch');
  for (const { directory, name } of packages) {
    const pkg = read(`packages/${directory}/package.json`);
    if (
      pkg.name !== name ||
      pkg.version !== version ||
      pkg.private ||
      pkg.repository.url !==
        'git+https://github.com/TrueWatchTech/datakit-react-native.git' ||
      pkg.publishConfig.registry !== 'https://registry.npmjs.org/'
    )
      throw new Error(`Package identity mismatch: ${name}`);
  }
}

function releaseIdentity() {
  const tag = process.env.GITHUB_REF_NAME || '';
  const version = tag.replace(/^agent_v?/, '');
  if (
    process.env.GITHUB_REF_TYPE !== 'tag' ||
    !tag.startsWith('agent_') ||
    !versionPattern.test(version)
  ) {
    throw new Error('Expected an agent_<version> release tag');
  }
  if (process.env.GITHUB_REPOSITORY !== 'TrueWatchTech/datakit-react-native') {
    throw new Error('Unexpected publishing repository');
  }
  const sha = run(['git', 'rev-parse', 'HEAD'], true).trim();
  if (process.env.GITHUB_SHA !== sha) {
    throw new Error('Workflow commit does not match checkout');
  }
  if (
    run(['git', 'rev-parse', `refs/tags/${tag}^{commit}`], true).trim() !== sha
  ) {
    throw new Error('Release tag does not match checkout');
  }
  validateWorkspace(version);
  const npm = run(['npm', '--version'], true).trim().split('.').map(Number);
  if (
    npm[0] < 11 ||
    (npm[0] === 11 && (npm[1] < 5 || (npm[1] === 5 && npm[2] < 1)))
  ) {
    throw new Error('npm >= 11.5.1 is required for Trusted Publishing');
  }
  return { version, sha, channel: versionPattern.exec(version)[4] || 'latest' };
}

async function metadata(name, version) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}${
      version === undefined ? '' : `/${encodeURIComponent(version)}`
    }`,
    {
      signal: AbortSignal.timeout(30000),
      headers: { 'Cache-Control': 'no-cache' },
    }
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`npm registry returned HTTP ${response.status}`);
  const value = await response.json();
  if (
    value.name !== name ||
    (version !== undefined && value.version !== version)
  )
    throw new Error(`Unexpected npm response for ${name}`);
  return value;
}

async function publishPreparedPackages(
  ready,
  { version, channel },
  options = {}
) {
  const runCommand = options.runCommand || run;

  // Successful npm commands complete publishing; registry propagation is asynchronous.
  for (const [name, tarball] of ready) {
    runCommand([
      'npm',
      'publish',
      tarball,
      '--access',
      'public',
      '--tag',
      channel,
      '--ignore-scripts',
    ]);
    console.log(`${name}@${version} published successfully`);
  }
}

function preparePackages({ version, sha }, output) {
  const ready = [];
  // Build dependencies even when their version was published by an earlier run.
  for (const {
    directory,
    name,
    requiredFiles,
    requiresNativeSource,
  } of packages) {
    const file = `packages/${directory}/package.json`;
    const original = fs.readFileSync(file, 'utf8');
    const tarball = path.join(output, `${directory}.tgz`);
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({ ...JSON.parse(original), gitHead: sha }, null, 2) +
          '\n'
      );
      run(['yarn', 'workspace', name, 'pack', '--out', tarball]);
    } finally {
      fs.writeFileSync(file, original);
    }
    const listing = run(['tar', '-tzf', tarball], true).split('\n');
    for (const required of requiredFiles) {
      if (!listing.includes(`package/${required}`))
        throw new Error(`Missing ${required} in ${name}`);
    }
    if (
      requiresNativeSource &&
      (!listing.some((p) => p.startsWith('package/android/')) ||
        !listing.some((p) => p.startsWith('package/ios/')))
    ) {
      throw new Error(`Missing native source in ${name}`);
    }
    const manifest = JSON.parse(
      run(['tar', '-xOf', tarball, 'package/package.json'], true)
    );
    if (
      manifest.name !== name ||
      manifest.version !== version ||
      manifest.gitHead !== sha
    )
      throw new Error(`Packed package identity mismatch: ${name}`);
    ready.push([name, tarball]);
  }
  return ready;
}

function verifyPackages() {
  const version = read('lerna.json').version;
  validateWorkspace(version);
  const sha = run(['git', 'rev-parse', 'HEAD'], true).trim();
  const output = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'rn-npm-')
  );
  try {
    preparePackages({ version, sha }, output);
    console.log(`All release packages verified: ${version}, commit ${sha}`);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}

async function publish({ version, sha, channel }) {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error('GitHub Actions OIDC credentials are required');
  }
  // Never fall back to a long-lived npm token on the publishing path.
  for (const variable of [
    'NODE_AUTH_TOKEN',
    'NPM_TOKEN',
    'YARN_NPM_AUTH_TOKEN',
  ])
    delete process.env[variable];
  const output = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'rn-npm-')
  );
  try {
    const prepared = preparePackages({ version, sha }, output);
    const ready = [];
    // Finish all registry checks before uploading the first package.
    for (const [name, tarball] of prepared) {
      const old = await metadata(name, version);
      if (old && old.gitHead !== sha)
        throw new Error(`${name}@${version} already belongs to another commit`);
      if (old) {
        console.log(
          `${name}@${version} already published from ${sha}; skipping`
        );
        continue;
      }
      if (!(await metadata(name)))
        throw new Error(
          `${name} does not exist on npm; complete its initial publication and configure its Trusted Publisher for publish.yml / npm-publish before pushing a release tag`
        );
      ready.push([name, tarball]);
    }
    await publishPreparedPackages(ready, { version, sha, channel });
    console.log(
      `All npm packages published: ${version} (${channel}), commit ${sha}`
    );
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}

async function main() {
  const mode = process.argv[2];
  if (!['check', 'pack', 'publish'].includes(mode))
    throw new Error('Usage: node scripts/publish-npm.cjs check|pack|publish');
  if (mode === 'pack') return verifyPackages();
  const identity = releaseIdentity();
  console.log(`Release identity: ${JSON.stringify(identity)}`);
  if (mode === 'publish') await publish(identity);
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = {
  packages,
  versionPattern,
  releaseIdentity,
  metadata,
  publishPreparedPackages,
  preparePackages,
};
