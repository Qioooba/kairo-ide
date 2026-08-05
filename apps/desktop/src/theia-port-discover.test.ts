/**
 * Tests for Theia port discovery helpers (DK-P2-5).
 *
 * Run with:
 *   npx ts-node --require source-map-support/register --test apps/desktop/src/theia-port-discover.test.ts
 */

import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseTheiaListenPort,
  readTheiaPortFromEnv,
  readTheiaPortFromStateFile,
  resolvePreferredTheiaPort,
  theiaPortDiscoverTimeoutMessage,
  writeTheiaStateFile,
} from './theia-port-discover';

describe('parseTheiaListenPort', () => {
  it('parses canonical Theia 1.73 listen line', () => {
    assert.strictEqual(
      parseTheiaListenPort('root INFO Theia app listening on http://127.0.0.1:45123.'),
      45123,
    );
  });

  it('parses https and IPv6 host forms', () => {
    assert.strictEqual(
      parseTheiaListenPort('Theia app listening on https://localhost:8443.'),
      8443,
    );
    assert.strictEqual(
      parseTheiaListenPort('listening on http://[::1]:3000'),
      3000,
    );
  });

  it('parses "listening on port N" alternate', () => {
    assert.strictEqual(parseTheiaListenPort('Server listening on port 19001'), 19001);
    assert.strictEqual(parseTheiaListenPort('Listening on port: 19002'), 19002);
  });

  it('returns undefined for non-matching text', () => {
    assert.strictEqual(parseTheiaListenPort('still starting...'), undefined);
  });
});

describe('readTheiaPortFromEnv / state / resolve', () => {
  it('reads THEIA_PORT from env', () => {
    assert.strictEqual(readTheiaPortFromEnv({ THEIA_PORT: '18301' }), 18301);
    assert.strictEqual(readTheiaPortFromEnv({ THEIA_PORT: 'nope' }), undefined);
  });

  it('reads theia-state.json when present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-theia-port-'));
    const statePath = path.join(dir, 'theia-state.json');
    fs.writeFileSync(statePath, JSON.stringify({ port: 19222 }), 'utf8');
    try {
      assert.strictEqual(readTheiaPortFromStateFile(statePath), 19222);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeTheiaStateFile persists port+pid for subsequent reads', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-theia-port-'));
    const statePath = path.join(dir, 'theia-state.json');
    try {
      writeTheiaStateFile(statePath, { port: 18345, pid: 4242 });
      assert.strictEqual(readTheiaPortFromStateFile(statePath), 18345);
      const raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
        port: number;
        pid: number;
      };
      assert.strictEqual(raw.port, 18345);
      assert.strictEqual(raw.pid, 4242);
      if (process.platform !== 'win32') {
        const mode = fs.statSync(statePath).mode & 0o777;
        assert.strictEqual(mode, 0o600);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeTheiaStateFile rejects invalid port/pid', () => {
    assert.throws(
      () => writeTheiaStateFile('/tmp/unused-theia-state.json', { port: 0, pid: 1 }),
      /invalid theia state/,
    );
  });

  it('prefers THEIA_PORT over log scrape', () => {
    const port = resolvePreferredTheiaPort({
      env: { THEIA_PORT: '11111' },
      logText: 'Theia app listening on http://127.0.0.1:22222.',
    });
    assert.strictEqual(port, 11111);
  });

  it('falls back to log scrape when no env/state', () => {
    const port = resolvePreferredTheiaPort({
      env: {},
      logText: 'Theia app listening on http://127.0.0.1:33333.',
    });
    assert.strictEqual(port, 33333);
  });

  it('timeout message names all strategies', () => {
    const msg = theiaPortDiscoverTimeoutMessage(45_000, 'Waiting for listen port');
    assert.match(msg, /THEIA_PORT/);
    assert.match(msg, /theia-state\.json/);
    assert.match(msg, /45000ms/);
    assert.match(msg, /Waiting for listen port/);
  });
});
