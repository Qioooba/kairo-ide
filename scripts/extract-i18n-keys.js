const fs = require('fs');
const path = require('path');

const dirs = [
  { path: 'packages/build-extension/src/browser', name: 'build' },
  { path: 'packages/git-extension/src/browser', name: 'git' },
  { path: 'packages/svn-extension/src/browser', name: 'svn' },
  { path: 'packages/search-extension/src/browser', name: 'search' },
  { path: 'packages/sql-extension/src/browser', name: 'sql' },
  { path: 'packages/test-extension/src/browser', name: 'test' },
  { path: 'packages/java-extension/src/browser', name: 'java' },
  { path: 'packages/remote-extension/src/browser', name: 'remote' },
];

const pattern = /(?:t\(|this\.t\(|i18n\.t\()\s*['"]([^'"]+)['"]/g;

const allKeys = new Set();
const byPackage = {};

for (const dir of dirs) {
  byPackage[dir.name] = new Set();
  const files = walk(path.join(process.cwd(), dir.path));
  for (const file of files) {
    if (!file.endsWith('.tsx')) continue;
    const content = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const key = m[1];
      allKeys.add(key);
      byPackage[dir.name].add(key);
    }
  }
}

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

const widgetKeys = Array.from(allKeys)
  .filter(k => k.startsWith('widget.'))
  .sort();
const commonKeys = Array.from(allKeys)
  .filter(k => k.startsWith('common.'))
  .sort();

console.log('=== widget keys ===');
for (const k of widgetKeys) console.log(k);
console.log('\n=== common keys ===');
for (const k of commonKeys) console.log(k);
console.log('\n=== counts by package ===');
for (const [name, set] of Object.entries(byPackage)) {
  console.log(`${name}: ${set.size}`);
}
console.log(`\nTotal widget: ${widgetKeys.length}`);
console.log(`Total common: ${commonKeys.length}`);
