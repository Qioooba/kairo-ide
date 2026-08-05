const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// The welcome module starts at 12820672
const welcomeModStart = 12820672;
const welcomeMod = c.slice(welcomeModStart, welcomeModStart + 3000);
// Find all he() imports
const heImports = [...welcomeMod.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)=he\(([A-Za-z_$][A-Za-z0-9_$]*)\)/g)];
console.log('Welcome module he() imports:');
for (const m of heImports) {
  console.log(' ', m[1], '<-', m[2]);
}

// Find where Ics is defined
const icsDef = welcomeMod.match(/Ics=he\(([A-Za-z_$][A-Za-z0-9_$]*)\)/);
console.log('\nIcs import:', icsDef ? icsDef[0] : 'not found in first 3000 chars');

// Look for URI factory: URI.default or default URI
// The URI module is usually something like: var URI = /** @class *
// In Theia, URI is from @theia/core/lib/common/uri
// Let's search for the module that exports URI as default
const uriDefault = c.indexOf('default:URI}');
console.log('\ndefault:URI at:', uriDefault);

// Actually, search for where the URI class is defined - look for the scheme parsing
const uriSchemeIdx = c.indexOf('URI\'s scheme must start with a letter');
console.log('URI scheme error at:', uriSchemeIdx);
if (uriSchemeIdx > 0) {
  // Find the surrounding module
  const modStart = c.lastIndexOf('F(()=>{"use strict";', uriSchemeIdx);
  console.log('URI module start:', modStart);
  // Find the module exports
  const modContent = c.slice(modStart, modStart+500);
  console.log(modContent);
}
