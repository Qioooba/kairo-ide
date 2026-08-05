'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, 'sign-win.cjs');

function runSignWin(exePath, env) {
  return spawnSync(process.execPath, [script, exePath], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('KAIRO_REQUIRE_SIGNING=1 fails when no certificate is configured', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-sign-'));
  const exe = path.join(tmp, 'dummy.exe');
  fs.writeFileSync(exe, 'MZ', 'utf8');

  const result = runSignWin(exe, {
    KAIRO_REQUIRE_SIGNING: '1',
    KAIRO_CODE_SIGN_CERT_PATH: '',
    KAIRO_CODE_SIGN_PASSWORD: '',
    CSC_LINK: '',
    CSC_KEY_PASSWORD: '',
  });

  assert.notEqual(result.status, 0, 'expected fatal exit without certificate');
  assert.match(result.stderr + result.stdout, /KAIRO_REQUIRE_SIGNING=1/);
});

test('unsigned skip is soft-exit when KAIRO_REQUIRE_SIGNING is unset', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-sign-'));
  const exe = path.join(tmp, 'dummy.exe');
  fs.writeFileSync(exe, 'MZ', 'utf8');

  const result = runSignWin(exe, {
    KAIRO_REQUIRE_SIGNING: '',
    KAIRO_CODE_SIGN_CERT_PATH: '',
    KAIRO_CODE_SIGN_PASSWORD: '',
    CSC_LINK: '',
    CSC_KEY_PASSWORD: '',
  });

  assert.equal(result.status, 0, 'expected soft exit without certificate');
});

test('signing failure is fatal when certificate is configured without REQUIRE_SIGNING', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-sign-'));
  const exe = path.join(tmp, 'dummy.exe');
  const cert = path.join(tmp, 'fake.pfx');
  fs.writeFileSync(exe, 'MZ', 'utf8');
  fs.writeFileSync(cert, 'pfx', 'utf8');

  const result = runSignWin(exe, {
    KAIRO_REQUIRE_SIGNING: '',
    KAIRO_CODE_SIGN_CERT_PATH: cert,
    KAIRO_CODE_SIGN_PASSWORD: 'secret',
    CSC_LINK: '',
    CSC_KEY_PASSWORD: '',
  });

  assert.notEqual(result.status, 0, 'expected fatal exit when cert configured but signing fails');
  assert.match(result.stderr + result.stdout, /Certificate configured but signing failed/);
});
