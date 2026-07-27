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

function patchFile(filePath, patches, label) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[postbuild] ${label} target not found: ${filePath}`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const { from, to } of patches) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[postbuild] ${label} patched successfully`);
  } else {
    console.log(`[postbuild] ${label} already patched or pattern not found`);
  }
}

const frontendBundle = path.join(outDir, 'bundle.js');
patchFile(frontendBundle, [
  {
    from: 'throw new Error(ERRORS_MSGS.DUPLICATED_INJECTABLE_DECORATOR);',
    to: 'return target2; // patched: allow duplicate @injectable for Theia/Monaco compat'
  },
  {
    from: 'throw new Error(`An application error for \'${code}\' code is already declared`);',
    to: 'var dummy = Object.assign(function() { return new Impl(code, factory.apply(null, arguments), dummy); }, { code: code, is: function(arg) { return arg instanceof Impl && arg.code === code; } }); return dummy; // patched: allow duplicate ApplicationError codes'
  }
], 'frontend bundle runtime patches (inversify + ApplicationError)');

const backendMain = path.join(__dirname, 'lib', 'backend', 'main.js');
patchFile(backendMain, [
  {
    from: 'return require("drivelist/build/Release/drivelist.node");',
    to: 'return { list: function(cb) { cb(null, []); } };'
  }
], 'drivelist native binding in backend bundle');
