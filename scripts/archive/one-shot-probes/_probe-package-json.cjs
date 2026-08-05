// Quick check of asar bundle for package.json references
const a = require('@electron/asar');
const s = a.extractFile('dist/win-unpacked/resources/app.asar', 'apps/desktop/lib/frontend/bundle.js').toString('utf8');

// 1) raw "apps/desktop/package.json"
const m1 = s.match(/['"]apps\/desktop\/package\.json['"]/g);
console.log('forward slash:', m1 ? m1.length : 0);
// 2) raw "apps\desktop\package.json"
const m2 = s.match(/['"]apps\\desktop\\package\.json['"]/g);
console.log('backslash:', m2 ? m2.length : 0);
// 3) with path.posix.join etc
const m3 = s.match(/['"]apps['"]\s*,\s*['"]desktop['"]/g);
console.log('join components:', m3 ? m3.length : 0);
