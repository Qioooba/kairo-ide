const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Find where the wizard module is, and look at what variables are in the SCOPE around it
const marker = '[kairo] Open Project Folder clicked';
const idx = c.indexOf(marker);

// Look at the broader scope - the wizard module is wrapped in some F() registration
// Let's find all variable declarations within 50000 chars BEFORE the wizard module
// by looking at the outer webpack function scope

// First, let's find where the wizard module starts in the bundle
const wizModStart = c.lastIndexOf('F(()=>{"use strict";', idx);
console.log('Wizard module at:', wizModStart);

// Look at the code BEFORE the wizard module - this is the parent closure
// Find variables defined in the parent scope that might be URI-related
const beforeWiz = c.slice(Math.max(0, wizModStart - 100000), wizModStart);

// Search for "URI" related definitions - function URI, class URI, etc.
// Look for static methods or prototype properties that identify URI class
const uriPatterns = [
  /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{[^}]{0,200}this\.scheme/g,
  /([A-Za-z_$][A-Za-z0-9_$]*)\.prototype\.withScheme/g,
  /([A-Za-z_$][A-Za-z0-9_$]*)\.file\s*=\s*function/g,
  /([A-Za-z_$][A-Za-z0-9_$]*)\.fromFilePath/g,
  /displayName:\s*"URI"/g,
];

for (const pat of uriPatterns) {
  const m = beforeWiz.match(pat);
  console.log(`Pattern ${pat}:`, m ? m.slice(0,5) : 'none');
}

// Search the entire bundle for URI.file static method (converts file path to URI)
const uriFileIdx = c.indexOf('.prototype.withScheme=');
console.log('\n.prototype.withScheme at:', uriFileIdx);
if (uriFileIdx > 0) {
  // Find the class/constructor this belongs to
  const before = c.slice(Math.max(0, uriFileIdx-500), uriFileIdx+100);
  console.log('Context:', before.slice(-300));
}

// Search for "codeUri" which is the monaco.Uri property in Theia's URI
const codeUriIdx = c.indexOf('codeUri');
console.log('\ncodeUri at:', codeUriIdx);
if (codeUriIdx > 0) {
  console.log(c.slice(Math.max(0, codeUriIdx-100), codeUriIdx+200));
}
