const fs = require('fs');
const path = require('path');

require('ts-node/register');
const existingEn = require(path.join(process.cwd(), 'packages/i18n/src/locales/en.ts')).default;

const dirs = [
  'packages/build-extension/src/browser',
  'packages/git-extension/src/browser',
  'packages/svn-extension/src/browser',
  'packages/search-extension/src/browser',
  'packages/sql-extension/src/browser',
  'packages/test-extension/src/browser',
  'packages/java-extension/src/browser',
  'packages/remote-extension/src/browser',
];

const keyPattern = /(?:t\(|this\.t\(|i18n\.t\()\s*['"]([^'"]+)['"]/g;

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

const keys = new Set();
for (const dir of dirs) {
  for (const file of walk(path.join(process.cwd(), dir))) {
    if (!file.endsWith('.tsx')) continue;
    const content = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = keyPattern.exec(content)) !== null) keys.add(m[1]);
  }
}

const allKeys = Array.from(keys).sort();
const widgetKeys = allKeys.filter(k => k.startsWith('widget.'));
const commonKeys = allKeys.filter(k => k.startsWith('common.'));

function keyExists(root, dotPath) {
  const parts = dotPath.split('.');
  let node = root;
  for (const p of parts) {
    if (node == null || typeof node !== 'object') return false;
    if (!(p in node)) return false;
    node = node[p];
  }
  return true;
}

const missingWidget = widgetKeys.filter(k => !keyExists(existingEn, k));
const missingCommon = commonKeys.filter(k => !keyExists(existingEn, k));

console.log('Total keys:', allKeys.length);
console.log('Widget keys:', widgetKeys.length);
console.log('Missing widget keys:', missingWidget.length);
console.log('Common keys:', commonKeys.length);
console.log('Missing common keys:', missingCommon.length);
console.log('Missing common:', missingCommon);

// Group by package
const byPackage = {};
for (const key of missingWidget) {
  const parts = key.split('.');
  const pkg = parts[1];
  if (!byPackage[pkg]) byPackage[pkg] = 0;
  byPackage[pkg]++;
}
console.log('By package:', byPackage);
