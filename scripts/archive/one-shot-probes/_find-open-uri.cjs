const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Find URI class usage near the wizard area
const marker = '[kairo] Open Project Folder clicked';
const idx = c.indexOf(marker);

// Find how URI is constructed - search for "new URI" or "file:///" near the import wizard section
// Let's look at what the scanPath function does - it calls projectService.openWorkspace
// In the source, workspaceService is available as prop 'o' (minified)
// We need to construct a file:// URI and call o.open(uri)

// Let me find how other parts of the code open a workspace
// Search for .open( near the wizard imports
const segment = c.slice(Math.max(0, idx-50000), idx);
const openCalls = [];
let searchIdx = 0;
while (true) {
  const pos = segment.indexOf('.open(', searchIdx);
  if (pos < 0) break;
  openCalls.push({ pos, ctx: segment.slice(Math.max(0,pos-100), pos+200) });
  searchIdx = pos + 1;
}
console.log('Found', openCalls.length, '.open( calls in vicinity');
// Show the last few which are likely near the wizard
for (const call of openCalls.slice(-5)) {
  console.log('\n--- .open( at offset', call.pos, '---');
  console.log(call.ctx.slice(0, 300));
}

// Also search for "new URI" or "URI.file" patterns
const uriFileIdx = segment.lastIndexOf('URI.file');
console.log('\n\nURI.file at offset:', uriFileIdx);
if (uriFileIdx > 0) {
  console.log(segment.slice(uriFileIdx-50, uriFileIdx+200));
}
