const a = require('@electron/asar');
const fs = require('fs');
try {
  // Use 'listPackage' to find the actual key, then read by header.
  const list = a.listPackage('dist/win-unpacked/resources/app.asar');
  const pkgEntry = list.find(p => p.endsWith('package.json'));
  console.log('Found entry:', JSON.stringify(pkgEntry));
  // Extract using that key verbatim
  const buf = a.extractFile('dist/win-unpacked/resources/app.asar', pkgEntry);
  fs.writeFileSync('artifacts/_pkg-extracted.json', buf);
  console.log('extracted', buf.length, 'bytes');
  console.log(buf.toString('utf-8'));
} catch (e) {
  console.log('err', e.message);
}
