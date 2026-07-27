const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');
const marker = '[kairo] Open Project Folder clicked';
const idx = c.indexOf(marker);

// Show broader context around the click handler (500 chars before and after)
console.log('--- Context around onClick (500 chars before) ---');
console.log(c.slice(idx - 500, idx + 300));
