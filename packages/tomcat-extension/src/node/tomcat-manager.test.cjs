// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the Tomcat 6 manager. We do NOT spawn a
// real catalina.bat; instead we stub child_process.spawn
// with a tiny Node script that:
//   - prints "Server startup in 42 ms" after a short delay
//     (so the manager transitions to `running`)
//   - exits with code 0 when stdin/SIGTERM is received
//
// The shutdown-port path is exercised against a real
// localhost TCP server bound to a random port — the
// manager must succeed in posting "SHUTDOWN" to it.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const { spawn: realSpawn } = require('node:child_process');
const cp = require('node:child_process');

const { TomcatManager } = require('../../lib/node/tomcat-manager');

// Build a fake catalina script. The manager spawns
// catalina.bat via `cmd.exe /c <script> <args>` on Windows
// and `catalina.sh <args>` on POSIX. Our script just
// echoes the startup banner on demand and exits when
// killed. We then point the manager at it.
function makeFakeTomcatDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-tomcat-'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(root, 'logs'));
  const script = path.join(root, 'bin', process.platform === 'win32' ? 'catalina.bat' : 'catalina.sh');
  // The fake script:
  //   - prints INFO lines with a startup banner
  //   - stays alive (waits for stdin EOF or SIGTERM)
  //   - writes the received pid into logs/catalina.pid
  const body =
    process.platform === 'win32'
      ? '@echo off\r\n' +
        'echo INFO: Deploying web application directory\r\n' +
        'echo INFO: Server startup in 42 ms\r\n' +
        'ping 127.0.0.1 -n 60 > nul\r\n' +
        'exit /b 0\r\n'
      : '#!/bin/sh\n' +
        'echo "INFO: Deploying web application directory"\n' +
        'echo "INFO: Server startup in 42 ms"\n' +
        'trap "exit 0" TERM INT\n' +
        'sleep 60 &\n' +
        'wait\n';
  fs.writeFileSync(script, body);
  if (process.platform !== 'win32') {
    fs.chmodSync(script, 0o755);
  }
  return root;
}

function makeShutdownServer() {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      // Per Tomcat 6's shutdown protocol, when the client
      // sends "SHUTDOWN\r\n" we just close.
      let buf = '';
      sock.on('data', (c) => {
        buf += c.toString('utf-8');
        if (buf.includes('SHUTDOWN')) {
          sock.end();
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ srv, port });
    });
  });
}

test('TomcatManager.resolveHome: error when env var is missing', () => {
  const saved = process.env.KAIRO_TOMCAT6_HOME;
  delete process.env.KAIRO_TOMCAT6_HOME;
  try {
    const r = TomcatManager.resolveHome({});
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /KAIRO_TOMCAT6_HOME/);
    }
  } finally {
    if (saved !== undefined) process.env.KAIRO_TOMCAT6_HOME = saved;
  }
});

test('TomcatManager.resolveHome: error when home does not exist', () => {
  const saved = process.env.KAIRO_TOMCAT6_HOME;
  process.env.KAIRO_TOMCAT6_HOME = path.join(os.tmpdir(), 'kairo-tomcat-missing-' + Date.now());
  try {
    const r = TomcatManager.resolveHome({});
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /does not exist/);
    }
  } finally {
    if (saved !== undefined) process.env.KAIRO_TOMCAT6_HOME = saved;
    else delete process.env.KAIRO_TOMCAT6_HOME;
  }
});

