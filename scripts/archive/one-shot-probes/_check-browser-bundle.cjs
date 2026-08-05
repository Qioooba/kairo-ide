const fs = require('fs');
const b = fs.readFileSync('g:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Check TOGGLE_TERMINAL pattern
const termPattern = 'TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")}';
const termIdx = b.indexOf(termPattern);
console.log('TOGGLE_TERMINAL pattern at:', termIdx);
if (termIdx >= 0) {
  console.log('Context:', JSON.stringify(b.substring(termIdx - 30, termIdx + termPattern.length + 30)));
}

// Check Debug Diagnostics menu
const diagMenu = 'label:"Debug Diagnostics",order:"z1"';
const diagIdx = b.indexOf(diagMenu);
console.log('\nDebug Diagnostics menu at:', diagIdx);
if (diagIdx >= 0) {
  console.log('Context:', JSON.stringify(b.substring(diagIdx - 200, diagIdx + 80)));
}

// Check OPEN_DEBUG_DIAGNOSTICS definition
const openDiag = 'OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}';
const openDiagIdx = b.indexOf(openDiag);
console.log('\nOPEN_DEBUG_DIAGNOSTICS def at:', openDiagIdx);
if (openDiagIdx >= 0) {
  const after = b.substring(openDiagIdx + openDiag.length, openDiagIdx + openDiag.length + 80);
  console.log('Context after def:', JSON.stringify(after));
}
