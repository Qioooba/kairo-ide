'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(__dirname, 'check-architecture-boundaries.cjs');

describe('PR17: Architecture Boundary Gate & Deprecated API Quarantine', () => {
  test('check-architecture-boundaries.cjs executes successfully and passes all 6 gates', () => {
    const res = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    const plain = res.stdout.replace(/\x1b\[[0-9;]*m/g, '');
    assert.strictEqual(
      res.status,
      0,
      `Expected boundary check to pass with exit code 0. Stderr: ${res.stderr}\nStdout: ${res.stdout}`,
    );
    assert.ok(plain.includes('ALL ARCHITECTURAL BOUNDARY GATES PASSED'));
    assert.ok(plain.includes('[Gate 1] Gate 1: Protocol Purity'));
    assert.ok(plain.includes('[Gate 2] Gate 2: Extension Layering'));
    assert.ok(plain.includes('[Gate 3] Gate 3: Single HTTP Gateway'));
    assert.ok(plain.includes('[Gate 4] Gate 4: Deprecated API Quarantine'));
    assert.ok(plain.includes('[Gate 5] Gate 5: Go Domain Layering'));
    assert.ok(plain.includes('[Gate 6] Gate 6: License Manifest & Upstream Attribution'));
  });
});
