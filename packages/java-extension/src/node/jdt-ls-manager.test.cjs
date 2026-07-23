// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the JdtLsManager. We do NOT spawn a real
// JDT LS (no fixture jar in CI); instead we exercise:
//   - resolveDistribution() with the env var set / missing / wrong
//   - the JdtLsState machine and the log ring buffer

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { JdtLsManager, JdtLsRequestTimeoutError } = require('../../lib/node/jdt-ls-manager');

test('resolveDistribution: returns a friendly error when KAIRO_JDT_LS_HOME is missing', () => {
  const saved = process.env.KAIRO_JDT_LS_HOME;
  delete process.env.KAIRO_JDT_LS_HOME;
  try {
    const r = JdtLsManager.resolveDistribution({});
    assert.equal('kind' in r, true);
    if ('kind' in r) {
      assert.match(r.message, /KAIRO_JDT_LS_HOME/);
    }
  } finally {
    if (saved !== undefined) process.env.KAIRO_JDT_LS_HOME = saved;
  }
});

test('resolveDistribution: returns a friendly error when home path does not exist', () => {
  const saved = process.env.KAIRO_JDT_LS_HOME;
  process.env.KAIRO_JDT_LS_HOME = path.join(os.tmpdir(), 'kairo-jdt-ls-missing-' + Date.now());
  try {
    const r = JdtLsManager.resolveDistribution({});
    assert.equal('kind' in r, true);
    if ('kind' in r) {
      assert.match(r.message, /does not exist/);
    }
  } finally {
    if (saved !== undefined) process.env.KAIRO_JDT_LS_HOME = saved;
    else delete process.env.KAIRO_JDT_LS_HOME;
  }
});

