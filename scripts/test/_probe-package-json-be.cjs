// Search backend main.js for package.json references
const a = require('@electron/asar');
const s = a.extractFile('dist/win-unpacked/resources/app.asar', 'apps/desktop/lib/backend/main.js').toString('utf8');

const m1 = s.match(/['"]apps\/desktop\/package\.json['"]/g);
console.log('forward slash:', m1 ? m1.length : 0);
const m2 = s.match(/apps[\\\\/]desktop[\\\\/]package\.json/g);
console.log('either separator:', m2 ? m2.length : 0);
if (m2) console.log(m2.slice(0, 5).join('\n'));

// path.join( with package.json
const m3 = s.match(/path\.join\([^)]*package\.json[^)]*\)/g);
console.log('path.join with package.json:', m3 ? m3.length : 0);
if (m3) console.log(m3.slice(0, 5).join('\n'));

// env related
const m4 = s.match(/theiaEnvVar|envVariableServer/gi);
console.log('env var server:', m4 ? m4.length : 0);
