const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');
const codeUriIdx = 2124446;

// Find the variable name for the URI class
// Let's look backwards for the class/constructor definition
const uriClassArea = c.slice(Math.max(0, codeUriIdx-2000), codeUriIdx+500);
console.log('--- URI class area (before) ---');
console.log(uriClassArea);

// Find where this module starts
const modStart = c.lastIndexOf('F(()=>{"use strict";', codeUriIdx);
console.log('\n\nURI module start:', modStart);

// Find the module's export statement
const modContent = c.slice(modStart, codeUriIdx+500);
const exportMatch = modContent.match(/(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*class/);
console.log('Class var name:', exportMatch ? exportMatch[1] : 'not found');

// Also look for the module's registration number
// Webpack registers modules with numeric IDs
const regMatch = c.slice(Math.max(0, modStart-100), modStart+50);
console.log('\nModule registration context:');
console.log(regMatch);
