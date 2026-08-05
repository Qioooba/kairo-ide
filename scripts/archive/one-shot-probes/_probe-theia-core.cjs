// Find package.json references in the asar
const a = require('@electron/asar');
const s = a.extractFile('dist/win-unpacked/resources/app.asar', 'node_modules/@theia/core/lib/browser/bundle.js').toString('utf8');

const m1 = s.match(/apps[\\\\/]desktop[\\\\/]package\.json/g);
console.log('apps/desktop/package.json:', m1 ? m1.length : 0);
if (m1) console.log(m1.slice(0, 3).join('\n'));

const m2 = s.match(/package\.json['"]/g);
console.log('any package.json:', m2 ? m2.length : 0);

// path patterns
const m3 = s.match(/['"]\.\.\/package\.json['"]|readJsonPackage|getPackageJson|readPackageJson/g);
console.log('package.json helpers:', m3 ? m3.length : 0);
if (m3) console.log(m3.slice(0, 5).join('\n'));

// look for the EnvVariablesServer
const m4 = s.match(/EnvVariablesServer/g);
console.log('EnvVariablesServer:', m4 ? m4.length : 0);
