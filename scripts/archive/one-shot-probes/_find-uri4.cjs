const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');
const marker = '[kairo] Open Project Folder clicked';
const idx = c.indexOf(marker);

// Find the module start - look backwards for F(()=>{"use strict";
const moduleSegment = c.slice(Math.max(0, idx-200000), idx);
const modStart = moduleSegment.lastIndexOf('F(()=>{"use strict";');
const modContent = moduleSegment.slice(modStart);

// The module starts with variable declarations like:
// ri=he(Dn()),kpr=he(Xo()),pU=he(me()),xpr=he(GSe()),Epr=he(Ca())
// These are the imported modules. Let's find what URI is imported as.

// First, let's look at how Ics.default is defined - find Ics in the welcome module's imports
// The welcome module starts near position 12838480 - let's find it
const welcomeModStart = c.lastIndexOf('F(()=>{"use strict";', 12838480);
console.log('Welcome module start:', welcomeModStart);
const welcomeModContent = c.slice(welcomeModStart, welcomeModStart + 5000);
// Find where Ics is defined
const icsMatch = welcomeModContent.match(/([A-Za-z_$][A-Za-z0-9_$]*)=he\([^)]*\)[\s\S]{0,500}Ics\.default/);
if (!icsMatch) {
  // Search for Ics definition
  const icsDef = welcomeModContent.match(/Ics=he\(([^)]+)\)/);
  console.log('Ics import:', icsDef);
}

// Actually, let's search the wizard module's imports for URI
// The wizard module starts at modStart, and the variables are declared at the top
// Let's extract all the he() calls and see what they import
const importLines = modContent.slice(0, 1500);
console.log('\n--- Wizard module top imports ---');
console.log(importLines);

// Now, in the wizard module, let's search for where "URI" or "default" from URI module is used
// URI is from '@theia/core/lib/common/uri'
// In minified code, URI.default is the URI class
// Let's search for ".default" patterns used as constructors with `new `
const constructorDefaults = [...modContent.matchAll(/new\s+([A-Za-z_$][A-Za-z0-9_$]*)\.default\s*\(/g)];
console.log('\n--- new Xxx.default( patterns in wizard module ---');
for (const m of constructorDefaults) {
  console.log(' ', m[1], 'at', m.index, ':', modContent.slice(Math.max(0,m.index-50), m.index+80));
}
