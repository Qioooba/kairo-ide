const a = require('@electron/asar');
const fs = require('fs');
const list = a.listPackage('dist/win-unpacked/resources/app.asar');
const target = list.find(p => p.includes('backend\\main.js') && !p.includes('ipc-bootstrap'));
console.log('target:', JSON.stringify(target));
const buf = a.extractFile('dist/win-unpacked/resources/app.asar', target);
fs.writeFileSync('artifacts/_backend-main.js', buf);
console.log('wrote', buf.length, 'bytes');