test('TomcatManager.resolveHome: error when catalina script is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-tomcat-'));
  const saved = process.env.KAIRO_TOMCAT6_HOME;
  process.env.KAIRO_TOMCAT6_HOME = tmp;
  try {
    const r = TomcatManager.resolveHome({});
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /catalina/);
    }
  } finally {
    if (saved !== undefined) process.env.KAIRO_TOMCAT6_HOME = saved;
    else delete process.env.KAIRO_TOMCAT6_HOME;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('TomcatManager.resolveHome: success with a complete install', () => {
  const home = makeFakeTomcatDir();
  const saved = process.env.KAIRO_TOMCAT6_HOME;
  process.env.KAIRO_TOMCAT6_HOME = home;
  try {
    const r = TomcatManager.resolveHome({});
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.home, path.resolve(home));
    }
  } finally {
    if (saved !== undefined) process.env.KAIRO_TOMCAT6_HOME = saved;
    else delete process.env.KAIRO_TOMCAT6_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('TomcatManager: state starts at "stopped"', () => {
  const m = new TomcatManager();
  assert.equal(m.getState(), 'stopped');
  m.removeAllListeners();
});

test('TomcatManager: start() emits state transitions and a "ready" event', async () => {
  const home = makeFakeTomcatDir();
  const { port: shutdownPort } = await makeShutdownServer();
  const m = new TomcatManager();
  const events = [];
  m.on('event', (e) => events.push(e));
  try {
    const inst = await m.start({
      id: 'srv-test-1',
      projectId: 'proj-1',
      catalinaHome: home,
      httpPort: 8080,
      shutdownPort,
      jvm: { maxHeapMb: 256, permGenMb: 64 },
    });
    assert.equal(inst.id, 'srv-test-1');
    assert.equal(inst.httpPort, 8080);
    assert.equal(inst.shutdownPort, shutdownPort);
    // The state machine must have moved to `running` because
    // the fake script printed the banner.
    assert.equal(m.getState(), 'running');
    const stateEvents = events.filter((e) => e.kind === 'state').map((e) => e.state);
    assert.ok(stateEvents.includes('starting'), 'expected a "starting" state event');
    assert.ok(stateEvents.includes('running'), 'expected a "running" state event');
    const readyEvents = events.filter((e) => e.kind === 'ready');
    assert.equal(readyEvents.length, 1, 'expected exactly one ready event');
    assert.equal(readyEvents[0].httpPort, 8080);
    const logEvents = events.filter((e) => e.kind === 'log');
    assert.ok(logEvents.length > 0, 'expected log events to be emitted');
  } finally {
    await m.stop({ deadlineMs: 5_000 });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('TomcatManager: stop() sends SHUTDOWN to the configured port and exits the child', async () => {
  const home = makeFakeTomcatDir();
  const { srv: shutdownSrv, port: shutdownPort } = await makeShutdownServer();
  const m = new TomcatManager();
  // Track whether the shutdown server received "SHUTDOWN".
  let receivedShutdown = false;
  shutdownSrv.on('connection', (sock) => {
    let buf = '';
    sock.on('data', (c) => {
      buf += c.toString('utf-8');
      if (buf.includes('SHUTDOWN')) {
        receivedShutdown = true;
      }
    });
  });
  try {
    await m.start({
      id: 'srv-test-2',
      projectId: 'proj-2',
      catalinaHome: home,
      httpPort: 8081,
      shutdownPort,
    });
    assert.equal(m.getState(), 'running');
    await m.stop({ deadlineMs: 5_000 });
    assert.equal(m.getState(), 'stopped');
    assert.equal(receivedShutdown, true, 'expected the shutdown port to receive the SHUTDOWN command');
  } finally {
    shutdownSrv.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('TomcatManager: restart() stops and starts again', async () => {
  const home = makeFakeTomcatDir();
  const { port: shutdownPort } = await makeShutdownServer();
  const m = new TomcatManager();
  try {
    await m.start({ id: 'srv-test-3', projectId: 'proj-3', catalinaHome: home, httpPort: 8082, shutdownPort });
    assert.equal(m.getState(), 'running');
    await m.restart({ id: 'srv-test-3', projectId: 'proj-3', catalinaHome: home, httpPort: 8082, shutdownPort });
    assert.equal(m.getState(), 'running');
  } finally {
    await m.stop({ deadlineMs: 5_000 });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('TomcatManager: a start() against a missing install throws and sets state to "failed"', async () => {
  const m = new TomcatManager();
  await assert.rejects(
    () => m.start({ id: 'srv-test-4', projectId: 'proj-4', catalinaHome: path.join(os.tmpdir(), 'kairo-tomcat-missing-' + Date.now()), httpPort: 8083, shutdownPort: 8005 }),
    /KAIRO_TOMCAT6_HOME|does not exist/,
  );
  assert.equal(m.getState(), 'failed');
  m.removeAllListeners();
});
