const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Search for Qls= definition
const pattern = /Qls\s*=\s*(?:\([^)]*\)|{[^}]*})?\s*=>/g;
let m;
while ((m = pattern.exec(c)) !== null) {
  console.log('Qls defined at:', m.index);
  const ctx = c.slice(Math.max(0, m.index - 100), m.index + 200);
  console.log(ctx);
  console.log('---');
}

// Also search for Qls being imported or assigned from a require
const reqPattern = /Qls\s*=\s*he\(/g;
while ((m = reqPattern.exec(c)) !== null) {
  console.log('Qls from require at:', m.index);
  const ctx = c.slice(Math.max(0, m.index - 100), m.index + 200);
  console.log(ctx);
  console.log('---');
}
