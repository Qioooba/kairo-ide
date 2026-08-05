const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');
const marker = '[kairo] Open Project Folder clicked';
const idx = c.indexOf(marker);

// Look for module start before ImportWizard - find the F(()=>{"use strict"; that starts the module
// Let's look backwards for the start of this module
let searchBack = c.slice(Math.max(0, idx-100000), idx);

// Find "ImportWizard" component definition start
// The module ends with "}});var _h,Tpr..." as we saw earlier
// Let's find "Qls=" which is the component variable
const qlsIdx = searchBack.lastIndexOf('Qls=(');
console.log('Qls= at offset:', qlsIdx);
if (qlsIdx > 0) {
  // Go back further to find the module start
  const modStart = searchBack.lastIndexOf('F(()=>{', qlsIdx);
  console.log('Module F(()=> at offset:', modStart);
  if (modStart > 0) {
    const modContent = searchBack.slice(modStart, qlsIdx + 200);
    console.log('\n--- Module beginning ---');
    // Find require/import calls that bring in URI
    const uriRefs = modContent.match(/[a-zA-Z_$][a-zA-Z0-9_$]*\([^)]*uri[^)]*\)/gi);
    console.log('URI-like references:', uriRefs);
    
    // Let's print the first 2000 chars of the module to see variable declarations
    console.log('\n--- First 2000 chars of module ---');
    console.log(modContent.slice(0, 2000));
  }
}

// Also, let's search for "new URI" pattern in the broader area
const broadArea = c.slice(Math.max(0, idx-200000), idx+10000);
const newUriMatches = [];
let p = 0;
while (true) {
  const pos = broadArea.indexOf('new URI(', p);
  if (pos < 0) break;
  newUriMatches.push({ pos, ctx: broadArea.slice(Math.max(0,pos-80), pos+120) });
  p = pos + 1;
}
console.log('\n--- new URI( occurrences ---');
console.log('Found:', newUriMatches.length);
for (const m of newUriMatches.slice(-5)) {
  console.log('...', m.ctx);
}
