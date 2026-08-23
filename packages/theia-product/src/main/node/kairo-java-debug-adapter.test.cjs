'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
require('../../../../../tests/setup-tmp.cjs'); // KAIRO_TMP override
try { require('../../../test/frontend-setup.cjs'); } catch { /* fallback: provide minimal document for lumino */ if (typeof global.document === 'undefined') global.document = { createElement: () => ({ style: {} }), body: {} }; }
const os = require('node:os');
const { Container } = require('inversify');
const { DebugAdapterContribution } = require('@theia/debug/lib/common/debug-model');
const {
  KairoJavaDebugAdapterContribution,
  KAIRO_DEBUG_ADAPTER_MAX_ARGS,
  KAIRO_DEBUG_ADAPTER_MAX_ARG_LENGTH,
  KAIRO_DEBUG_ADAPTER_MAX_ENCODED_ARGS_LENGTH,
  probeKairoJavaDebugAdapter,
} = require('../../../lib/node/kairo-java-debug-adapter-contribution');

function withIsolatedJavaEnv(fn) {
  const prevJavaHome = process.env.JAVA_HOME;
  const prevJdtJre = process.env.KAIRO_JDT_LS_JRE;
  const prevPath = process.env.PATH;
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-empty-path-'));
  delete process.env.JAVA_HOME;
  delete process.env.KAIRO_JDT_LS_JRE;
  process.env.PATH = emptyDir;
  try {
    return fn();
  } finally {
    if (prevJavaHome === undefined) delete process.env.JAVA_HOME;
    else process.env.JAVA_HOME = prevJavaHome;
    if (prevJdtJre === undefined) delete process.env.KAIRO_JDT_LS_JRE;
    else process.env.KAIRO_JDT_LS_JRE = prevJdtJre;
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    try { fs.rmdirSync(emptyDir); } catch {}
  }
}

test('adapter capability fails closed when command is absent, relative, or args are malformed', () => {
  assert.equal(probeKairoJavaDebugAdapter({}, () => true).available, false);
  assert.match(probeKairoJavaDebugAdapter({ KAIRO_JAVA_DEBUG_ADAPTER_COMMAND: 'adapter' }, () => true).reason, /absolute/);
  const command = path.resolve('/approved/java-debug-adapter');
  const malformed = probeKairoJavaDebugAdapter({
    KAIRO_JAVA_DEBUG_ADAPTER_COMMAND: command,
    KAIRO_JAVA_DEBUG_ADAPTER_ARGS: '["ok", 7]',
  }, () => true);
  assert.equal(malformed.available, false);
  assert.match(malformed.reason, /JSON string array/);
});

test('adapter capability accepts only an explicit absolute file and preserves argument boundaries', () => {
  const command = path.resolve('/approved/java-debug-adapter');
  const capability = probeKairoJavaDebugAdapter({
    KAIRO_JAVA_DEBUG_ADAPTER_COMMAND: command,
    KAIRO_JAVA_DEBUG_ADAPTER_ARGS: '["--stdio","value with spaces"]',
  }, candidate => candidate === command);
  assert.deepEqual(capability, {
    available: true,
    command,
    args: ['--stdio', 'value with spaces'],
  });
});

test('adapter capability bounds argv size and rejects NUL characters', () => {
  const command = path.resolve('/approved/java-debug-adapter');
  const probeArgs = args => probeKairoJavaDebugAdapter({
    KAIRO_JAVA_DEBUG_ADAPTER_COMMAND: command,
    KAIRO_JAVA_DEBUG_ADAPTER_ARGS: JSON.stringify(args),
  }, candidate => candidate === command);

  assert.match(probeArgs(Array(KAIRO_DEBUG_ADAPTER_MAX_ARGS + 1).fill('x')).reason, /at most/);
  assert.match(probeArgs(['x'.repeat(KAIRO_DEBUG_ADAPTER_MAX_ARG_LENGTH + 1)]).reason, /must not exceed/);
  assert.match(probeArgs(['before\0after']).reason, /NUL/);

  const oversized = probeKairoJavaDebugAdapter({
    KAIRO_JAVA_DEBUG_ADAPTER_COMMAND: command,
    KAIRO_JAVA_DEBUG_ADAPTER_ARGS: `"${'x'.repeat(KAIRO_DEBUG_ADAPTER_MAX_ENCODED_ARGS_LENGTH)}"`,
  }, candidate => candidate === command);
  assert.match(oversized.reason, /exceeds/);

  const nulCommand = probeKairoJavaDebugAdapter({
    KAIRO_JAVA_DEBUG_ADAPTER_COMMAND: `${command}\0suffix`,
  }, candidate => candidate === command || candidate === `${command}\0suffix`);
  assert.match(nulCommand.reason, /NUL/);
});

test('adapter contribution validates local attach boundary before returning executable', () => {
  const contribution = new KairoJavaDebugAdapterContribution();
  assert.throws(() => contribution.provideDebugAdapterExecutable({
    type: 'kairo-java', name: 'bad', request: 'launch', hostName: '127.0.0.1', port: 5005,
  }), /attach requests only/);
  assert.throws(() => contribution.provideDebugAdapterExecutable({
    type: 'kairo-java', name: 'bad', request: 'attach', hostName: '0.0.0.0', port: 5005,
  }), /127\.0\.0\.1/);
  assert.throws(() => contribution.provideDebugAdapterExecutable({
    type: 'kairo-java', name: 'bad', request: 'attach', hostName: '127.0.0.1', port: 0,
  }), /Invalid JDWP port/);
});

test('backend module registers the Kairo Java debug adapter contribution', () => {
  const backendModule = require('../../../lib/node/kairo-product-backend-module').default;
  const container = new Container();
  container.load(backendModule);
  const contributions = container.getAll(DebugAdapterContribution);
  assert.ok(contributions.some(contribution => contribution.type === 'kairo-java'));
});

test('configured contribution returns an argv-safe stdio executable', () => {
  withIsolatedJavaEnv(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-debug-adapter-'));
    const command = path.join(dir, 'adapter');
    fs.writeFileSync(command, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(command, 0o755);
    const previousCommand = process.env.KAIRO_JAVA_DEBUG_ADAPTER_COMMAND;
    const previousArgs = process.env.KAIRO_JAVA_DEBUG_ADAPTER_ARGS;
    process.env.KAIRO_JAVA_DEBUG_ADAPTER_COMMAND = command;
    process.env.KAIRO_JAVA_DEBUG_ADAPTER_ARGS = '["--stdio","two words"]';
    try {
      const executable = new KairoJavaDebugAdapterContribution().provideDebugAdapterExecutable({
        type: 'kairo-java', name: 'attach', request: 'attach', hostName: '127.0.0.1', port: 5005,
      });
      assert.deepEqual(executable, { command, args: ['--stdio', 'two words', '127.0.0.1', '5005'] });
    } finally {
      if (previousCommand === undefined) delete process.env.KAIRO_JAVA_DEBUG_ADAPTER_COMMAND;
      else process.env.KAIRO_JAVA_DEBUG_ADAPTER_COMMAND = previousCommand;
      if (previousArgs === undefined) delete process.env.KAIRO_JAVA_DEBUG_ADAPTER_ARGS;
      else process.env.KAIRO_JAVA_DEBUG_ADAPTER_ARGS = previousArgs;
      try { fs.rmSync(dir, { recursive: true }); } catch {}
    }
  });
});
