const fs = require('fs');
const bundlePath = 'G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js';
const c = fs.readFileSync(bundlePath, 'utf8');

const marker = '[kairo] Open Project Folder clicked';
const idx = c.indexOf(marker);
console.log('Marker at:', idx);

// Show exact code around the onClick handler
const onClickStart = c.lastIndexOf('onClick:', idx);
const onClickEnd = c.indexOf('}', idx);
console.log('\n--- onClick code ---');
console.log(c.slice(onClickStart - 50, onClickEnd + 200));
