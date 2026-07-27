// scripts/_scan-bundle-hosts.cjs
// One-off script: list unique hosts referenced in the compiled
// frontend bundle. Used during offline-readiness review.
const fs = require('fs');
const path = require('path');
const bundlePath = path.resolve(__dirname, '..', 'apps', 'desktop', 'lib', 'frontend', 'bundle.js');
const text = fs.readFileSync(bundlePath, 'utf8');
const re = /https?:\/\/[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,}[^\s"'`,)}\]]*/g;
const hostCounts = new Map();
let m;
while ((m = re.exec(text)) !== null) {
  const u = m[0].replace(/[)\]\}\,;'"]+$/, '');
  let host;
  try { host = new URL(u).host; } catch { host = '<unparseable>'; }
  hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
}
const sorted = [...hostCounts.entries()].sort((a, b) => b[1] - a[1]);
console.log('Total unique hosts:', sorted.length);
console.log('Top hosts by URL count:');
for (const [host, count] of sorted) {
  console.log('  ' + String(count).padStart(4) + '  ' + host);
}
