#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 60_000;

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

function walkDir(dir, skipDirs = new Set()) {
  const results = [];
  const entries = [];
  try { entries.push(...fs.readdirSync(dir, { withFileTypes: true })); } catch { return results; }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
      results.push(...walkDir(full, skipDirs));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

// ---- artifact collection ----

function collectArtifacts() {
  const artifacts = {};
  const skipDirs = new Set(['node_modules', '.git', 'lib']);

  // 1. Go Agent binary: runtime-agent/bin/kairo-runtime
  artifacts.agent = [];
  const goBinDir = path.join(ROOT, 'runtime-agent', 'bin');
  if (fs.existsSync(goBinDir)) {
    const entries = fs.readdirSync(goBinDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        artifacts.agent.push(path.join(goBinDir, entry.name));
      }
    }
  }

  // 2. Frontend bundle: packages/theia-product/lib/
  artifacts.frontend = [];
  const productLib = path.join(ROOT, 'packages', 'theia-product', 'lib');
  if (fs.existsSync(productLib)) {
    artifacts.frontend = walkDir(productLib, skipDirs);
  }

  // 3. JDT LS: bundled/jdtls/
  artifacts.jdtls = [];
  const jdtlsDir = path.join(ROOT, 'bundled', 'jdtls');
  if (fs.existsSync(jdtlsDir)) {
    artifacts.jdtls = walkDir(jdtlsDir, skipDirs);
  }

  // 4. Tomcat 6: bundled/tomcat6/
  artifacts.tomcat6 = [];
  const tomcatDir = path.join(ROOT, 'bundled', 'tomcat6');
  if (fs.existsSync(tomcatDir)) {
    artifacts.tomcat6 = walkDir(tomcatDir, skipDirs);
  }

  // 5. All scripts: scripts/*.cjs
  artifacts.scripts = [];
  const scriptsDir = path.join(ROOT, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    const entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.cjs')) {
        artifacts.scripts.push(path.join(scriptsDir, entry.name));
      }
    }
  }

  // 6. All docs: docs/*.md (recursive)
  artifacts.docs = [];
  const docsDir = path.join(ROOT, 'docs');
  if (fs.existsSync(docsDir)) {
    const allFiles = walkDir(docsDir, skipDirs);
    for (const file of allFiles) {
      if (file.endsWith('.md')) {
        artifacts.docs.push(file);
      }
    }
  }

  return artifacts;
}

// ---- generate checksums ----

function generateChecksums(artifacts) {
  const lines = [];
  const structured = {};

  for (const [category, files] of Object.entries(artifacts)) {
    const categoryEntries = [];
    for (const file of files.sort()) {
      const hash = sha256File(file);
      const relative = path.relative(ROOT, file);
      lines.push(`${hash}  ${relative}`);
      categoryEntries.push({ file: relative, sha256: hash });
    }
    structured[category] = {
      count: categoryEntries.length,
      files: categoryEntries
    };
  }

  return { lines, structured };
}

// ---- main ----

function main() {
  const overallTimer = setTimeout(() => {
    console.error('[checksums] TIMEOUT: exceeded 60s');
    process.exit(124);
  }, TIMEOUT_MS);

  const startTime = Date.now();

  console.error('[checksums] collecting artifacts...');
  const artifacts = collectArtifacts();

  const totalFiles = Object.values(artifacts).reduce((s, a) => s + a.length, 0);
  console.error(`[checksums] found ${totalFiles} files across ${Object.keys(artifacts).length} categories`);

  console.error('[checksums] generating SHA-256 checksums...');
  const { lines, structured } = generateChecksums(artifacts);

  // Timestamp for filename
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // Write .sha256 text file
  const sha256Path = path.join(ROOT, `checksums-${ts}.sha256`);
  fs.writeFileSync(sha256Path, lines.join('\n') + '\n');
  console.error(`[checksums] written ${sha256Path} (${totalFiles} entries)`);

  // Write .json structured file
  const jsonPath = path.join(ROOT, 'checksums.json');
  const jsonOutput = {
    generatedAt: now.toISOString(),
    timestamp: ts,
    totalFiles,
    categories: Object.keys(artifacts).reduce((acc, cat) => {
      acc[cat] = artifacts[cat].length;
      return acc;
    }, {}),
    entries: structured
  };
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2) + '\n');
  console.error(`[checksums] written ${jsonPath}`);

  // Also copy the .sha256 to checksums.json for the structured data
  const checksumsSha256 = sha256File(sha256Path);
  console.error(`[checksums] checksums.sha256 SHA-256: ${checksumsSha256}`);

  // Summary
  console.error(`[checksums] completed in ${Date.now() - startTime}ms`);
  console.log(JSON.stringify({
    ok: true,
    sha256File: sha256Path,
    jsonFile: jsonPath,
    sha256OfSha256: checksumsSha256,
    totalFiles,
    categories: jsonOutput.categories
  }, null, 2));

  clearTimeout(overallTimer);
}

main();