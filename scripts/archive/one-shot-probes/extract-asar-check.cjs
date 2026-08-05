const asar = require('@electron/asar');
const fs = require('fs');
const asarPath = 'G:/spaces/kairo-ide/apps/desktop/dist/run/resources/app.asar';
const files = asar.listPackage(asarPath);
const f = files.find(x => x.includes('frontend') && x.endsWith('bundle.js'));
console.log('listed as:', JSON.stringify(f));
// electron asar on windows lists with leading backslash; extract wants forward slashes without leading slash
const candidates = [
  'lib/frontend/bundle.js',
  '/lib/frontend/bundle.js',
  '\\lib\\frontend\\bundle.js',
  'lib\\frontend\\bundle.js',
  f,
  f && f.replace(/^\\+/, '').replace(/\\/g, '/'),
];
let buf;
for (const p of candidates) {
  if (!p) continue;
  try {
    buf = asar.extractFile(asarPath, p);
    console.log('extracted via', JSON.stringify(p), 'len', buf.length);
    break;
  } catch (e) {
    console.log('fail', JSON.stringify(p), e.message.slice(0, 100));
  }
}
if (!buf) process.exit(1);
const s = buf.toString('utf8');
const needles = [
  'kairo.project.import',
  'Kairo: Import Project',
  'Kairo: 导入项目',
  'registerCommands called',
  'Kairo: Build',
  'Kairo: Show Servers',
  'commands.importProject',
];
for (const n of needles) console.log(n, s.includes(n));
fs.writeFileSync('G:/spaces/kairo-ide/artifacts/e2e-windows/diagnose/bundle-needles.txt', needles.map(n => `${n}=${s.includes(n)}`).join('\n'));
