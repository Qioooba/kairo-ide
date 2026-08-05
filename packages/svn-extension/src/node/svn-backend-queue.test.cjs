'use strict';
/**
 * VC-P3-2 — fair FIFO queue + cancel for SvnBackendServiceImpl.
 * Behavioral tests stub executeCommand so no real svn binary is required.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const srcPath = path.join(__dirname, 'svn-backend-service.ts');
const libPath = path.join(__dirname, '..', '..', 'lib', 'node', 'svn-backend-service.js');

describe('svn-backend-service queue (source contract)', () => {
  const src = fs.readFileSync(srcPath, 'utf8');

  it('uses FIFO pending + exclusive write (no write-preferring starve)', () => {
    assert.match(src, /pending:\s*QueuedCommand\[\]/);
    assert.match(src, /queue\.pending\[0\]\.type === 'read'/);
    assert.match(src, /queue\.pending\[0\]\.type === 'write'/);
    assert.doesNotMatch(src, /writeQueue/);
    assert.match(src, /\$cancel\(/);
    assert.match(src, /\$cancelAll\(/);
    assert.match(src, /SvnCommandCancelledError/);
  });
});

describe('svn-backend-service queue (behavioral)', {
  skip: !fs.existsSync(libPath),
}, () => {
  let Impl;

  before(() => {
    const mod = require(libPath);
    Impl = mod.SvnBackendServiceImpl;
  });

  function createBackend() {
    const backend = Object.create(Impl.prototype);
    backend.logger = { info() {}, warn() {}, error() {}, debug() {} };
    backend.queues = new Map();
    backend.cachedInstallation = { path: 'svn', version: '1.14.0', versionMajor: 1, versionMinor: 14, source: 'path' };
    backend.credentials = undefined;
    backend.client = undefined;
    backend.onCommandEmitter = { fire() {} };

    /** @type {Map<string, {cmd: any, finish: Function}>} */
    const inflight = new Map();
    backend.__inflight = inflight;

    backend.getWcRootForCwd = (cwd) => cwd;
    backend.executeCommand = function executeCommand(cmd, wcRoot) {
      const queue = this.queues.get(wcRoot);
      if (!queue) { cmd.reject(new Error('Queue not found')); return; }
      if (cmd.cancelled) return;
      if (cmd.type === 'read') queue.activeReadCount++;
      if (cmd.type === 'write') queue.activeWrite = cmd;
      queue.activeById.set(cmd.id, cmd);
      cmd.process = { kill() { /* stub */ } };
      inflight.set(cmd.id, {
        cmd,
        finish: (err) => {
          if (cmd.cancelled) {
            this.processNext(wcRoot);
            return;
          }
          this.releaseActive(cmd, queue);
          if (err) cmd.reject(err);
          else cmd.resolve({ stdout: cmd.args.join(' '), stderr: '', exitCode: 0 });
          inflight.delete(cmd.id);
          this.processNext(wcRoot);
        },
      });
    };
    return backend;
  }

  it('does not let a later write jump ahead of an earlier read', async () => {
    const backend = createBackend();
    const order = [];

    // Occupy the WC with a long write so subsequent ops queue.
    const write1 = backend.$exec(['update'], '/wc', 'write');
    await Promise.resolve();
    assert.equal(backend.__inflight.size, 1);
    const write1Id = [...backend.__inflight.keys()][0];

    const readP = backend.$exec(['status'], '/wc', 'read').then((r) => {
      order.push('read');
      return r;
    });
    const write2P = backend.$exec(['commit'], '/wc', 'write').then((r) => {
      order.push('write2');
      return r;
    });

    // Finish first write → fair FIFO must start the read, not write2.
    backend.__inflight.get(write1Id).finish(null);
    await Promise.resolve();
    assert.equal([...backend.__inflight.values()][0].cmd.type, 'read');

    const readId = [...backend.__inflight.keys()][0];
    backend.__inflight.get(readId).finish(null);
    await Promise.resolve();
    assert.equal([...backend.__inflight.values()][0].cmd.type, 'write');

    const write2Id = [...backend.__inflight.keys()][0];
    backend.__inflight.get(write2Id).finish(null);

    await Promise.all([write1, readP, write2P]);
    assert.deepEqual(order, ['read', 'write2']);
  });

  it('cancels a pending command without running it', async () => {
    const backend = createBackend();
    const write1 = backend.$exec(['update'], '/wc', 'write');
    await Promise.resolve();
    const write1Id = [...backend.__inflight.keys()][0];

    let cancelled = false;
    const readP = backend.$exec(['status'], '/wc', 'read').then(
      () => { throw new Error('read should not resolve'); },
      (err) => {
        cancelled = err?.code === 'SVN_CANCELLED' || err?.name === 'SvnCommandCancelledError';
      },
    );

    const queue = backend.queues.get('/wc');
    assert.equal(queue.pending.length, 1);
    const pendingId = queue.pending[0].id;

    const ok = await backend.$cancel(pendingId);
    assert.equal(ok, true);
    await readP;
    assert.equal(cancelled, true);

    backend.__inflight.get(write1Id).finish(null);
    await write1;
  });

  it('cancels an in-flight write and unblocks a waiting read', async () => {
    const backend = createBackend();
    const writeP = backend.$exec(['update'], '/wc', 'write').then(
      () => { throw new Error('write should be cancelled'); },
      (err) => err?.code === 'SVN_CANCELLED' || err?.name === 'SvnCommandCancelledError',
    );
    await Promise.resolve();
    const writeId = [...backend.__inflight.keys()][0];

    const readP = backend.$exec(['status'], '/wc', 'read');
    const ok = await backend.$cancel(writeId);
    assert.equal(ok, true);
    assert.equal(await writeP, true);
    backend.__inflight.delete(writeId);

    await Promise.resolve();
    const live = [...backend.__inflight.values()].filter((e) => !e.cmd.cancelled);
    assert.equal(live.length, 1);
    assert.equal(live[0].cmd.type, 'read');
    live[0].finish(null);
    await readP;
  });
});
