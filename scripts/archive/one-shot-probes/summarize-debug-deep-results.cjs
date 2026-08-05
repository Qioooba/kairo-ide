#!/usr/bin/env node
/**
 * Summarize Playwright JSON results for shard-06b into a Pass/Fail table.
 * Usage: node scripts/test/summarize-debug-deep-results.cjs [results.json] [out.md]
 */
const fs = require('node:fs');
const path = require('node:path');

const inFile = process.argv[2] || path.resolve('test-results/results.json');
const outFile = process.argv[3] || path.resolve('test-results/debug-deep-pass-fail.md');

if (!fs.existsSync(inFile)) {
  console.error(`Missing results file: ${inFile}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const rows = [];

function walkSuites(suites, prefix = '') {
  for (const s of suites || []) {
    const title = prefix ? `${prefix} › ${s.title}` : s.title;
    for (const spec of s.specs || []) {
      const results = (spec.tests || []).flatMap((t) => t.results || []);
      const last = results[results.length - 1];
      const status = last?.status || (spec.ok ? 'passed' : 'failed');
      const err = last?.error?.message || last?.errors?.[0]?.message || '';
      rows.push({
        id: spec.title,
        status,
        err: String(err).split('\n')[0].slice(0, 200),
      });
    }
    walkSuites(s.suites, title);
  }
}

walkSuites(data.suites || []);

const pass = rows.filter((r) => r.status === 'passed' || r.status === 'skipped').length;
const fail = rows.filter((r) => r.status === 'failed' || r.status === 'timedOut').length;

let md = `# Debug Deep Pass/Fail\n\nGenerated: ${new Date().toISOString()}\n\n`;
md += `Total: ${rows.length} | Pass/Skip: ${pass} | Fail: ${fail}\n\n`;
md += `| Case | Status | Notes |\n|------|--------|-------|\n`;
for (const r of rows) {
  md += `| ${r.id.replace(/\|/g, '/')} | ${r.status} | ${r.err.replace(/\|/g, '/')} |\n`;
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, md, 'utf8');
console.log(md);
console.log(`Wrote ${outFile}`);
