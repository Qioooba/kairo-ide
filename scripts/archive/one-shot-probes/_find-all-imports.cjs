const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

const modStart = 12765086; // "use strict"
// Find end of module: next module's "use strict" or F(()=> wrapper end
const modSection = c.slice(modStart, modStart + 30000);

// Find all he() calls (webpack requires)
const reqPat = /(?:^|[;,])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*he\(([a-zA-Z_$][a-zA-Z0-9_$]*)\(\)\)/g;
let m;
const imports = [];
while ((m = reqPat.exec(modSection)) !== null) {
  imports.push({ var: m[1], from: m[2], pos: modStart + m.index });
}
console.log('All webpack imports in module:');
for (const imp of imports) {
  console.log(`  ${imp.var} = require(${imp.from}()) at pos ${imp.pos}`);
}

// Now let's look for where URI would come from. It's a default import from @theia/core/lib/common/uri
// Let's look for how default imports are handled. In webpack, default imports are often accessed via .default
// Let's search for any variable that has a .file method (static method on URI)
console.log('\n--- Looking for URI.file pattern ---');
const filePat = /([a-zA-Z_$][a-zA-Z0-9_$]*)\.file\s*\(/g;
while ((m = filePat.exec(modSection)) !== null) {
  console.log(`  ${m[1]}.file() at ${modStart + m.index}`);
}

// Also search for URI being used as a constructor
const newUriPat = /new\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(\s*['"]file/g;
while ((m = newUriPat.exec(modSection)) !== null) {
  console.log(`  new ${m[1]}(file:) at ${modStart + m.index}`);
}
