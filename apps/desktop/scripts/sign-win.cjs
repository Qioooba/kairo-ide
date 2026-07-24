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
const timestampServer = process.env.KAIRO_CODE_SIGN_TIMESTAMP || 'http://timestamp.digicert.com';

if (!certPath || !certPassword) {
  console.log(`[sign-win] No certificate configured — skipping signing for ${exePath}`);
  process.exit(0);
}

if (!fs.existsSync(certPath)) {
  console.error(`[sign-win] Certificate not found: ${certPath}`);
  process.exit(0); // Don't fail the build.
}

console.log(`[sign-win] Signing: ${exePath}`);

// Try SignTool first (Windows SDK).
const signtoolResult = spawnSync('signtool', [
  'sign',
  '/f', certPath,
  '/p', certPassword,
  '/fd', 'SHA256',
  '/tr', timestampServer,
  '/td', 'SHA256',
  exePath,
], { stdio: 'inherit' });

if (signtoolResult.status === 0) {
  console.log(`[sign-win] Signed successfully: ${exePath}`);
  process.exit(0);
}

// Fallback: try osslsigncode (cross-platform).
console.log('[sign-win] SignTool not available, trying osslsigncode...');
const osslResult = spawnSync('osslsigncode', [
  'sign',
  '-pkcs12', certPath,
  '-pass', certPassword,
  '-h', 'sha256',
  '-t', timestampServer,
  '-in', exePath,
  '-out', exePath,
], { stdio: 'inherit' });

if (osslResult.status === 0) {
  console.log(`[sign-win] Signed successfully with osslsigncode: ${exePath}`);
  process.exit(0);
}

console.log('[sign-win] No signing tool available — skipping');
process.exit(0);