const asar = require('@electron/asar');
const list = asar.listPackage('dist/win-unpacked/resources/app.asar');
const found = list.find(x => x.endsWith('main.js') && !x.includes('backend'));
if (found) {
  const buf = asar.extractFile('dist/win-unpacked/resources/app.asar', found.replace(/^\\/, ''));
  const content = buf.toString('utf8');
  // Find all instances of initFileLogger
  let pos = 0;
  let i = 0;
  while (pos < content.length) {
    const idx = content.indexOf('initFileLogger', pos);
    if (idx < 0) break;
    console.log(`--- ${i} at ${idx} ---`);
    console.log(content.substring(Math.max(0, idx - 100), idx + 200));
    pos = idx + 1;
    i++;
  }
  // Check for flog calls
  console.log('--- flog mentions ---');
  pos = 0; i = 0;
  while (pos < content.length) {
    const idx = content.indexOf('flog(', pos);
    if (idx < 0) break;
    console.log(`flog at ${idx}: ${content.substring(idx, idx + 150)}`);
    pos = idx + 1;
    i++;
    if (i > 10) break;
  }
}
