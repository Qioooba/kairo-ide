#!/usr/bin/env node
'use strict';

/**
 * sign-win.cjs — Windows code signing helper for electron-builder.
 *
 * Electron-builder invokes this script via the `win.sign` config option
 * with the path to the unpacked executable. We use Microsoft's SignTool
 * or a custom signing approach.
 *
 * Environment variables:
 *   KAIRO_CODE_SIGN_CERT_PATH  — Path to .pfx certificate
 *   KAIRO_CODE_SIGN_PASSWORD   — Certificate password
 *   KAIRO_CODE_SIGN_TIMESTAMP  — Timestamp server URL (optional)
 *
 * Usage (called by electron-builder):
 *   node scripts/sign-win.cjs <path-to-exe>
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const exePath = process.argv[2];
if (!exePath) {
  console.error('[sign-win] No executable path provided');
  process.exit(0); // Don't fail the build if nothing to sign.
}

if (!fs.existsSync(exePath)) {
  console.error(`[sign-win] Executable not found: ${exePath}`);
  process.exit(0);
}

const certPath = process.env.KAIRO_CODE_SIGN_CERT_PATH;
const certPassword = process.env.KAIRO_CODE_SIGN_PASSWORD;
// OFFLINE / AIR-GAPPED POLICY: Kairo IDE is designed for fully intranet
// deployment with zero internet connectivity. There is NO default public
// timestamp server. Operators who run code signing on a build host with
// internet access MUST set KAIRO_CODE_SIGN_TIMESTAMP to their corporate
// timestamp server (e.g. an internal RFC 3161 server). If it is unset
// we sign WITHOUT a trusted timestamp — Windows will still install the
// binary, but SmartScreen reputation will not include the timestamp.
const timestampServer = process.env.KAIRO_CODE_SIGN_TIMESTAMP || '';

if (!certPath || !certPassword) {
  console.log(`[sign-win] No certificate configured — skipping signing for ${exePath}`);
  process.exit(0);
}

if (!fs.existsSync(certPath)) {
  console.error(`[sign-win] Certificate not found: ${certPath}`);
  process.exit(0); // Don't fail the build.
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

console.log('[sign-win] No signing tool available — skipping');
process.exit(0);