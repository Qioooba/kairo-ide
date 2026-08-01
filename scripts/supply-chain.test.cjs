'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
require('../tests/setup-tmp.cjs'); // KAIRO_TMP override
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const SCRIPT = path.join(__dirname, 'fetch-verified-archive.cjs');

// invoke sets the canonical (platform-suffixed) env var declared in
// supply-chain-lock.json. The legacy platform-agnostic form
// (KAIRO_TOMCAT6_SHA256) is also cleared to ensure no test pollution.
function invoke(archive, value) {
  const env = { ...process.env };
  delete env.KAIRO_TOMCAT6_SHA256;
  delete env.KAIRO_TOMCAT6_LINUX_SHA256;
  delete env.KAIRO_TOMCAT6_MACOS_SHA256;
  delete env.KAIRO_TOMCAT6_WINDOWS_SHA256;
  if (value !== undefined) {
    env.KAIRO_TOMCAT6_LINUX_SHA256 = value;
  }
  return spawnSync(process.execPath, [SCRIPT, '--id', 'tomcat6-linux', '--archive', archive], {
    env,
    encoding: 'utf8',
    timeout: 5_000
  });
}

// invokeLegacy sets only the legacy platform-agnostic env var to verify
// the backward-compatibility fallback path in fetch-verified-archive.cjs.
function invokeLegacy(archive, value) {
  const env = { ...process.env };
  delete env.KAIRO_TOMCAT6_SHA256;
  delete env.KAIRO_TOMCAT6_LINUX_SHA256;
  delete env.KAIRO_TOMCAT6_MACOS_SHA256;
  delete env.KAIRO_TOMCAT6_WINDOWS_SHA256;
  if (value !== undefined) {
    env.KAIRO_TOMCAT6_SHA256 = value;
  }
  return spawnSync(process.execPath, [SCRIPT, '--id', 'tomcat6-linux', '--archive', archive], {
    env,
    encoding: 'utf8',
    timeout: 5_000
  });
}

test('accepts a local archive only when its configured SHA-256 matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-supply-'));
  const archive = path.join(dir, 'archive.tar.gz');
  fs.writeFileSync(archive, 'fixture: not a distributable dependency');
  const expected = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const result = invoke(archive, expected);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified tomcat6-linux 6\.0\.53/);
});

test('accepts the legacy KAIRO_TOMCAT6_SHA256 env var via fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-supply-legacy-'));
  const archive = path.join(dir, 'archive.tar.gz');
  fs.writeFileSync(archive, 'fixture: legacy env var fallback path');
  const expected = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const result = invokeLegacy(archive, expected);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified tomcat6-linux 6\.0\.53/);
});

test('fails closed when checksum configuration is missing', () => {
  const result = invoke(__filename, undefined);
  assert.equal(result.status, 1);
  // Error message uses the canonical (platform-suffixed) env var name
  // declared in supply-chain-lock.json.
  assert.match(result.stderr, /KAIRO_TOMCAT6_LINUX_SHA256 is required/);
});

test('rejects placeholders and malformed checksum values', () => {
  for (const value of ['PLACEHOLDER_UPDATE_BEFORE_RELEASE', 'abc123']) {
    const result = invoke(__filename, value);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /placeholder|64 hexadecimal/);
  }
});

test('rejects a checksum mismatch', () => {
  const result = invoke(__filename, '0'.repeat(64));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA-256 mismatch/);
});

test('JDT LS configuration requires an explicit approved HTTPS URL', () => {
  const env = {
    ...process.env,
    KAIRO_JDTLS_SHA256: '1'.repeat(64),
    KAIRO_JDTLS_ARCHIVE_URL: ''
  };
  const result = spawnSync(process.execPath, [SCRIPT, '--id', 'jdtls-linux', '--check-config'], {
    env, encoding: 'utf8', timeout: 5_000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /KAIRO_JDTLS_ARCHIVE_URL is required/);
});

test('Windows archive configuration fails closed when real values are absent', () => {
  const env = { ...process.env };
  delete env.KAIRO_TOMCAT6_WINDOWS_ARCHIVE_URL;
  delete env.KAIRO_TOMCAT6_WINDOWS_SHA256;
  const result = spawnSync(process.execPath, [SCRIPT, '--id', 'tomcat6-windows', '--check-config'], {
    env, encoding: 'utf8', timeout: 5_000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /KAIRO_TOMCAT6_WINDOWS_SHA256 is required/);
});

test('bundled verifier selects platform-specific lock ids and JDT config', () => {
  const verifier = path.join(__dirname, 'verify-bundled-dependencies.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-bundled-platform-'));
  const cases = [
    ['linux', 'tomcat6-linux', 'jdtls-linux', 'config_linux/config.ini'],
    ['darwin', 'tomcat6-macos', 'jdtls-macos', 'config_mac/config.ini'],
    ['win32', 'tomcat6-windows', 'jdtls-windows', 'config_win/config.ini']
  ];
  for (const [platform, tomcatId, jdtId, config] of cases) {
    const result = spawnSync(process.execPath, [verifier, '--platform', platform, '--bundled-root', root, '--json'], {
      encoding: 'utf8', timeout: 5_000
    });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(report.dependencies), [tomcatId, jdtId]);
    assert.ok(report.dependencies[jdtId].required.includes(config));
  }
});

