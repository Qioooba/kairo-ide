// scripts/_scan-bundle-urls.cjs
// One-off script: scan the compiled frontend bundle for hardcoded
// external URLs that could trigger network access on a fully
// air-gapped Windows machine. Used during offline-readiness review.

const fs = require('fs');
const path = require('path');

const bundlePath = path.resolve(__dirname, '..', 'apps', 'desktop', 'lib', 'frontend', 'bundle.js');
const text = fs.readFileSync(bundlePath, 'utf8');

// 1) All http(s) URLs that contain a dot, anchored to typical
//    URL character classes. Stop at obvious string terminators.
const re = /https?:\/\/[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,}[^\s"'`,)}\]]*/g;
const found = new Map();
let m;
while ((m = re.exec(text)) !== null) {
  const raw = m[0];
  const u = raw.replace(/[)\]\}\,;'"]+$/, '');
  if (!found.has(u)) found.set(u, 0);
  found.set(u, found.get(u) + 1);
}

// 2) Categorize by host.
const byHost = new Map();
for (const u of found.keys()) {
  let host;
  try { host = new URL(u).host; } catch { host = '<unparseable>'; }
  if (!byHost.has(host)) byHost.set(host, []);
  byHost.get(host).push(u);
}

const sortedHosts = [...byHost.keys()].sort();
console.log('Unique external URLs:', found.size);
console.log('Unique hosts:', sortedHosts.length);
console.log();
for (const h of sortedHosts) {
  console.log('--- ' + h + ' ---');
  for (const u of byHost.get(h)) {
    console.log('  ' + found.get(u) + 'x  ' + u);
  }
}
