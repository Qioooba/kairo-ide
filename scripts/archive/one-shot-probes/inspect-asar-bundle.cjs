const asar = require('@electron/asar');
const fs = require('fs');
const asarPath = 'G:/spaces/kairo-ide/apps/desktop/dist/run/resources/app.asar';
const files = asar.listPackage(asarPath);
const f = files.find(x => x.includes('frontend') && x.endsWith('bundle.js'));
console.log('listed as', JSON.stringify(f));
const candidates = [
  'lib/frontend/bundle.js',
  '/lib/frontend/bundle.js',
  '\\lib\\frontend\\bundle.js',
  f,
  f && f.replace(/^\\+/, ''),
  f && f.replace(/\\/g, '/').replace(/^\//, ''),
];
let buf;
for (const p of candidates.filter(Boolean)) {
  try {
    buf = asar.extractFile(asarPath, p);
    console.log('extracted with', JSON.stringify(p), buf.length);
    break;
  } catch (e) {
    console.log('fail', JSON.stringify(p), e.message.slice(0, 100));
  }
}
if (!buf) process.exit(1);
const s = buf.toString('utf8');
for (const needle of [
  'kairo.project.import',
  'Kairo: Import Project',
  'Kairo: 导入项目',
  '导入遗留 Java 项目',
  'registerCommands called',
  'Kairo: Build',
  'Kairo: Show Servers',
  'command.importProject',
  '显示服务器',
  '无工作区',
  'Project: (no workspace)',
]) {
  console.log(JSON.stringify(needle), '=>', s.includes(needle));
}
const idx = s.indexOf('kairo.project.import');
console.log('context:', JSON.stringify(s.slice(Math.max(0, idx - 100), idx + 180)));
const ids = [...new Set(s.match(/kairo\.[a-zA-Z0-9_.]+/g) || [])];
console.log('unique kairo.* count', ids.length);
console.log(ids.filter(x => /project|build|server|view/.test(x)).slice(0, 60).join('\n'));
fs.writeFileSync('G:/spaces/kairo-ide/artifacts/e2e-windows/diagnose/bundle-kairo-ids.txt', ids.join('\n'));
