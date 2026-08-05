const fs = require('fs');
const path = require('path');
const src = path.resolve(__dirname, '..', '..', 'bundled');
const dst = path.resolve(__dirname, '..', '..', 'dist', 'win-unpacked', 'resources', 'bundled');
const approvedDirectories = ['tomcat6', 'jdtls'];
fs.mkdirSync(dst, { recursive: true });
// Clean dst first
for (const e of fs.readdirSync(dst, { withFileTypes: true })) {
  fs.rmSync(path.join(dst, e.name), { recursive: true, force: true });
}
let copied = 0;
for (const name of approvedDirectories) {
  const from = path.join(src, name);
  const to = path.join(dst, name);
  if (fs.existsSync(from) && fs.statSync(from).isDirectory()) {
    fs.cpSync(from, to, { recursive: true });
    console.log(`[copy-bundled-dist] ${from} -> ${to}`);
    copied++;
  } else {
    console.log(`[copy-bundled-dist] WARN: ${from} not found`);
  }
}
console.log(`[copy-bundled-dist] OK: ${copied} dir(s) copied to ${dst}`);
