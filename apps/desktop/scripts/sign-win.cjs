#!/usr/bin/env node
'use strict';

/**
 * sign-win.cjs — Windows code signing helper for electron-builder.
 *
 * Electron-builder invokes this script via the `win.sign` config option
 * with the path to the unpacked executable. We use Microsoft's SignTool
 * or a custom signing approach.
 *
 * Environment variables (any alias works):
 *   KAIRO_CODE_SIGN_CERT_PATH | CSC_LINK     — Path to .pfx / .p12 certificate
 *   KAIRO_CODE_SIGN_PASSWORD  | CSC_KEY_PASSWORD — Certificate password
 *   KAIRO_CODE_SIGN_TIMESTAMP | CSC_TIMESTAMP_URL — Timestamp server (optional)
 *   KAIRO_REQUIRE_SIGNING=1 — Fail the build when signing is skipped or fails
 *     (default soft-exit for local unsigned builds).
 *
 * When a certificate path and password are configured, signing failures are
 * always fatal even without KAIRO_REQUIRE_SIGNING. Soft skip applies only
 * when no certificate is configured.
 *
 * Usage (called by electron-builder):
 *   node scripts/sign-win.cjs <path-to-exe>
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const requireSigning = process.env.KAIRO_REQUIRE_SIGNING === '1';

const certPath = process.env.KAIRO_CODE_SIGN_CERT_PATH || process.env.CSC_LINK || '';
const certPassword = process.env.KAIRO_CODE_SIGN_PASSWORD || process.env.CSC_KEY_PASSWORD || '';
const certConfigured = Boolean(certPath && certPassword);

function exitOnSigningFailure(code, message) {
  if (message) {
    if (code === 0) console.log(message);
    else console.error(message);
  }
  if (code !== 0 && (requireSigning || certConfigured)) {
    if (requireSigning) {
      console.error('[sign-win] KAIRO_REQUIRE_SIGNING=1 — treating signing failure as fatal');
    } else {
      console.error('[sign-win] Certificate configured but signing failed — fatal');
    }
    process.exit(1);
  }
  process.exit(code === 0 ? 0 : 0);
}

const exePath = process.argv[2];
if (!exePath) {
  exitOnSigningFailure(1, '[sign-win] No executable path provided');
}

if (!fs.existsSync(exePath)) {
  exitOnSigningFailure(1, `[sign-win] Executable not found: ${exePath}`);
}

// OFFLINE / AIR-GAPPED POLICY: Kairo IDE is designed for fully intranet
// deployment with zero internet connectivity. There is NO default public
// timestamp server. Operators who run code signing on a build host with
// internet access MUST set KAIRO_CODE_SIGN_TIMESTAMP to their corporate
// timestamp server (e.g. an internal RFC 3161 server). If it is unset
// we sign WITHOUT a trusted timestamp — Windows will still install the
// binary, but SmartScreen reputation will not include the timestamp.
const timestampServer =
  process.env.KAIRO_CODE_SIGN_TIMESTAMP || process.env.CSC_TIMESTAMP_URL || '';

if (!certConfigured) {
  exitOnSigningFailure(
    1,
    `[sign-win] No certificate configured — skipping signing for ${exePath}`,
  );
}

if (!fs.existsSync(certPath)) {
  exitOnSigningFailure(1, `[sign-win] Certificate not found: ${certPath}`);
}

const signArgs = ['sign', '/f', certPath, '/p', certPassword, '/fd', 'SHA256'];
if (timestampServer) {
  signArgs.push('/tr', timestampServer, '/td', 'SHA256');
} else {
  console.warn('[sign-win] KAIRO_CODE_SIGN_TIMESTAMP is not set — signing without a trusted timestamp (offline mode)');
}
signArgs.push(exePath);

console.log(`[sign-win] Signing: ${exePath}`);

// Try SignTool first (Windows SDK).
const signtoolResult = spawnSync('signtool', signArgs, { stdio: 'inherit' });

if (signtoolResult.status === 0) {
  console.log(`[sign-win] Signed successfully: ${exePath}`);
  process.exit(0);
}

// Fallback: try osslsigncode (cross-platform). osslsigncode requires
// -t only when a timestamp server is configured.
const osslArgs = ['sign', '-pkcs12', certPath, '-pass', certPassword, '-h', 'sha256', '-in', exePath, '-out', exePath];
if (timestampServer) {
  osslArgs.splice(4, 0, '-t', timestampServer);
}
const osslResult = spawnSync('osslsigncode', osslArgs, { stdio: 'inherit' });

if (osslResult.status === 0) {
  console.log(`[sign-win] Signed successfully with osslsigncode: ${exePath}`);
  process.exit(0);
}

// Fallback: Windows PowerShell 5.1 Set-AuthenticodeSignature via helper script.
if (process.platform === 'win32') {
  const helper = path.join(__dirname, 'sign-with-pfx.ps1');
  const scriptPath = helper;
  if (fs.existsSync(scriptPath)) {
    const psExe = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-ExePath',
      exePath,
      '-PfxPath',
      certPath,
      '-Password',
      certPassword,
    ];
    if (timestampServer) {
      args.push('-TimestampServer', timestampServer);
    }
    const psResult = spawnSync(psExe, args, { encoding: 'utf8', windowsHide: true });
    process.stdout.write(psResult.stdout || '');
    process.stderr.write(psResult.stderr || '');
    if (psResult.status === 0) {
      console.log(`[sign-win] Signed successfully via PowerShell: ${exePath}`);
      process.exit(0);
    }
    console.error(`[sign-win] PowerShell signing failed exit=${psResult.status}`);
  }
}

exitOnSigningFailure(1, '[sign-win] No signing tool available / all signing attempts failed — skipping');
