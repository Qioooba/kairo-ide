/**
 * Tests for Tomcat home detection / persistence.
 */

import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  isValidTomcatHome,
  savePersistedTomcatHome,
  loadPersistedTomcatHome,
  getPersistedTomcatConfigPath,
  detectTomcatHome,
  applyTomcatEnv,
} from './tomcat-check';

function makeFakeTomcatHome(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-tomcat-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const script = process.platform === 'win32' ? 'catalina.bat' : 'catalina.sh';
  fs.writeFileSync(path.join(bin, script), '@echo off\r\n');
  fs.writeFileSync(path.join(bin, 'bootstrap.jar'), 'fake');
  return root;
}

describe('isValidTomcatHome', () => {
  it('rejects empty / missing paths', () => {
    assert.strictEqual(isValidTomcatHome(undefined), false);
    assert.strictEqual(isValidTomcatHome(''), false);
    assert.strictEqual(isValidTomcatHome(path.join(os.tmpdir(), 'no-such-tomcat')), false);
  });

  it('accepts a fake catalina home', () => {
    const home = makeFakeTomcatHome();
    try {
      assert.strictEqual(isValidTomcatHome(home), true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('persisted Tomcat config', () => {
  it('honors KAIRO_TOMCAT_CONFIG and round-trips', () => {
    const home = makeFakeTomcatHome();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-tomcat-cfg-'));
    const cfgPath = path.join(tmpDir, 'host-tomcat.json');
    const prevCfg = process.env.KAIRO_TOMCAT_CONFIG;
    const prevHome = process.env.KAIRO_TOMCAT6_HOME;
    process.env.KAIRO_TOMCAT_CONFIG = cfgPath;
    delete process.env.KAIRO_TOMCAT6_HOME;
    try {
      assert.strictEqual(getPersistedTomcatConfigPath(), cfgPath);
      savePersistedTomcatHome(home);
      assert.ok(fs.existsSync(cfgPath));
      assert.strictEqual(loadPersistedTomcatHome(), home);
      assert.strictEqual(detectTomcatHome(), home);
    } finally {
      if (prevCfg === undefined) delete process.env.KAIRO_TOMCAT_CONFIG;
      else process.env.KAIRO_TOMCAT_CONFIG = prevCfg;
      if (prevHome === undefined) delete process.env.KAIRO_TOMCAT6_HOME;
      else process.env.KAIRO_TOMCAT6_HOME = prevHome;
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('applyTomcatEnv sets KAIRO_TOMCAT6_HOME', () => {
    const home = makeFakeTomcatHome();
    const prev = process.env.KAIRO_TOMCAT6_HOME;
    try {
      applyTomcatEnv(home);
      assert.strictEqual(process.env.KAIRO_TOMCAT6_HOME, home);
    } finally {
      if (prev === undefined) delete process.env.KAIRO_TOMCAT6_HOME;
      else process.env.KAIRO_TOMCAT6_HOME = prev;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
