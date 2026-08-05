const asar = require('@electron/asar');
const buf = asar.extractFile(
  'G:/spaces/kairo-ide/apps/desktop/dist/run/resources/app.asar',
  'lib\\frontend\\bundle.js'
);
const s = buf.toString('utf8');
console.log('buffer 导入遗留', buf.includes(Buffer.from('导入遗留', 'utf8')));
console.log('buffer 导入项目', buf.includes(Buffer.from('导入项目', 'utf8')));
console.log('buffer Kairo: 导入', buf.includes(Buffer.from('Kairo: 导入', 'utf8')));
console.log('string \\u5bfc', s.includes('\\u5bfc\\u5165'));
let cn = 0;
for (const ch of s) {
  if (ch >= '\u4e00' && ch <= '\u9fff') cn++;
}
console.log('CJK count', cn);
const samples = [];
for (let i = 0; i < s.length && samples.length < 15; i++) {
  if (s[i] >= '\u4e00' && s[i] <= '\u9fff') {
    samples.push(s.slice(i, i + 40));
    i += 40;
  }
}
console.log(samples);
