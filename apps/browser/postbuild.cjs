// Post-build step for @kairo/browser: copy static web assets into the
// generated frontend dir that the Theia backend serves at /.
// Currently: favicon.ico (browsers auto-request /favicon.ico; without
// this the console logs a 404 on every load — KAIRO-RC-WEB-016).
'use strict';

const fs = require('fs');
const path = require('path');

const assets = ['favicon.ico'];
const srcDir = path.join(__dirname, 'resources');
const outDir = path.join(__dirname, 'lib', 'frontend');

for (const asset of assets) {
  const src = path.join(srcDir, asset);
  const dst = path.join(outDir, asset);
  if (!fs.existsSync(src)) {
    console.error(`[postbuild] MISSING asset: ${src}`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`[postbuild] ${asset} -> ${path.relative(__dirname, dst)}`);
}
