#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LOCK_PATH = path.join(__dirname, 'supply-chain-lock.json');
const PLACEHOLDER = /(placeholder|update[_ -]?before|replace[_ -]?me|todo|example)/i;

function fail(message) {
  console.error(`[supply-chain] ERROR: ${message}`);
  process.exit(1);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function checkedSha256(raw, envName) {
  const value = String(raw || '').trim().toLowerCase().replace(/^sha256:/, '');
  if (!value) fail(`${envName} is required; dependency verification fails closed`);
  if (PLACEHOLDER.test(value)) fail(`${envName} contains a placeholder`);
  if (!/^[a-f0-9]{64}$/.test(value)) fail(`${envName} must contain exactly 64 hexadecimal characters`);
  return value;
}

function isLocalPath(value) {
  if (!value) return false;
  if (value.startsWith('file://')) return true;
  if (path.isAbsolute(value)) return true;
  return false;
}

function resolveLocalPath(value) {
  if (value.startsWith('file://')) {
    const parsed = new URL(value);
    return process.platform === 'win32'
      ? path.resolve(parsed.pathname.replace(/^\//, ''))
      : parsed.pathname;
  }
  return path.resolve(value);
}

function checkedUrl(raw, source) {
  const value = String(raw || '').trim();
  if (!value) fail(`${source} is required; dependency download fails closed`);
  if (PLACEHOLDER.test(value)) fail(`${source} contains a placeholder`);

  if (isLocalPath(value)) {
    const localPath = resolveLocalPath(value);
    if (!fs.existsSync(localPath)) fail(`${source} points to a local file that does not exist: ${localPath}`);
    return { isLocal: true, url: value, localPath };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${source} is not a valid URL or local file path`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    fail(`${source} must use HTTP, HTTPS, or point to a local file (file:// or absolute path)`);
  }
  if (parsed.username || parsed.password) fail(`${source} must not contain credentials`);
  return { isLocal: false, url: parsed.toString(), localPath: null };
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function loadEntry(id) {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch (error) {
    fail(`cannot read ${path.relative(ROOT, LOCK_PATH)}: ${error.message}`);
  }
  if (lock.schemaVersion !== 1 || !lock.dependencies || typeof lock.dependencies !== 'object') {
    fail('supply-chain lock has an unsupported schema');
  }
  const entry = lock.dependencies[id];
  if (!entry) fail(`unknown dependency lock id: ${id}`);
  for (const field of ['name', 'version', 'sha256Env', 'license']) {
    if (!entry[field] || typeof entry[field] !== 'string') fail(`${id}.${field} is required in the lock`);
  }
  if (!Array.isArray(entry.licenseFiles) || entry.licenseFiles.length === 0) {
    fail(`${id}.licenseFiles must contain at least one license file`);
  }
  return entry;
}

const id = option('--id');
const outputArg = option('--output');
const archiveArg = option('--archive');
const checkConfig = process.argv.includes('--check-config');
if (!id) fail('usage: fetch-verified-archive.cjs --id <lock-id> (--check-config | --output <path> | --archive <path>)');
const modeCount = Number(Boolean(outputArg)) + Number(Boolean(archiveArg)) + Number(checkConfig);
if (modeCount !== 1) fail('provide exactly one of --check-config, --output or --archive');

const entry = loadEntry(id);
const expected = checkedSha256(process.env[entry.sha256Env], entry.sha256Env);

if (checkConfig) {
  const urlValue = entry.archiveUrlEnv ? process.env[entry.archiveUrlEnv] : entry.archiveUrl;
  const result = checkedUrl(urlValue, entry.archiveUrlEnv || `${id}.archiveUrl`);
  const mode = result.isLocal ? 'local file' : (new URL(result.url).protocol === 'https:' ? 'HTTPS' : 'HTTP');
  console.log(`[supply-chain] configuration valid for ${id} ${entry.version} (${mode})`);
  process.exit(0);
}

if (archiveArg) {
  const archive = path.resolve(archiveArg);
  if (!fs.existsSync(archive) || !fs.statSync(archive).isFile()) fail(`archive does not exist: ${archive}`);
  const actual = sha256(archive);
  if (actual !== expected) fail(`${id} SHA-256 mismatch (expected ${expected}, actual ${actual})`);
  console.log(`[supply-chain] verified ${id} ${entry.version}: ${archive}`);
  process.exit(0);
}

const urlSource = entry.archiveUrlEnv || `${id}.archiveUrl`;
const urlValue = entry.archiveUrlEnv ? process.env[entry.archiveUrlEnv] : entry.archiveUrl;
const urlResult = checkedUrl(urlValue, urlSource);
const output = path.resolve(outputArg);
const parent = path.dirname(output);
fs.mkdirSync(parent, { recursive: true });
const temporary = `${output}.partial-${process.pid}`;
try {
  if (urlResult.isLocal) {
    fs.copyFileSync(urlResult.localPath, temporary);
    console.log(`[supply-chain] copied local archive for ${id} ${entry.version}`);
  } else {
    const curlArgs = [
      '--fail', '--location', '--silent', '--show-error',
      '--connect-timeout', '10', '--max-time', '30', '--output', temporary, urlResult.url
    ];
    if (urlResult.url.startsWith('https:')) {
      curlArgs.unshift('--proto', '=https', '--tlsv1.2');
    }
    const result = spawnSync('curl', curlArgs, { stdio: 'inherit', timeout: 35_000, killSignal: 'SIGKILL' });
    if (result.error) {
      fs.rmSync(temporary, { force: true });
      fail(`curl failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      fs.rmSync(temporary, { force: true });
      fail(`curl exited with status ${result.status}`);
    }
    console.log(`[supply-chain] downloaded ${id} ${entry.version}`);
  }
  const actual = sha256(temporary);
  if (actual !== expected) {
    fs.rmSync(temporary, { force: true });
    fail(`${id} SHA-256 mismatch (expected ${expected}, actual ${actual})`);
  }
  fs.renameSync(temporary, output);
  console.log(`[supply-chain] verified ${id} ${entry.version}: ${output}`);
} finally {
  fs.rmSync(temporary, { force: true });
}
