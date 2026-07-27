const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Find the open-project-btn area
const marker = 'data-testid":"open-project-btn"';
const idx = c.indexOf(marker);
if (idx < 0) { console.log('Marker not found'); process.exit(1); }

// Look at the broader function scope - find where the wizard component function starts
// Go back 3000 chars and look for variable patterns
const start = Math.max(0, idx - 4000);
const section = c.slice(start, idx + 500);

// Find what variables are available - look for patterns like ,Xn=new Yn or Xn=Yn or imports
// Find the component function definition
console.log('--- Looking for workspace service variable ---');

// Search for patterns near our onClick that look like service usage
// In minified React components with DI, injected services are destructured or accessed as properties
// Let's look for 'workspaceService' in the entire bundle (it might be mangled)
// Actually, let's find URI usage - it's typically imported as a named import

// Search for URI.file or new URI or URI.parse patterns
const uriPatterns = [...c.matchAll(/new ([A-Za-z_$][A-Za-z0-9_$]*)\.file\(/g)].slice(0, 10);
console.log('URI.file patterns found:');
for (const m of uriPatterns.slice(0,5)) {
  console.log(`  ${m[1]}.file at pos ${m.index}`);
}

// Search for addRoot or open patterns near the wizard
const openBtnSection = c.slice(Math.max(0, idx - 8000), idx + 2000);
const serviceHints = [...openBtnSection.matchAll(/\.open\(|\.addRoot\(|workspaceService|WorkspaceService/g)];
console.log('\nService hints in wizard area:');
serviceHints.slice(0, 20).forEach(m => {
  const ctx = openBtnSection.slice(Math.max(0, m.index - 30), m.index + 50);
  console.log(`  pos ${m.index - (idx-8000)}: ${ctx.replace(/\n/g, ' ')}`);
});
