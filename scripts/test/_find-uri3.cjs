const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Search for workspaceService.open pattern from welcome widget
// The source is: void workspaceService.open(new URI(project.rootPath))
// Let's search for ".open(new"
let idx = 0;
const results = [];
while (true) {
  const pos = c.indexOf('.open(new', idx);
  if (pos < 0) break;
  results.push({ pos, ctx: c.slice(Math.max(0,pos-100), pos+200) });
  idx = pos + 1;
}
console.log('Found', results.length, '.open(new occurrences');
for (const r of results) {
  console.log('\nat', r.pos, ':');
  console.log(r.ctx);
}

// Also search for URI class definition - "class URI" or function URI
const uriClassIdx = c.indexOf('class URI');
console.log('\n\nclass URI at:', uriClassIdx);
if (uriClassIdx > 0) {
  console.log(c.slice(uriClassIdx, uriClassIdx+300));
}