test('resolveDistribution: returns a friendly error when the plugins directory is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-jdt-ls-'));
  const saved = process.env.KAIRO_JDT_LS_HOME;
  process.env.KAIRO_JDT_LS_HOME = tmp;
  try {
    const r = JdtLsManager.resolveDistribution({});
    assert.equal('kind' in r, true);
    if ('kind' in r) {
      assert.match(r.message, /plugins/);
    }
  } finally {
    if (saved !== undefined) process.env.KAIRO_JDT_LS_HOME = saved;
    else delete process.env.KAIRO_JDT_LS_HOME;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveDistribution: returns a friendly error when no Equinox launcher is found', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-jdt-ls-'));
  fs.mkdirSync(path.join(tmp, 'plugins'));
  fs.writeFileSync(path.join(tmp, 'plugins', 'not-the-launcher.jar'), 'x');
  const saved = process.env.KAIRO_JDT_LS_HOME;
  process.env.KAIRO_JDT_LS_HOME = tmp;
  try {
    const r = JdtLsManager.resolveDistribution({});
    assert.equal('kind' in r, true);
    if ('kind' in r) {
      assert.match(r.message, /Equinox launcher/);
    }
  } finally {
    if (saved !== undefined) process.env.KAIRO_JDT_LS_HOME = saved;
    else delete process.env.KAIRO_JDT_LS_HOME;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveDistribution: resolves a complete install when all pieces are present', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-jdt-ls-'));
  const jre = path.join(tmp, 'fake-jre');
  fs.mkdirSync(path.join(tmp, 'plugins'));
  fs.writeFileSync(path.join(tmp, 'plugins', 'org.eclipse.equinox.launcher_1.6.0.jar'), 'x');
  // pickConfigDir prefers platform-specific dir
  // (config_win on Windows, config_mac on macOS,
  // config_linux elsewhere).
  const cfgDirName =
    process.platform === 'win32'
      ? 'config_win'
      : process.platform === 'darwin'
        ? 'config_mac'
        : 'config_linux';
  fs.mkdirSync(path.join(tmp, cfgDirName));
  // Lay out a fake JRE so the JRE existence check passes
  // (we never actually exec the binary).
  fs.mkdirSync(path.join(jre, 'bin'), { recursive: true });
  const javaName = process.platform === 'win32' ? 'java.exe' : 'java';
  fs.writeFileSync(path.join(jre, 'bin', javaName), '');
  const savedHome = process.env.KAIRO_JDT_LS_HOME;
  const savedJre = process.env.KAIRO_JDT_LS_JRE;
  process.env.KAIRO_JDT_LS_HOME = tmp;
  process.env.KAIRO_JDT_LS_JRE = jre;
  try {
    const r = JdtLsManager.resolveDistribution({});
    assert.equal('kind' in r, false, 'expected a valid distribution, got: ' + JSON.stringify(r));
    if (!('kind' in r)) {
      assert.match(r.launcherJar, /equinox\.launcher_1\.6\.0\.jar$/);
      assert.equal(r.configDir, path.join(tmp, cfgDirName));
      assert.equal(r.pluginJars.length, 1);
    }
  } finally {
    if (savedHome !== undefined) process.env.KAIRO_JDT_LS_HOME = savedHome; else delete process.env.KAIRO_JDT_LS_HOME;
    if (savedJre !== undefined) process.env.KAIRO_JDT_LS_JRE = savedJre; else delete process.env.KAIRO_JDT_LS_JRE;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('JdtLsManager: starts in uninitialized', () => {
  const m = new JdtLsManager();
  assert.equal(m.state$(), 'uninitialized');
  m.dispose();
});

test('resolveDistribution: native launcher FRAGMENT jars are not picked as the launcher (KAIRO-RC-WEB-251)', () => {
  // readdir order can return the native fragment
  // (org.eclipse.equinox.launcher.cocoa.macosx.aarch64_*.jar)
  // before the real launcher — spawning with it dies with
  // "no main manifest attribute".
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-jdt-ls-'));
  const jre = path.join(tmp, 'fake-jre');
  fs.mkdirSync(path.join(tmp, 'plugins'));
  // Fragment FIRST (alphabetical-ish order fooled the old regex).
  fs.writeFileSync(path.join(tmp, 'plugins', 'org.eclipse.equinox.launcher.cocoa.macosx.aarch64_1.2.1400.jar'), 'x');
  fs.writeFileSync(path.join(tmp, 'plugins', 'org.eclipse.equinox.launcher_1.7.100.jar'), 'x');
  const cfgDirName =
    process.platform === 'win32'
      ? 'config_win'
      : process.platform === 'darwin'
        ? (process.arch === 'arm64' ? 'config_mac_arm' : 'config_mac')
        : 'config_linux';
  fs.mkdirSync(path.join(tmp, cfgDirName));
  fs.mkdirSync(path.join(jre, 'bin'), { recursive: true });
  const javaName = process.platform === 'win32' ? 'java.exe' : 'java';
  fs.writeFileSync(path.join(jre, 'bin', javaName), '');
  const savedHome = process.env.KAIRO_JDT_LS_HOME;
  const savedJre = process.env.KAIRO_JDT_LS_JRE;
  process.env.KAIRO_JDT_LS_HOME = tmp;
  process.env.KAIRO_JDT_LS_JRE = jre;
  try {
    const r = JdtLsManager.resolveDistribution({});
    assert.equal('kind' in r, false, 'expected a valid distribution, got: ' + JSON.stringify(r));
    if (!('kind' in r)) {
      assert.match(r.launcherJar, /equinox\.launcher_1\.7\.100\.jar$/, 'must pick the real launcher, not the native fragment');
      assert.equal(r.configDir, path.join(tmp, cfgDirName), 'arm64 hosts must use the *_arm config dir');
    }
  } finally {
    if (savedHome !== undefined) process.env.KAIRO_JDT_LS_HOME = savedHome; else delete process.env.KAIRO_JDT_LS_HOME;
    if (savedJre !== undefined) process.env.KAIRO_JDT_LS_JRE = savedJre; else delete process.env.KAIRO_JDT_LS_JRE;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('JdtLsManager: appendLog and recentLogs round-trip', () => {
  const m = new JdtLsManager();
  m.appendLog('stdout', 'hello');
  m.appendLog('stderr', 'world');
  const logs = m.recentLogs();
  assert.equal(logs.length, 2);
  assert.equal(logs[0].line, 'hello');
  assert.equal(logs[1].line, 'world');
  m.dispose();
});

test('JdtLsManager: log ring is bounded at 500 lines', () => {
  const m = new JdtLsManager();
  for (let i = 0; i < 600; i++) {
    m.appendLog('stdout', `line ${i}`);
  }
  const logs = m.recentLogs();
  assert.equal(logs.length, 500);
  assert.equal(logs[0].line, 'line 100');
  assert.equal(logs[499].line, 'line 599');
  m.dispose();
});

test('JdtLsManager: state events fire on transition, not on duplicate', () => {
  const m = new JdtLsManager();
  const events = [];
  m.onEvent((e) => {
    if (e.kind === 'state') events.push(e.state);
  });
  m.setState('starting');
  m.setState('ready');
  m.setState('ready'); // duplicate
  assert.deepEqual(events, ['starting', 'ready']);
  m.dispose();
});

test('JdtLsManager: stop from crashed state with no child is immediate', async () => {
  const m = new JdtLsManager();
  m.setState('crashed');
  const startedAt = Date.now();
  await m.stop();
  assert.equal(m.state$(), 'stopped');
  assert.ok(Date.now() - startedAt < 100, 'must not wait for the 3s process grace period');
  m.dispose();
});

test('JdtLsManager: stop escalates to SIGKILL when SIGTERM was sent but process has not exited', async () => {
  const m = new JdtLsManager();
  const signals = [];
  const child = {
    killed: false,
    kill(signal) {
      signals.push(signal);
      this.killed = true;
      return true;
    },
    once() {
      return this;
    },
  };
  m.process = child;
  m.setState('ready');
  m.stopGracePeriodMs = () => 0;
  m.stopKillWaitMs = () => 0;

  await m.stop();
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  m.process = undefined;
  m.dispose();
});

test('JdtLsManager: concurrent stop callers share one bounded operation', async () => {
  const m = new JdtLsManager();
  const signals = [];
  const child = {
    killed: false,
    kill(signal) { signals.push(signal); this.killed = true; return true; },
    once() { return this; },
  };
  m.process = child;
  m.setState('ready');
  m.stopGracePeriodMs = () => 0;
  m.stopKillWaitMs = () => 0;

  const first = m.stop();
  const second = m.stop();
  assert.equal(first, second);
  await first;
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(m.state$(), 'stopped');
  m.dispose();
});

test('JdtLsManager: start is forbidden while a stop is in progress', async () => {
  const m = new JdtLsManager();
  m.setState('stopping');
  await assert.rejects(
    m.start({ rootUri: 'file:///repo', workspaceDataDir: '/tmp/ws' }),
    /already in state stopping/,
  );
  m.setState('stopped');
  m.dispose();
});

test('JdtLsManager: hung initialize is timed out, killed, and enters recoverable failed state', async () => {
  const m = new JdtLsManager();
  const signals = [];
  const child = { kill(signal) { signals.push(signal); return true; } };
  m.process = child;
  m.connection = {
    sendRequest: () => new Promise(() => {}),
    dispose() {},
  };
  m.setState('initializing');
  m.initializeTimeoutMs = () => 0;

  await assert.rejects(
    m.initializeConnection({ rootUri: 'file:///repo', processId: 1, capabilities: {} }, child),
    err => err instanceof JdtLsRequestTimeoutError && err.method === 'initialize',
  );
  assert.deepEqual(signals, ['SIGKILL']);
  assert.equal(m.state$(), 'failed');
  m.dispose();
});

test('JdtLsManager: hung semantic request has a hard timeout and crashes the unresponsive child', async () => {
  const m = new JdtLsManager();
  const signals = [];
  const child = { kill(signal) { signals.push(signal); return true; } };
  m.process = child;
  m.connection = {
    sendRequest: () => new Promise(() => {}),
    dispose() {},
  };
  m.setState('ready');
  m.requestTimeoutMs = () => 0;

  await assert.rejects(
    m.hover({ uri: 'file:///repo/A.java', line: 0, character: 0 }),
    err => err instanceof JdtLsRequestTimeoutError && err.method === 'textDocument/hover',
  );
  assert.deepEqual(signals, ['SIGKILL']);
  assert.equal(m.state$(), 'crashed');
  assert.ok(m.recentLogs().some(entry => entry.line.includes('[timeout]')));
  m.dispose();
});
