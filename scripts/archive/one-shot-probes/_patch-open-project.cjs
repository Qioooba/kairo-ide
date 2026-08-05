const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const browserBundle = path.join(repoRoot, 'apps', 'browser', 'lib', 'frontend', 'bundle.js');
const desktopBundle = path.join(repoRoot, 'apps', 'desktop', 'lib', 'frontend', 'bundle.js');

const c = fs.readFileSync(browserBundle, 'utf8');

// Find and fix the Open Project Folder onClick
const oldOnClick = 'onClick:async()=>{console.log("[kairo] Open Project Folder clicked, closing wizard; workspace is already the project parent."),s()}';
const newOnClick = 'onClick:async()=>{console.log("[kairo] Open Project Folder clicked",{root:A.root}),window.__kairoOpenProject?void window.__kairoOpenProject(A.root,s):s()}';

if (!c.includes(oldOnClick)) {
  console.error('ERROR: Could not find old onClick pattern in bundle.js');
  console.error('Looking for:', oldOnClick.slice(0, 100));
  process.exit(1);
}

const patched = c.replace(oldOnClick, newOnClick);

if (patched === c) {
  console.error('ERROR: Patch did not change the bundle');
  process.exit(1);
}

fs.writeFileSync(browserBundle, patched);
console.log('Patched browser bundle:', browserBundle);

// Copy to desktop if it exists
if (fs.existsSync(path.dirname(desktopBundle))) {
  fs.copyFileSync(browserBundle, desktopBundle);
  console.log('Copied to desktop bundle:', desktopBundle);
} else {
  console.log('Desktop frontend dir does not exist, will be handled by rebuild-asar');
}

// Verify
const verify = fs.readFileSync(browserBundle, 'utf8');
if (verify.includes('window.__kairoOpenProject')) {
  console.log('VERIFIED: window.__kairoOpenProject found in patched bundle');
} else {
  console.error('VERIFY FAILED');
  process.exit(1);
}

console.log('Done!');
