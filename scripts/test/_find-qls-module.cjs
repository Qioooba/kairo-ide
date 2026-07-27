const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// The functional component destructuring was at pos 12766213
const destructurePos = 12766213;
const pattern = '{fileDialogService:n,projectService:e,activeProject:t,runtime:i,workspaceContext:r,workspaceService:o,onClose:s}';
let idx = c.indexOf(pattern);
if (idx < 0) idx = destructurePos;
console.log('Destructure at:', idx);

// Go back to find where this function starts (the Qls= definition)
let searchStart = idx;
let funcStart = -1;
for (let i = searchStart; i > Math.max(0, searchStart - 5000); i--) {
  // Look for variable assignment like var Qls= or ,Qls= or ;Qls=
  const chunk = c.slice(Math.max(0, i - 20), i + 10);
  if (/(?:var|const|let|,|;)\s*Qls\s*=/.test(chunk)) {
    funcStart = i;
    break;
  }
}
console.log('Function start at:', funcStart);

if (funcStart > 0) {
  // Show from function start to find module boundary
  const modSection = c.slice(Math.max(0, funcStart - 5000), funcStart + 200);
  // Find "use strict" before this
  const useStrict = c.lastIndexOf('"use strict";', funcStart);
  console.log('Nearest "use strict":', useStrict);
  
  // Show module header (imports)
  const header = c.slice(useStrict, useStrict + 2000);
  console.log('\n--- Module header from use strict ---');
  console.log(header);
  
  // Find all he() calls (webpack requires)
  const reqPattern = /([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*he\(([A-Za-z_$][A-Za-z0-9_$]*)\(\)\)/g;
  console.log('\n--- Webpack imports ---');
  let m;
  while ((m = reqPattern.exec(header)) !== null) {
    console.log(`  ${m[1]} = require(${m[2]}())`);
  }
}
