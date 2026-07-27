const a = require('@electron/asar');
const items = a.listPackage('dist/win-unpacked/resources/app.asar');
const r = items.filter(x => x.includes('desktop') && x.length < 80);
console.log('apps/desktop items in asar:', r.length);
console.log(r.join('\n'));
console.log('---');
console.log('Total items:', items.length);
