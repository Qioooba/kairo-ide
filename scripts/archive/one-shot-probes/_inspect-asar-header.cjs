const fs = require('fs');
const asarPath = 'g:\\spaces\\kairo-ide\\dist\\win-unpacked\\resources\\app.asar';
const buf = fs.readFileSync(asarPath);
const headerPickleSize = buf.readUInt32LE(4);
const headerPickle = buf.slice(8, 8 + headerPickleSize);
const headerJsonByteLen = headerPickle.readUInt32LE(4);
const headerJson = headerPickle.slice(8, 8 + headerJsonByteLen).toString('utf8');
const header = JSON.parse(headerJson);

function findKeys(obj, prefix = '') {
  const result = [];
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const k of Object.keys(obj)) {
      const path = prefix ? prefix + '/' + k : k;
      result.push({ key: k, path });
      if (obj[k] && typeof obj[k] === 'object') {
        result.push(...findKeys(obj[k], path));
      }
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      result.push(...findKeys(v, prefix + '[' + i + ']'));
    });
  }
  return result;
}

const keys = findKeys(header);
// First 50 keys that look like file paths
const fileKeys = keys.filter(k => typeof k.key === 'string' && (k.key.includes('app') || k.key.includes('desktop') || k.key.includes('pack')));
console.log('Total keys with files:', fileKeys.length);
console.log('First 20 file keys:');
fileKeys.slice(0, 20).forEach(k => {
  const bytes = Buffer.from(k.key, 'utf8').toString('hex').match(/.{1,2}/g).join(' ');
  console.log(`  key=[${k.key}] hex=[${bytes}]`);
});
// Show top-level keys
const topKeys = Object.keys(header.files || {});
console.log('\nTop-level files keys:');
topKeys.slice(0, 20).forEach(k => {
  const bytes = Buffer.from(k, 'utf8').toString('hex').match(/.{1,2}/g).join(' ');
  console.log(`  key=[${k}] hex=[${bytes}]`);
});
