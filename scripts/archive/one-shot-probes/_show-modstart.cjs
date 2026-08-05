const fs = require('fs');
const bundlePath = 'G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js';
const c = fs.readFileSync(bundlePath, 'utf8');

const marker = '[kairo] Open Project Folder clicked';
const idx = c.indexOf(marker);

// Find module start
const modStart = c.lastIndexOf('F(()=>{"use strict";', idx);
console.log('Module start:', modStart);
console.log('\n--- Module imports ---');
console.log(c.slice(modStart, modStart + 500));
