const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Module starts at "use strict" position 12765086
const modStart = 12765086;
// Find end of module - next "use strict" or similar boundary
let modEnd = c.indexOf('"use strict";', modStart + 100);
if (modEnd < 0) modEnd = modStart + 50000;
const modCode = c.slice(modStart, modEnd);

// Search for "new " to find constructor calls (like new URI)
console.log('--- Constructor calls in module ---');
const newPattern = /new\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
let m;
const constructors = new Set();
while ((m = newPattern.exec(modCode)) !== null) {
  constructors.add(m[1]);
}
console.log([...constructors].sort());

// Search for URI.file patterns
console.log('\n--- .file() calls ---');
const filePattern = /([A-Za-z_$][A-Za-z0-9_$]*)\.file\s*\(/g;
while ((m = filePattern.exec(modCode)) !== null) {
  const ctx = modCode.slice(Math.max(0, m.index - 20), m.index + 40);
  console.log(`  ${m[1]}.file: ...${ctx.replace(/\n/g,' ')}...`);
}

// Search for any reference to URI
console.log('\n--- Searching for URI-related code ---');
// Look at imports in other modules - Epr.WorkspaceService is the workspace module
// URI is typically from @theia/core/lib/common/uri
// Let's look for patterns like ".Uri" or "URI" in the module
const uriRefs = [...modCode.matchAll(/\bURI\b|\bUri\b|\.uri\b|\buri\b/g)];
console.log('URI/Uri refs:', uriRefs.length);
for (const ref of uriRefs.slice(0, 20)) {
  const ctx = modCode.slice(Math.max(0, ref.index - 15), ref.index + 25);
  console.log(`  pos ${ref.index}: ${ctx.replace(/\n/g,' ')}`);
}

// Let's look at what the projectService.openWorkspace returns
// and see how workspace is set. Maybe we don't need URI.
// Instead of workspaceService.open(new URI(path)), we might be able to use
// a different approach. Let's look for how other parts of the code open folders.
