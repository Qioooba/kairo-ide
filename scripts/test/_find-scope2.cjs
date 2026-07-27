const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// The modules are in the same chunk (closure), so Acs and li should be available
// Let me find li as a module ID getter more broadly
// Search for "li=" as a var/let/const/function in the parent scope

// First find where the webpack chunk starts that contains both modules
// Look backwards from wizModStart for the start of this chunk
const wizModStart = 12765079;
const chunkStart = c.lastIndexOf('(()=>{var ', wizModStart);
console.log('Chunk wrapper start:', chunkStart);
const chunkContent = c.slice(chunkStart, wizModStart + 60000);

// Find all "function NAME()" or "NAME=()=>" definitions that return numbers
const funcDefs = {};
const pats = [
  /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\)\s*\{[^}]*return\s+(\d+)[^}]*\}/g,
  /(?:var|let|const|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\(\)\s*=>\s*(\d+)/g,
  /(?:var|let|const|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*function\s*\(\)\s*\{[^}]*return\s+(\d+)[^}]*\}/g,
];
for (const pat of pats) {
  let m;
  while ((m = pat.exec(chunkContent)) !== null) {
    funcDefs[m[1]] = parseInt(m[2]);
  }
}

console.log('\nModule ID functions found:');
for (const [name, id] of Object.entries(funcDefs)) {
  if (name === 'li' || name === 'Ca' || name === 'Dn' || name === 'Xo' || name === 'GSe' || name === 'me') {
    console.log(`  ${name}() => ${id}  <-- known`);
  }
}

// Find all functions named Xx (2-letter names) that return numbers - these are module ID getters
const twoLetterFuncs = Object.entries(funcDefs).filter(([k,v]) => /^[A-Za-z]{2}$/.test(k));
console.log(`\nAll 2-letter module ID functions (${twoLetterFuncs.length}):`);
twoLetterFuncs.slice(0, 40).forEach(([k,v]) => console.log(`  ${k}() => ${v}`));

// Also find Acs and Ecs definitions  
const acsDef = chunkContent.match(/function\s+Acs\s*\([^)]*\)\s*\{([^}]{0,200})\}/);
console.log('\nAcs function:', acsDef ? acsDef[0].slice(0, 200) : 'not found');

const ecsDef = chunkContent.match(/function\s+Ecs\s*\([^)]*\)\s*\{([^}]{0,200})\}/);
console.log('Ecs function:', ecsDef ? ecsDef[0].slice(0, 200) : 'not found');
