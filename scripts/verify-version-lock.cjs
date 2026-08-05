#!/usr/bin/env node
'use strict';

/**
 * Kairo IDE 版本固化验证脚本
 *
 * 验证所有关键依赖版本已锁定且与 ADR 一致：
 *   1. scripts/supply-chain-lock.json — JDT LS / Tomcat 6 / SHA-256 / License
 *   2. package.json 根 — Theia 版本锁定（非 ^/~ 范围）
 *   3. runtime-agent/go.mod — Go 版本及关键依赖
 *
 * 输出：Pass/Fail 逐项检查 + 摘要
 * 超时：30 秒
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 30_000;
const START_TIME = Date.now();

// ─── 超时保护 ────────────────────────────────────────────────────
const timeout = setTimeout(() => {
  console.error('[verify-version-lock] 超时（30s），退出');
  process.exit(2);
}, TIMEOUT_MS);
timeout.unref();

// ─── ADR 参考值 ──────────────────────────────────────────────────
const ADR_REF = {
  jdtls: '1.55.0',       // ADR-0017 / supply-chain-lock.json
  tomcat: '6.0.53',      // ADR-0006
  go: '1.22',            // minimum
  node: '20.10',         // minimum from package.json engines
};

// ─── 检查结果 ────────────────────────────────────────────────────
const results = {
  supplyChain: { checks: [], passed: 0, failed: 0, warnings: 0 },
  packageJson: { checks: [], passed: 0, failed: 0, warnings: 0 },
  goMod: { checks: [], passed: 0, failed: 0, warnings: 0 },
};

function pass(category, check) {
  results[category].checks.push({ status: 'PASS', ...check });
  results[category].passed++;
}

function fail(category, check) {
  results[category].checks.push({ status: 'FAIL', ...check });
  results[category].failed++;
}

function warn(category, check) {
  results[category].checks.push({ status: 'WARN', ...check });
  results[category].warnings++;
}

// ─── 1. supply-chain-lock.json 检查 ──────────────────────────────

function checkSupplyChain() {
  console.log('[verify] 检查 scripts/supply-chain-lock.json ...');

  const lockPath = path.join(ROOT, 'scripts', 'supply-chain-lock.json');
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (err) {
    fail('supplyChain', { item: 'supply-chain-lock.json', message: `无法解析: ${err.message}` });
    return;
  }

  const deps = lock.dependencies || {};

  // 检查 JDT LS 版本
  const jdtlsEntries = Object.entries(deps).filter(([k]) => k.startsWith('jdtls-'));
  if (jdtlsEntries.length === 0) {
    fail('supplyChain', { item: 'JDT LS', message: '未找到 jdtls-* 条目' });
  } else {
    for (const [key, dep] of jdtlsEntries) {
      const version = dep.version;
      if (version === ADR_REF.jdtls) {
        pass('supplyChain', { item: `JDT LS (${key})`, message: `版本 ${version} 与 ADR-0017 一致` });
      } else {
        fail('supplyChain', {
          item: `JDT LS (${key})`,
          message: `版本 ${version} 与 ADR-0017 推荐 ${ADR_REF.jdtls} 不一致`,
          expected: ADR_REF.jdtls,
          actual: version,
        });
      }

      // 检查 SHA-256 是否使用环境变量（而非硬编码）
      if (dep.sha256Env && !dep.sha256) {
        warn('supplyChain', {
          item: `JDT LS (${key}) SHA-256`,
          message: `SHA-256 通过环境变量 ${dep.sha256Env} 引用，建议硬编码`,
        });
      } else if (dep.sha256) {
        pass('supplyChain', { item: `JDT LS (${key}) SHA-256`, message: 'SHA-256 已硬编码' });
      }

      // 检查 License 文件
      if (dep.licenseFiles && dep.licenseFiles.length > 0) {
        pass('supplyChain', { item: `JDT LS (${key}) License`, message: `License 文件已指定: ${dep.licenseFiles.join(', ')}` });
      } else {
        fail('supplyChain', { item: `JDT LS (${key}) License`, message: '未指定 License 文件' });
      }
    }
  }

  // 检查 Tomcat 6 版本
  const tomcatEntries = Object.entries(deps).filter(([k]) => k.startsWith('tomcat6-'));
  if (tomcatEntries.length === 0) {
    fail('supplyChain', { item: 'Tomcat 6', message: '未找到 tomcat6-* 条目' });
  } else {
    for (const [key, dep] of tomcatEntries) {
      const version = dep.version;
      if (version === ADR_REF.tomcat) {
        pass('supplyChain', { item: `Tomcat 6 (${key})`, message: `版本 ${version} 与 ADR-0006 一致` });
      } else {
        fail('supplyChain', {
          item: `Tomcat 6 (${key})`,
          message: `版本 ${version} 与 ADR-0006 推荐 ${ADR_REF.tomcat} 不一致`,
          expected: ADR_REF.tomcat,
          actual: version,
        });
      }

      // 检查 SHA-256
      if (dep.sha256Env && !dep.sha256) {
        warn('supplyChain', {
          item: `Tomcat 6 (${key}) SHA-256`,
          message: `SHA-256 通过环境变量 ${dep.sha256Env} 引用，建议硬编码`,
        });
      } else if (dep.sha256) {
        pass('supplyChain', { item: `Tomcat 6 (${key}) SHA-256`, message: 'SHA-256 已硬编码' });
      }

      // 检查 License 文件
      if (dep.licenseFiles && dep.licenseFiles.length > 0) {
        pass('supplyChain', { item: `Tomcat 6 (${key}) License`, message: `License 文件已指定: ${dep.licenseFiles.join(', ')}` });
      } else {
        fail('supplyChain', { item: `Tomcat 6 (${key}) License`, message: '未指定 License 文件' });
      }
    }
  }
}

// ─── 2. package.json 根检查 ──────────────────────────────────────

function checkPackageJson() {
  console.log('[verify] 检查 package.json ...');

  const pkgPath = path.join(ROOT, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    fail('packageJson', { item: 'package.json', message: `无法解析: ${err.message}` });
    return;
  }

  // 检查 engines
  if (pkg.engines) {
    if (pkg.engines.node) {
      const nodeVer = pkg.engines.node.replace(/[>=^~\s]/g, '');
      if (nodeVer >= ADR_REF.node) {
        pass('packageJson', { item: 'Node.js 版本', message: `engines.node: ${pkg.engines.node}` });
      } else {
        fail('packageJson', {
          item: 'Node.js 版本',
          message: `Node.js ${nodeVer} 低于最低要求 ${ADR_REF.node}`,
        });
      }
    }

    if (pkg.engines.pnpm) {
      pass('packageJson', { item: 'pnpm 版本', message: `engines.pnpm: ${pkg.engines.pnpm}` });
    } else {
      warn('packageJson', { item: 'pnpm 版本', message: '未在 engines 中指定 pnpm 版本' });
    }
  }

  // 检查 packageManager
  if (pkg.packageManager) {
    pass('packageJson', { item: 'packageManager', message: `已锁定: ${pkg.packageManager}` });
  } else {
    warn('packageJson', { item: 'packageManager', message: '未指定 packageManager，Corepack 无法锁定版本' });
  }

  // 检查关键 devDependencies 是否为精确版本
  const keyDevDeps = ['typescript', 'prettier', 'rimraf', '@types/node'];
  const devDeps = pkg.devDependencies || {};
  const allDeps = { ...pkg.dependencies || {}, ...pkg.devDependencies || {} };

  for (const dep of keyDevDeps) {
    const ver = devDeps[dep];
    if (!ver) {
      warn('packageJson', { item: `devDependency: ${dep}`, message: '未在根 package.json 中找到' });
      continue;
    }
    if (ver.startsWith('^') || ver.startsWith('~')) {
      warn('packageJson', { item: `devDependency: ${dep}`, message: `${ver} 使用范围版本，建议锁定精确版本` });
    } else {
      pass('packageJson', { item: `devDependency: ${dep}`, message: `已锁定精确版本: ${ver}` });
    }
  }

  // 检查 Theia 版本（在 theia-product 的 package.json 中）
  const theiaPkgPath = path.join(ROOT, 'packages', 'theia-product', 'package.json');
  let theiaPkg;
  try {
    theiaPkg = JSON.parse(fs.readFileSync(theiaPkgPath, 'utf8'));
  } catch {
    warn('packageJson', { item: 'Theia 版本', message: '无法读取 packages/theia-product/package.json' });
    return;
  }

  const theiaDeps = theiaPkg.dependencies || {};
  const theiaCore = theiaDeps['@theia/core'];
  if (theiaCore) {
    if (theiaCore.startsWith('^') || theiaCore.startsWith('~')) {
      fail('packageJson', {
        item: 'Theia 版本',
        message: `@theia/core ${theiaCore} 使用范围版本，必须锁定精确版本`,
      });
    } else {
      pass('packageJson', { item: 'Theia 版本', message: `@theia/core 已锁定精确版本: ${theiaCore}` });
    }

    // 检查所有 @theia/* 包是否一致（排除 monaco-editor-core，它有独立版本号）
    const theiaVersions = new Set();
    for (const [key, ver] of Object.entries(theiaDeps)) {
      if (key.startsWith('@theia/') && key !== '@theia/monaco-editor-core') {
        theiaVersions.add(ver);
      }
    }
    if (theiaVersions.size > 1) {
      warn('packageJson', {
        item: 'Theia 版本一致性',
        message: `@theia/* 包版本不一致: ${[...theiaVersions].join(', ')}`,
      });
    } else {
      pass('packageJson', { item: 'Theia 版本一致性', message: '所有 @theia/* 包版本一致' });
    }
  } else {
    fail('packageJson', { item: 'Theia 版本', message: '未找到 @theia/core 依赖' });
  }
}

// ─── 3. go.mod 检查 ──────────────────────────────────────────────

function checkGoMod() {
  console.log('[verify] 检查 runtime-agent/go.mod ...');

  const goModPath = path.join(ROOT, 'runtime-agent', 'go.mod');
  let goMod;
  try {
    goMod = fs.readFileSync(goModPath, 'utf8');
  } catch (err) {
    fail('goMod', { item: 'go.mod', message: `无法读取: ${err.message}` });
    return;
  }

  // 检查 Go 版本
  const goVersionMatch = goMod.match(/^go\s+(\d+\.\d+)/m);
  if (goVersionMatch) {
    const goVer = goVersionMatch[1];
    if (parseFloat(goVer) >= parseFloat(ADR_REF.go)) {
      pass('goMod', { item: 'Go 版本', message: `go ${goVer} ≥ ${ADR_REF.go}` });
    } else {
      fail('goMod', {
        item: 'Go 版本',
        message: `go ${goVer} < ${ADR_REF.go} 最低要求`,
      });
    }
  } else {
    fail('goMod', { item: 'Go 版本', message: '未找到 go 版本声明' });
  }

  // 检查 toolchain
  const toolchainMatch = goMod.match(/^toolchain\s+(\S+)/m);
  if (toolchainMatch) {
    pass('goMod', { item: 'Go toolchain', message: `已指定: ${toolchainMatch[1]}` });
  } else {
    warn('goMod', { item: 'Go toolchain', message: '未指定 toolchain' });
  }

  // 检查关键依赖版本
  const keyDeps = [
    { name: 'github.com/gorilla/websocket', minVersion: '1.5.0' },
    { name: 'golang.org/x/text', minVersion: '0.14.0' },
    { name: 'gopkg.in/yaml.v3', minVersion: '3.0.0' },
  ];

  for (const dep of keyDeps) {
    const pattern = new RegExp(`^\\t${dep.name.replace(/\//g, '\\/')}\\s+v([\\d.]+)`, 'm');
    const match = goMod.match(pattern);
    if (match) {
      const ver = match[1];
      pass('goMod', { item: dep.name, message: `v${ver}` });
    } else {
      warn('goMod', { item: dep.name, message: '未在 go.mod 中找到' });
    }
  }
}

// ─── 主函数 ──────────────────────────────────────────────────────

function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  Kairo IDE 版本固化验证');
  console.log('══════════════════════════════════════════════');
  console.log('');

  checkSupplyChain();
  checkPackageJson();
  checkGoMod();

  // ─── 终端输出 ──────────────────────────────────────────────────
  console.log('');
  console.log('─── supply-chain-lock.json ───');
  for (const c of results.supplyChain.checks) {
    const icon = c.status === 'PASS' ? '✅' : c.status === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${icon} ${c.item}: ${c.message}`);
    if (c.expected && c.actual) {
      console.log(`      期望: ${c.expected}, 实际: ${c.actual}`);
    }
  }

  console.log('');
  console.log('─── package.json ───');
  for (const c of results.packageJson.checks) {
    const icon = c.status === 'PASS' ? '✅' : c.status === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${icon} ${c.item}: ${c.message}`);
  }

  console.log('');
  console.log('─── go.mod ───');
  for (const c of results.goMod.checks) {
    const icon = c.status === 'PASS' ? '✅' : c.status === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${icon} ${c.item}: ${c.message}`);
  }

  // ─── 汇总 ──────────────────────────────────────────────────────
  const totalPassed = results.supplyChain.passed + results.packageJson.passed + results.goMod.passed;
  const totalFailed = results.supplyChain.failed + results.packageJson.failed + results.goMod.failed;
  const totalWarnings = results.supplyChain.warnings + results.packageJson.warnings + results.goMod.warnings;
  const totalChecks = totalPassed + totalFailed + totalWarnings;

  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log(`  总计: ${totalChecks} 项检查`);
  console.log(`  ✅ 通过: ${totalPassed} | ❌ 失败: ${totalFailed} | ⚠️ 警告: ${totalWarnings}`);
  console.log('══════════════════════════════════════════════');

  // ─── JSON 输出 ──────────────────────────────────────────────────
  const jsonOutput = JSON.stringify({
    generatedAt: new Date().toISOString(),
    script: 'verify-version-lock.cjs',
    adrRef: ADR_REF,
    results,
    summary: { total: totalChecks, passed: totalPassed, failed: totalFailed, warnings: totalWarnings },
  }, null, 2);
  console.log('\n[JSON 输出]');
  console.log(jsonOutput);

  console.log('\n[verify-version-lock] 耗时:', Date.now() - START_TIME, 'ms');
  process.exit(totalFailed > 0 ? 1 : 0);
}

main();