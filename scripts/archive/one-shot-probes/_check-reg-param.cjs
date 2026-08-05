const fs = require('fs');
const b = fs.readFileSync('g:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Find the registerCommands method - look before TOGGLE_TERMINAL
const termIdx = b.indexOf('registerCommand(Cn.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")})');
console.log('TOGGLE_TERMINAL at:', termIdx);

// Go back to find the method definition
const methodStart = b.lastIndexOf('registerCommands(', termIdx);
console.log('registerCommands( at:', methodStart);
if (methodStart >= 0) {
  // Show context from methodStart to a bit after
  console.log('\nMethod signature and first commands:');
  console.log(b.substring(methodStart - 50, methodStart + 500));
}

// Also check what variable is used before registerCommand calls
const prevCtx = b.substring(termIdx - 300, termIdx);
const regCmdMatches = [...prevCtx.matchAll(/([a-zA-Z0-9_$]*)\.?registerCommand\(/g)];
console.log('\nregisterCommand prefixes found before TOGGLE_TERMINAL:');
for (const m of regCmdMatches) {
  const prefix = m[1];
  const idx = m.index;
  console.log(`  prefix="${prefix}" at offset ${idx} (within prevCtx)`);
  console.log(`    context: ${JSON.stringify(b.substring(methodStart + idx - 20, methodStart + idx + 80))}`);
}
