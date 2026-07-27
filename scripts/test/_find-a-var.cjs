const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');
const marker = '[kairo] Open Project Folder clicked';
const idx = c.indexOf(marker);

// Look further back to find where variable A is assigned/used
console.log('--- Broader context (1500 chars before) ---');
const before = c.slice(idx - 1500, idx);
// Find assignments to A in this section
const aAssignments = [...before.matchAll(/[,;{]([A-Za-z_$]*)=result|\bA=\{|\bA=\w+\(|\.root\b/g)];
console.log(before);
