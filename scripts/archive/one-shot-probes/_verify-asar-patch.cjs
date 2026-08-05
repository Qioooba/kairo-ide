const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const asarPath = path.join(__dirname, '../../dist/win-unpacked/resources/app.asar');
const bundleRel = 'apps/desktop/lib/frontend/bundle.js';

const buf = asar.extractFile(asarPath, bundleRel);
const content = buf.toString('utf8');

if (content.includes('window.__kairoOpenProject')) {
  console.log('VERIFIED: window.__kairoOpenProject is in the asar bundle');
} else {
  console.log('ERROR: Patch not found in asar bundle!');
  process.exit(1);
}

if (content.includes('[kairo] Open Project Folder clicked')) {
  console.log('VERIFIED: Open Project log message is present');
}
