const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Let's look for URI.file usage across the bundle to find the URI variable name
// Look in the broader project-extension area
const searchStart = 12700000;
const searchEnd = 12900000;
const section = c.slice(searchStart, searchEnd);

console.log('--- URI.file usage in project-extension area ---');
const uriFilePat = /([A-Za-z_$][A-Za-z0-9_$]*)\.file\s*\(/g;
let m;
const uriVars = new Set();
while ((m = uriFilePat.exec(section)) !== null) {
  uriVars.add(m[1]);
  const ctx = section.slice(Math.max(0, m.index - 30), m.index + 50);
  console.log(`  ${m[1]}.file at ${searchStart + m.index}: ...${ctx.replace(/\n/g,' ')}...`);
}
console.log('\nURI variables found:', [...uriVars]);

// Also look for URI constructor patterns: "new X(" where X creates file URIs
console.log('\n--- Looking for URI from @theia/core imports ---');
// Search for patterns like =he(Dn()) which is the core module (ri=React is from Dn())
// Actually ri = require(Dn()) is React. Let me find what Ca() returns - Epr=require(Ca()) = workspace module
// Let me look for where URI is typically imported from - it's usually from a module like the core common uri
// Let me search the beginning of the webpack modules for URI definition
const uriDef = c.indexOf('class URI');
if (uriDef > 0) {
  console.log('URI class defined at:', uriDef);
  console.log(c.slice(uriDef - 50, uriDef + 200));
}
