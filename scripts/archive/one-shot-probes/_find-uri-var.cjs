const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// The component is at position ~12766213. Let's find the module start to see imports
const compPos = 12765085;

// Look for module start - webpack modules are separated by patterns like 
// Let's find "use strict" in the webpack module
let modStart = c.lastIndexOf('"use strict";', compPos);
// Or find the module function wrapper
let wrapperStart = c.lastIndexOf('function(', modStart);
if (wrapperStart < modStart - 200) wrapperStart = c.lastIndexOf('=>{', modStart);
if (wrapperStart < modStart - 200) wrapperStart = c.lastIndexOf(',(', modStart);

console.log('Module start (use strict) at:', modStart);
console.log('Approx wrapper at:', wrapperStart);

// Show the imports/requires at the module start
const header = c.slice(Math.max(0, modStart - 200), modStart + 500);
console.log('\n--- Module header ---');
console.log(header);

// Find what URI is imported as - look for patterns like =he(*) near the top
// which are webpack require() calls
const reqPattern = /([A-Za-z_$][A-Za-z0-9_$]*)=he\(([A-Za-z_$][A-Za-z0-9_$]*)\(\)\)/g;
console.log('\n--- Variable assignments (he = webpack require) ---');
const moduleHeader = c.slice(modStart, modStart + 2000);
let m;
while ((m = reqPattern.exec(moduleHeader)) !== null) {
  console.log(`  ${m[1]} = require(${m[2]})`);
}

// Also look for specific URI patterns
const uriPatterns = [/URI=/g, /\bURI\b[:=]/g, /uri_1\./g, /new\s+([A-Z][a-zA-Z]*)\(/g];
console.log('\n--- URI-related patterns in module ---');
for (const pat of uriPatterns) {
  pat.lastIndex = 0;
  while ((m = pat.exec(moduleHeader)) !== null) {
    const ctx = moduleHeader.slice(Math.max(0, m.index - 10), m.index + 30);
    console.log(`  pos ${m.index}: ${ctx}`);
  }
}