test('PowerShell strict packaging targets bundled/jdtls and invokes Windows gates', () => {
  const source = fs.readFileSync(path.join(__dirname, 'prepare-bundled.ps1'), 'utf8');
  assert.match(source, /Ensure-BundledDir "tomcat6\/apache-tomcat-6\.0\.53"/);
  assert.match(source, /Ensure-BundledDir "jdtls"/);
  assert.match(source, /fetch-verified-archive\.cjs[\s\S]*--check-config/);
  assert.match(source, /verify-bundled-dependencies\.cjs[\s\S]*--platform win32/);
});

test('Windows package and smoke paths enforce strict preparation before copying artifacts', () => {
  const desktop = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'desktop', 'package.json'), 'utf8'));
  assert.match(desktop.scripts['build:win'], /@kairo\/browser build[\s\S]*prepare-bundled\.ps1 -Strict -BundledRoot apps\/desktop\/bundled/);
  assert.match(desktop.scripts['build:win'], /build-agent\.js[\s\S]*copy-browser-artifacts\.js --strict/);
  assert.doesNotMatch(desktop.scripts['build:win'], /copy-bundled\.js/);

  const ci = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const windowsJob = ci.slice(ci.indexOf('desktop-smoke-windows:'), ci.indexOf('desktop-smoke-macos:'));
  assert.match(windowsJob, /prepare-bundled\.ps1 -Strict/);
  assert.match(windowsJob, /run-with-timeout\.cjs 300 pnpm build/);
  assert.ok(
    windowsJob.indexOf('run-with-timeout.cjs 300 pnpm build') < windowsJob.indexOf('prepare-bundled.ps1 -Strict'),
    'strict Windows staging must be the final writer after the generic build/prebuild path'
  );
});

test('desktop packaging copies only approved bundled dependency directories', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps', 'desktop', 'scripts', 'copy-bundled.js'), 'utf8');
  assert.match(source, /approvedDirectories = \['tomcat6', 'jdtls'\]/);
  assert.doesNotMatch(source, /realDirs = entries\.filter/);
});

test('strict browser artifact copy rejects missing inputs and clears stale outputs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps', 'desktop', 'scripts', 'copy-browser-artifacts.js'), 'utf8');
  assert.match(source, /STRICT = process\.argv\.includes\('--strict'\)/);
  assert.match(source, /strict mode requires a non-empty browser build output/);
  assert.match(source, /fs\.rmSync\(DESKTOP_FRONTEND_DST/);
  assert.match(source, /fs\.rmSync\(DESKTOP_BACKEND_DST/);
});

test('PowerShell strict preparation uses isolated verified archives and always cleans temporary files', () => {
  const source = fs.readFileSync(path.join(__dirname, 'prepare-bundled.ps1'), 'utf8');
  assert.match(source, /if \(\$Strict\) \{\s*\$temporaryRoot[\s\S]*Get-VerifiedArchiveSource "tomcat6-windows"/);
  assert.match(source, /Get-VerifiedArchiveSource "jdtls-windows"/);
  assert.match(source, /--platform win32 --bundled-root \$bundled/);
  assert.match(source, /finally \{[\s\S]*Remove-Item -Path \$temporaryRoot/);
});

test('timeout runner enforces the 300 second policy boundary', () => {
  const runner = path.join(__dirname, 'run-with-timeout.cjs');
  const result = spawnSync(process.execPath, [runner, '301', process.execPath, '-e', 'process.exit(0)'], {
    encoding: 'utf8', timeout: 5_000
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /1 to 300 seconds/);
});

test('timeout runner terminates descendant processes', { timeout: 7_000 }, () => {
  const runner = path.join(__dirname, 'run-with-timeout.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-timeout-tree-'));
  const marker = path.join(dir, 'descendant-survived');
  const descendant = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad'), 1800)`;
  const parent = [
    "const {spawn}=require('node:child_process')",
    `spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'})`,
    "setInterval(()=>{},1000)"
  ].join(';');
  const result = spawnSync(process.execPath, [runner, '1', process.execPath, '-e', parent], {
    encoding: 'utf8', timeout: 5_000
  });
  assert.equal(result.status, 124, result.stderr);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  assert.equal(fs.existsSync(marker), false, 'a descendant survived the timeout process-group kill');
});

test('Windows taskkill watchdog forces exit 124 when taskkill hangs', async () => {
  const { WINDOWS_TASKKILL_WATCHDOG_MS, armWindowsTaskkillWatchdog } = require('./run-with-timeout.cjs');
  assert.equal(WINDOWS_TASKKILL_WATCHDOG_MS, 5_000);
  const taskkill = new EventEmitter();
  let taskkillKilled = false;
  taskkill.kill = () => { taskkillKilled = true; };
  let childKilled = false;
  const child = { kill: () => { childKilled = true; } };
  const exitCode = await new Promise(resolve => {
    armWindowsTaskkillWatchdog(taskkill, child, resolve, 20);
  });
  assert.equal(exitCode, 124);
  assert.equal(taskkillKilled, true);
  assert.equal(childKilled, true);
});
