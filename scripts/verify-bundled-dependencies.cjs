#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const PLATFORM_MAP = {
  linux: { lock: 'linux', config: 'config_linux/config.ini', tomcatScript: 'bin/catalina.sh' },
  darwin: { lock: 'macos', config: 'config_mac/config.ini', tomcatScript: 'bin/catalina.sh' },
  win32: { lock: 'windows', config: 'config_win/config.ini', tomcatScript: 'bin/catalina.bat' }
};
const requestedPlatform = option('--platform') || process.platform;
const platform = PLATFORM_MAP[requestedPlatform];
if (!platform) {
  console.error(`[bundled] unsupported platform: ${requestedPlatform}`);
  process.exit(2);
}
const BUNDLED = path.resolve(option('--bundled-root') || path.join(ROOT, 'bundled'));
const LOCK = JSON.parse(fs.readFileSync(path.join(__dirname, 'supply-chain-lock.json'), 'utf8'));
const report = { ok: true, checkedAt: new Date().toISOString(), platform: requestedPlatform, dependencies: {} };

function present(file) {
  try { return fs.statSync(file).isFile() && fs.statSync(file).size > 0; } catch { return false; }
}

function record(id, root, required, extra = {}) {
  const missing = required.filter(relative => !present(path.join(root, relative)));
  const result = { root: path.relative(ROOT, root), required, missing, ok: missing.length === 0, ...extra };
  report.dependencies[id] = result;
  if (!result.ok) report.ok = false;
}

const tomcatId = `tomcat6-${platform.lock}`;
const jdtId = `jdtls-${platform.lock}`;
const tomcatLock = LOCK.dependencies[tomcatId];
const jdtLock = LOCK.dependencies[jdtId];
if (!tomcatLock || !jdtLock) {
  console.error(`[bundled] lock entries ${tomcatId} and ${jdtId} are required`);
  process.exit(2);
}
const tomcatRoot = path.join(BUNDLED, 'tomcat6', `apache-tomcat-${tomcatLock.version}`);
record(tomcatId, tomcatRoot, [
  'bin/bootstrap.jar', 'lib/catalina.jar', platform.tomcatScript, ...tomcatLock.licenseFiles
], { version: tomcatLock.version, license: tomcatLock.license });

const jdtRoot = path.join(BUNDLED, 'jdtls');
const launcherPattern = /^org\.eclipse\.equinox\.launcher_.*\.jar$/;
let launcher;
let coreVersion;
try {
  const plugins = fs.readdirSync(path.join(jdtRoot, 'plugins'));
  launcher = plugins.find(name => launcherPattern.test(name));
  const core = plugins.find(name => /^org\.eclipse\.jdt\.ls\.core_.*\.jar$/.test(name));
  coreVersion = core && core.match(/^org\.eclipse\.jdt\.ls\.core_(\d+\.\d+\.\d+)/)?.[1];
} catch {}
const jdtRequired = [platform.config, ...jdtLock.licenseFiles];
const versionMatches = coreVersion === jdtLock.version;
record(jdtId, jdtRoot, jdtRequired, {
  version: jdtLock.version,
  detectedVersion: coreVersion || null,
  versionMatches,
  license: jdtLock.license,
  launcher: launcher || null,
  ok: launcher !== undefined && versionMatches && jdtRequired.every(relative => present(path.join(jdtRoot, relative)))
});
if (!launcher || !versionMatches) report.ok = false;

const json = JSON.stringify(report, null, 2);
if (process.argv.includes('--json')) console.log(json);
else {
  for (const [id, result] of Object.entries(report.dependencies)) {
    console.log(`[bundled] ${result.ok ? 'OK' : 'FAIL'} ${id} ${result.version} (${result.root})`);
    if (!result.launcher && id.startsWith('jdtls-')) console.error('[bundled] missing Eclipse Equinox launcher JAR');
    if (id.startsWith('jdtls-') && !result.versionMatches) {
      console.error(`[bundled] JDT LS version mismatch: expected ${result.version}, detected ${result.detectedVersion || 'unknown'}`);
    }
    for (const file of result.missing) console.error(`[bundled] missing or empty: ${path.join(result.root, file)}`);
  }
}
process.exit(report.ok ? 0 : 1);
