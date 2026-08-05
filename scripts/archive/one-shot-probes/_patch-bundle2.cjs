const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

// Re-extract fresh bundle from asar
const asarPath = path.join(__dirname, '../../dist/win-unpacked/resources/app.asar');
const extractDir = path.join(__dirname, '../../dist/win-unpacked/resources/app-extracted');
const bundleRel = 'apps/desktop/lib/frontend/bundle.js';

// Extract just the bundle from asar
const tmpDir = path.join(__dirname, 'tmp-patch');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

// Read fresh from asar
const bundleSrc = asar.extractFile(asarPath, bundleRel);
let bundle = bundleSrc.toString('utf8');
console.log('Read fresh bundle from asar, length:', bundle.length);

// 1. Add command definitions after OPEN_DEBUG_DIAGNOSTICS
// Pattern: n.OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}}
// Wait, need to find the actual namespace variable. Let's search:
const diagIdx = bundle.indexOf('OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics"');
if (diagIdx < 0) {
  console.error('Could not find OPEN_DEBUG_DIAGNOSTICS in bundle');
  process.exit(1);
}
// Find the namespace var by going back to find "var XX={...}" or "(XX||(YY.KairoCommands=XX={}))" pattern
let nsStart = diagIdx;
while (nsStart > 0 && bundle[nsStart] !== 'n' && bundle[nsStart] !== '.') nsStart--;
// Actually let's find the exact end of OPEN_DEBUG_DIAGNOSTICS definition
const defEnd = bundle.indexOf('}}', diagIdx);
console.log('OPEN_DEBUG_DIAGNOSTICS def ends at:', defEnd);
console.log('Def end context:', bundle.substring(defEnd - 80, defEnd + 30));

// Add new command definitions after OPEN_DEBUG_DIAGNOSTICS
const cmdDefsAdd = ',n.SHOW_WELCOME={id:"kairo.welcome.show",label:"Help: Welcome",category:"Help"},n.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}}}';
// Wait, need to check if the namespace is 'n' or 'Cn'
const beforeDiag = bundle.substring(diagIdx - 5, diagIdx);
console.log('Before OPEN_DEBUG_DIAGNOSTICS:', JSON.stringify(beforeDiag));

// Find the correct closing
const closeIdx = bundle.indexOf('}})(', diagIdx);
console.log('Namespace close at:', closeIdx);
if (closeIdx > 0) {
  console.log('Namespace close context:', bundle.substring(closeIdx - 50, closeIdx + 20));
}
