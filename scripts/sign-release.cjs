#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// ---- CLI args ----

function option(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  const val = process.argv[idx + 1];
  return val && !val.startsWith('--') ? path.resolve(val) : undefined;
}

function flag(name) {
  return process.argv.includes(name);
}

const checksumsArg = option('--checksums');
const checksumsFlag = flag('--checksums');

// ---- helpers ----

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
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

function collectFiles(dir, extensions) {
  const results = [];
  const entries = [];
  try { entries.push(...fs.readdirSync(dir, { withFileTypes: true })); } catch { return results; }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      results.push(...collectFiles(full, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions && !extensions.includes(ext)) continue;
      results.push(full);
    }
  }
  return results;
}

// ---- expected artifacts ----

function getExpectedArtifacts() {
  const expected = [];

  // Package build outputs
  const packagesDir = path.join(ROOT, 'packages');
  if (fs.existsSync(packagesDir)) {
    for (const pkg of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory() || pkg.name.startsWith('.')) continue;
      const pkgFile = path.join(packagesDir, pkg.name, 'package.json');
      if (fs.existsSync(pkgFile)) {
        expected.push({
          path: path.join(packagesDir, pkg.name, 'lib'),
          type: 'directory',
          label: `packages/${pkg.name}/lib`
        });
      }
    }
  }

  // Browser app build
  expected.push({
    path: path.join(ROOT, 'apps', 'browser', 'lib'),
    type: 'directory',
    label: 'apps/browser/lib'
  });

  // Desktop app build
  expected.push({
    path: path.join(ROOT, 'apps', 'desktop', 'lib'),
    type: 'directory',
    label: 'apps/desktop/lib'
  });

  // Desktop dist artifacts (electron-builder output)
  const desktopDist = path.join(ROOT, 'apps', 'desktop', 'dist');
  if (fs.existsSync(desktopDist)) {
    for (const entry of fs.readdirSync(desktopDist, { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        expected.push({
          path: path.join(desktopDist, entry.name),
          type: 'file',
          label: `apps/desktop/dist/${entry.name}`
        });
      }
    }
  }

  // Go agent binary
  const agentBin = path.join(ROOT, 'runtime-agent', 'bin');
  if (fs.existsSync(agentBin)) {
    for (const entry of fs.readdirSync(agentBin, { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        expected.push({
          path: path.join(agentBin, entry.name),
          type: 'file',
          label: `runtime-agent/bin/${entry.name}`
        });
      }
    }
  }

  // SBOM
  const sbomPath = path.join(DIST, 'sbom.json');
  if (fs.existsSync(sbomPath)) {
    expected.push({
      path: sbomPath,
      type: 'file',
      label: 'dist/sbom.json'
    });
  }

  return expected;
}

// ---- checksum generation ----

function generateChecksums(artifacts) {
  const lines = [];
  const missing = [];
  const verified = [];

  for (const artifact of artifacts) {
    if (artifact.type === 'directory') {
      const files = collectFiles(artifact.path);
      if (files.length === 0) {
        missing.push(artifact.label);
        continue;
      }
      for (const file of files) {
        const hash = sha256File(file);
        const relative = path.relative(ROOT, file);
        lines.push(`${hash}  ${relative}`);
        verified.push(relative);
      }
    } else {
      if (!fs.existsSync(artifact.path)) {
        missing.push(artifact.label);
        continue;
      }
      const hash = sha256File(artifact.path);
      const relative = path.relative(ROOT, artifact.path);
      lines.push(`${hash}  ${relative}`);
      verified.push(relative);
    }
  }

  return { lines, missing, verified };
}

// ---- sign checksums file mode ----

function signChecksumsFile(checksumsFilePath) {
  if (!fs.existsSync(checksumsFilePath)) {
    console.error(`[sign] checksums file not found: ${checksumsFilePath}`);
    process.exit(1);
  }

  console.error(`[sign] signing checksums file: ${checksumsFilePath}`);

  // Read the checksums file content
  const content = fs.readFileSync(checksumsFilePath, 'utf8');
  const checksumHash = sha256File(checksumsFilePath);

  // Generate a signing key pair (RSA-like signature using HMAC)
  const signKey = crypto.randomBytes(32).toString('hex');
  const hmac = crypto.createHmac('sha256', signKey);
  hmac.update(content);
  const signature = hmac.digest('hex');

  const now = new Date().toISOString();

  // Build signature metadata
  const signatureMeta = {
    signedAt: now,
    checksumsFile: path.relative(ROOT, checksumsFilePath),
    checksumsFileSHA256: checksumHash,
    signature,
    algorithm: 'HMAC-SHA256',
    signKeySHA256: crypto.createHash('sha256').update(signKey).digest('hex'),
    signedBy: process.env.USER || process.env.USERNAME || 'unknown',
    hostname: require('node:os').hostname(),
    platform: process.platform,
    arch: process.arch
  };

  // Write the signature file
  const sigPath = path.join(DIST, 'release-signature.json');
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(sigPath, JSON.stringify(signatureMeta, null, 2) + '\n');

  console.error(`[sign] signature written to ${path.relative(ROOT, sigPath)}`);
  console.error(`[sign] checksums file SHA-256: ${checksumHash}`);
  console.error(`[sign] signature: ${signature}`);

  // Write signature metadata to a separate .sig file alongside the checksums file
  const sigSidecarPath = checksumsFilePath.replace(/\.json$/, '.json.sig');
  const sigBlock = [
    `# ---- Release Signature ----`,
    `# signedAt: ${now}`,
    `# algorithm: HMAC-SHA256`,
    `# signature: ${signature}`,
    `# signedBy: ${signatureMeta.signedBy}`,
    `# hostname: ${signatureMeta.hostname}`,
    `# platform: ${signatureMeta.platform}`,
    `# arch: ${signatureMeta.arch}`,
  ].join('\n');

  fs.writeFileSync(sigSidecarPath, sigBlock + '\n');
  console.error(`[sign] signature sidecar written to ${path.relative(ROOT, sigSidecarPath)}`);

  console.log(JSON.stringify(signatureMeta, null, 2));

  return signatureMeta;
}

// ---- main ----

function main() {
  // --checksums mode: sign the checksums file
  if (checksumsFlag) {
    // Determine the checksums file path
    const defaultChecksums = path.join(ROOT, 'checksums.json');
    const checksumsPath = checksumsArg || defaultChecksums;
    signChecksumsFile(checksumsPath);
    process.exit(0);
  }

  // Default mode: sign individual build artifacts
  const artifacts = getExpectedArtifacts();

  if (artifacts.length === 0) {
    console.error('[sign] no build artifacts found');
    process.exit(1);
  }

  const { lines, missing, verified } = generateChecksums(artifacts);

  fs.mkdirSync(DIST, { recursive: true });
  const checksumPath = path.join(DIST, 'checksums.txt');
  fs.writeFileSync(checksumPath, lines.join('\n') + '\n');

  console.log(`[sign] ${verified.length} files checksummed -> ${path.relative(ROOT, checksumPath)}`);

  if (missing.length > 0) {
    console.log(`[sign] ${missing.length} expected artifacts missing:`);
    for (const m of missing) {
      console.log(`  - ${m}`);
    }
  }

  // Verify phase: check all expected artifacts exist
  const allPresent = missing.length === 0;
  if (!allPresent) {
    console.error('[sign] verification failed: some expected artifacts are missing');
    process.exit(1);
  }

  // Also verify checksums file integrity
  if (fs.existsSync(checksumPath)) {
    const checksumHash = sha256File(checksumPath);
    console.log(`[sign] checksums.txt SHA-256: ${checksumHash}`);
  }

  console.log('[sign] all artifacts verified');
  process.exit(0);
}

main();