#!/usr/bin/env node
'use strict';

/**
 * package-windows.cjs — Kairo IDE Windows packaging script.
 *
 * End-to-end packaging pipeline for the Windows desktop app:
 *   1. Build the Go Runtime Agent (kairo-runtime.exe)
 *   2. Prepare bundled dependencies (JDT LS, Tomcat 6)
 *   3. Copy browser artifacts (frontend + backend)
 *   4. Build the desktop TypeScript
 *   5. Run electron-builder (NSIS + zip)
 *   6. Post-build verification (smoke test)
 *   7. Generate checksums
 *   8. Optional code signing
 *
 * Usage:
 *   node scripts/package-windows.cjs
 *   node scripts/package-windows.cjs --dry-run
 *   node scripts/package-windows.cjs --sign
 *   node scripts/package-windows.cjs --skip-bundled
 *   node scripts/package-windows.cjs --skip-agent
 *
 * Environment variables:
 *   KAIRO_CODE_SIGN_CERT_PATH  — Path to .pfx certificate for signing
 *   KAIRO_CODE_SIGN_PASSWORD   — Password for the certificate
 *   KAIRO_TOMCAT6_HOME         — Path to Tomcat 6 installation
 *   KAIRO_JDTLS_HOME           — Path to JDT LS installation
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');
const crypto = require('node:crypto');

// ─── CLI args ──────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const SIGN = process.argv.includes('--sign');
const SKIP_BUNDLED = process.argv.includes('--skip-bundled');
const SKIP_AGENT = process.argv.includes('--skip-agent');
const SKIP_BUILD = process.argv.includes('--skip-build');
const SKIP_SMOKE = process.argv.includes('--skip-smoke');

const REPO_ROOT = path.resolve(__dirname, '..');
const DESKTOP_DIR = path.join(REPO_ROOT, 'apps', 'desktop');
const RUNTIME_AGENT_DIR = path.join(REPO_ROOT, 'runtime-agent');
const DIST_DIR = path.join(DESKTOP_DIR, 'dist');
const BUNDLED_DIR = path.join(DESKTOP_DIR, 'bundled');
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8')).version;
  } catch {
    return '0.1.0';
  }
})();

// ─── Helpers ───────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function log(level, msg) {
  const prefix = level === 'ok' ? `${GREEN}[OK]${RESET}`
    : level === 'err' ? `${RED}[ERR]${RESET}`
    : level === 'warn' ? `${YELLOW}[WARN]${RESET}`
    : level === 'info' ? `${CYAN}[INFO]${RESET}`
    : level === 'step' ? `${BOLD}${CYAN}[STEP]${RESET}`
    : '';
  console.log(`${prefix} ${msg}`);
}

function step(msg) {
  console.log(`\n${BOLD}${CYAN}>>> ${msg}${RESET}`);
}

function run(cmd, args, opts = {}) {
  const cwd = opts.cwd || REPO_ROOT;
  if (DRY_RUN) {
    log('info', `DRY-RUN: ${cmd} ${args.join(' ')} (cwd: ${cwd})`);
    return { status: 0, stdout: '', stderr: '' };
  }
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env },
    timeout: opts.timeout || 300_000,
  });
  return result;
}

function runSilent(cmd, args, opts = {}) {
  const cwd = opts.cwd || REPO_ROOT;
  if (DRY_RUN) {
    return { status: 0, stdout: '', stderr: '' };
  }
  return spawnSync(cmd, args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    timeout: opts.timeout || 300_000,
  });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(filePath, 'r');
  try {
    for (;;) {
      const bytes = fs.readSync(fd, buf, 0, buf.length, null);
      if (bytes === 0) break;
      hash.update(buf.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// ─── Main Pipeline ─────────────────────────────────────────────

const startTime = Date.now();
let exitCode = 0;

try {
  console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   Kairo IDE — Windows Packaging Pipeline         ║${RESET}`);
  console.log(`${BOLD}${CYAN}║   Version: ${VERSION.padEnd(40)}║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  if (DRY_RUN) {
    log('warn', 'DRY-RUN mode — no actual build will be performed');
  }

  // ── Step 1: Build Go Runtime Agent ─────────────────────────
  step('Step 1/7: Build Go Runtime Agent (kairo-runtime.exe)');

  if (SKIP_AGENT) {
    log('warn', 'Skipping agent build (--skip-agent)');
  } else {
    const agentBin = path.join(RUNTIME_AGENT_DIR, 'bin', 'kairo-runtime.exe');

    if (!fs.existsSync(RUNTIME_AGENT_DIR)) {
      log('err', `runtime-agent directory not found: ${RUNTIME_AGENT_DIR}`);
      exitCode = 1;
    } else {
      // Use the build-agent.js script which handles .exe naming correctly.
      const buildScript = path.join(DESKTOP_DIR, 'scripts', 'build-agent.js');
      const result = run('node', [buildScript], { cwd: REPO_ROOT });

      if (result.status !== 0) {
        log('err', `Go agent build failed with exit code ${result.status}`);
        exitCode = 1;
      } else if (fs.existsSync(agentBin)) {
        log('ok', `kairo-runtime.exe built: ${formatBytes(fileSize(agentBin))}`);
      } else {
        log('err', `kairo-runtime.exe not found after build at ${agentBin}`);
        exitCode = 1;
      }
    }
  }

  if (exitCode !== 0) {
    throw new Error('Agent build failed');
  }

  // ── Step 2: Prepare Bundled Dependencies ────────────────────
  step('Step 2/7: Prepare Bundled Dependencies (JDT LS + Tomcat 6)');

  if (SKIP_BUNDLED) {
    log('warn', 'Skipping bundled dependencies (--skip-bundled)');
  } else {
    // Run prepare-bundled.ps1
    const prepareScript = path.join(REPO_ROOT, 'scripts', 'prepare-bundled.ps1');
    if (fs.existsSync(prepareScript)) {
      const result = run('pwsh', [
        '-ExecutionPolicy', 'Bypass',
        '-File', prepareScript,
        '-Strict',
        '-BundledRoot', BUNDLED_DIR,
      ], { cwd: REPO_ROOT });

      if (result.status !== 0 && result.status !== null) {
        log('warn', `prepare-bundled exited with ${result.status} — continuing without bundled deps`);
      } else {
        log('ok', 'Bundled dependencies prepared');
      }
    } else {
      log('warn', 'prepare-bundled.ps1 not found — skipping bundled deps');
    }
  }

  // ── Step 3: Copy Browser Artifacts ──────────────────────────
  step('Step 3/7: Copy Browser Artifacts');

  if (SKIP_BUILD) {
    log('warn', 'Skipping build (--skip-build)');
  } else {
    const copyScript = path.join(DESKTOP_DIR, 'scripts', 'copy-browser-artifacts.js');
    const result = run('node', [copyScript, '--strict'], { cwd: REPO_ROOT });

    if (result.status !== 0) {
      log('err', 'Browser artifact copy failed');
      // Try building the browser app first.
      log('info', 'Attempting to build @kairo/browser...');
      const buildResult = run('pnpm', ['--filter', '@kairo/browser', 'build'], { cwd: REPO_ROOT });
      if (buildResult.status === 0) {
        const retryResult = run('node', [copyScript, '--strict'], { cwd: REPO_ROOT });
        if (retryResult.status !== 0) {
          log('err', 'Browser artifact copy failed after browser build');
          exitCode = 1;
        }
      } else {
        log('err', 'Browser build failed');
        exitCode = 1;
      }
    }
    log('ok', 'Browser artifacts copied');
  }

  if (exitCode !== 0) {
    throw new Error('Browser artifact copy failed');
  }

  // ── Step 4: Build Desktop TypeScript ────────────────────────
  step('Step 4/7: Build Desktop TypeScript');

  if (SKIP_BUILD) {
    log('warn', 'Skipping build (--skip-build)');
  } else {
    // First build protocol package (dependency).
    const protoResult = run('pnpm', ['--filter', '@kairo/protocol', 'build'], { cwd: REPO_ROOT });
    if (protoResult.status !== 0) {
      log('warn', 'Protocol build failed — continuing anyway');
    }

    const result = run('pnpm', ['--filter', '@kairo/desktop', 'build'], { cwd: REPO_ROOT });

    if (result.status !== 0) {
      log('err', 'Desktop TypeScript build failed');
      exitCode = 1;
    } else {
      log('ok', 'Desktop TypeScript built');
    }
  }

  if (exitCode !== 0) {
    throw new Error('Desktop build failed');
  }

  // ── Step 5: Run electron-builder ────────────────────────────
  step('Step 5/7: Run electron-builder (NSIS + zip)');

  if (DRY_RUN) {
    log('info', 'DRY-RUN: skipping electron-builder');
  } else {
    // Clean previous dist.
    if (fs.existsSync(DIST_DIR)) {
      fs.rmSync(DIST_DIR, { recursive: true, force: true });
    }

    const result = run('npx', [
      'electron-builder',
      '--win',
      '--config', path.join(DESKTOP_DIR, 'electron-builder.yml'),
    ], { cwd: DESKTOP_DIR, timeout: 600_000 });

    if (result.status !== 0) {
      log('err', `electron-builder failed with exit code ${result.status}`);
      exitCode = 1;
    } else {
      log('ok', 'electron-builder completed');
    }
  }

  if (exitCode !== 0) {
    throw new Error('electron-builder failed');
  }

  // ── Step 6: Post-build Verification ─────────────────────────
  step('Step 6/7: Post-build Verification (Smoke Test)');

  if (!DRY_RUN && !SKIP_SMOKE) {
    const distFiles = fs.existsSync(DIST_DIR) ? fs.readdirSync(DIST_DIR) : [];
    const setupExe = distFiles.find(f => f.endsWith('.exe') && f.includes('Setup'));
    const zipFile = distFiles.find(f => f.endsWith('.zip'));
    const blockmapFile = distFiles.find(f => f.endsWith('.blockmap'));

    // Verify NSIS installer.
    if (setupExe) {
      const setupPath = path.join(DIST_DIR, setupExe);
      const size = fileSize(setupPath);
      if (size < 1024 * 1024) {
        log('err', `Installer too small: ${formatBytes(size)} (expected >= 1 MB)`);
        exitCode = 1;
      } else {
        log('ok', `Installer: ${setupExe} (${formatBytes(size)})`);
      }
    } else {
      log('err', 'NSIS installer (.exe) not found in dist/');
      exitCode = 1;
    }

    // Verify zip.
    if (zipFile) {
      const zipPath = path.join(DIST_DIR, zipFile);
      const size = fileSize(zipPath);
      if (size < 50 * 1024 * 1024) {
        log('warn', `Zip file seems small: ${formatBytes(size)} (expected >= 50 MB)`);
      }
      log('ok', `Zip: ${zipFile} (${formatBytes(size)})`);
    } else {
      log('warn', 'Zip file not found in dist/');
    }

    // Verify blockmap.
    if (blockmapFile) {
      log('ok', `Blockmap: ${blockmapFile}`);
    }

    // Verify win-unpacked exists and contains the agent binary.
    const unpackedDir = path.join(DIST_DIR, 'win-unpacked');
    if (fs.existsSync(unpackedDir)) {
      const agentInDist = path.join(unpackedDir, 'resources', 'bin', 'kairo-runtime.exe');
      if (fs.existsSync(agentInDist)) {
        log('ok', `Agent binary in dist: ${formatBytes(fileSize(agentInDist))}`);
      } else {
        log('warn', 'Agent binary not found in win-unpacked/resources/bin/');
      }
    }
  } else if (DRY_RUN) {
    log('info', 'DRY-RUN: skipping smoke test');
  } else {
    log('warn', 'Skipping smoke test (--skip-smoke)');
  }

  // ── Step 7: Generate Checksums ──────────────────────────────
  step('Step 7/7: Generate Checksums');

  if (!DRY_RUN) {
    const distFiles = fs.existsSync(DIST_DIR) ? fs.readdirSync(DIST_DIR) : [];
    const checksumLines = [];

    for (const file of distFiles) {
      const filePath = path.join(DIST_DIR, file);
      if (fs.statSync(filePath).isFile()) {
        const hash = sha256File(filePath);
        checksumLines.push(`${hash}  ${file}`);
        log('info', `SHA256 ${file}: ${hash.slice(0, 16)}...`);
      }
    }

    if (checksumLines.length > 0) {
      const checksumPath = path.join(DIST_DIR, 'checksums.txt');
      fs.writeFileSync(checksumPath, checksumLines.join('\n') + '\n');
      log('ok', `Checksums written to dist/checksums.txt (${checksumLines.length} files)`);
    }
  } else {
    log('info', 'DRY-RUN: skipping checksums');
  }

  // ── Optional: Code Signing ──────────────────────────────────
  if (SIGN && !DRY_RUN) {
    step('Optional: Code Signing');

    const certPath = process.env.KAIRO_CODE_SIGN_CERT_PATH;
    const certPassword = process.env.KAIRO_CODE_SIGN_PASSWORD;

    if (certPath && fs.existsSync(certPath)) {
      const signScript = path.join(REPO_ROOT, 'scripts', 'sign-release.cjs');
      const result = run('node', [signScript], { cwd: REPO_ROOT });
      if (result.status === 0) {
        log('ok', 'Code signing completed');
      } else {
        log('warn', `Code signing exited with ${result.status}`);
      }
    } else {
      log('warn', 'No code signing certificate available (set KAIRO_CODE_SIGN_CERT_PATH and KAIRO_CODE_SIGN_PASSWORD)');
    }
  }

  // ── Summary ─────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${CYAN}  Packaging Complete${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`  Status:  ${exitCode === 0 ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`}`);
  console.log(`  Elapsed: ${elapsed}s`);
  console.log(`  Output:  ${path.relative(REPO_ROOT, DIST_DIR)}`);
  console.log('');

  if (exitCode === 0) {
    const distFiles = fs.existsSync(DIST_DIR) ? fs.readdirSync(DIST_DIR) : [];
    console.log('  Artifacts:');
    for (const file of distFiles) {
      if (fs.statSync(path.join(DIST_DIR, file)).isFile()) {
        console.log(`    ${path.join(DIST_DIR, file)}`);
      }
    }
    console.log('');
  }

} catch (err) {
  log('err', `Pipeline failed: ${err.message}`);
  exitCode = 1;
}

process.exit(exitCode);