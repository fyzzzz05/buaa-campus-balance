import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
if (!/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(version)) {
  console.error(`VERSION 格式不正确: ${version}`);
  process.exit(1);
}

// 1) icons are generated, never committed
const icons = spawnSync(process.execPath, [path.join(root, 'electron', 'make-icon.mjs')], {stdio: 'inherit', cwd: root});
if (icons.status !== 0) process.exit(icons.status || 1);

// 2) inject the single source of truth (VERSION) into the packaged metadata
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = {
  ...(pkg.build || {}),
  extraMetadata: {...(pkg.build?.extraMetadata || {}), version},
};
const configFile = path.join(root, 'build', 'electron-builder.generated.json');
fs.mkdirSync(path.dirname(configFile), {recursive: true});
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

// 3) run electron-builder through node so Windows and macOS behave the same
const cli = require.resolve('electron-builder/out/cli/cli.js');
const result = spawnSync(process.execPath, [cli, '--win', 'nsis', '--x64', '--config', configFile], {
  stdio: 'inherit',
  cwd: root,
  env: {...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false'},
});
fs.rmSync(configFile, {force: true});
process.exit(result.status === null ? 1 : result.status);
