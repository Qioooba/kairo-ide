const a = require('@electron/asar');
const items = a.listPackage('dist/win-unpacked/resources/app.asar');
// Try each format
const targets = [
  'apps\\desktop\\lib\\frontend\\bundle.js',
  'apps/desktop/lib/frontend/bundle.js',
  '\\apps\\desktop\\lib\\frontend\\bundle.js',
];
for (const t of targets) {
  try {
    const buf = a.extractFile('dist/win-unpacked/resources/app.asar', t);
    console.log('OK [' + t + '] size=' + buf.length);
  } catch (e) {
    console.log('FAIL [' + t + ']: ' + e.message);
  }
}
// Check what the actual filename looks like in the header
const buf = require('fs').readFileSync('dist/win-unpacked/resources/app.asar');
// First 8 bytes: pickle header length (uint32 BE) + 4 bytes pickle header
// Then a JSON of header which contains filenames
const headerLen = buf.readUInt32BE(0);
// Skip 4 bytes pickle header + 4 bytes size
// Actually the format is: 4 bytes pickle header (uint32 BE) + 4 bytes header length (uint32 BE) + header JSON
// Wait, let me check the source. The asar format is:
// 4 bytes: header_size (uint32 LE)
// 4 bytes: pickle header (uint32 LE)
// header_size bytes: JSON metadata
const headerSize = buf.readUInt32LE(0);
const pickleSize = buf.readUInt32LE(4);
console.log('headerSize:', headerSize, 'pickleSize:', pickleSize);
const headerJson = buf.slice(8, 8 + headerSize).toString('utf8');
const header = JSON.parse(headerJson);
console.log('Files with desktop:');
Object.keys(header.files).filter(k => k.includes('desktop')).slice(0, 10).forEach(k => console.log('  ', JSON.stringify(k)));
console.log('Sample full path key:');
const k = Object.keys(header.files).find(x => x.endsWith('main.js') && x.includes('desktop'));
console.log('  ', JSON.stringify(k));
