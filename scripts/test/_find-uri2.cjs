const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Find URI class constructor in the bundle
// URI is typically imported as: var URI = require('@theia/core/lib/common/uri')
// In webpack bundle, this will be something like: Xt=he(ab()) where Xt is the URI class

// Search for "file:///" URI construction patterns
const patterns = [
  /new\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\s*["']file:\/\//g,
  /new\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*rootPath/g,
  /from\s+['"]@theia\/core\/lib\/common\/uri['"]/g,
];

for (const pat of patterns) {
  const matches = [];
  let m;
  while ((m = pat.exec(c)) !== null) {
    matches.push({ at: m.index, match: m[0].slice(0, 100), var: m[1] || '' });
    if (matches.length > 10) break;
  }
  console.log(`Pattern ${pat}:`, matches.length, 'matches');
  for (const mm of matches.slice(0,3)) {
    console.log('  at', mm.at, ':', mm.match, 'var=', mm.var);
    console.log('  ctx:', c.slice(Math.max(0,mm.at-50), mm.at+100));
  }
}

// Let's also look at how the welcome widget module opens projects
// Find the welcome widget module start
const welcomeIdx = c.indexOf('kairo-welcome-title');
console.log('\nkairo-welcome-title at:', welcomeIdx);
if (welcomeIdx > 0) {
  // Look backwards for the module start
  let depth = 0, modStart = 0;
  for (let i = welcomeIdx; i > Math.max(0, welcomeIdx-200000); i--) {
    if (c[i] === '}') depth++;
    if (c[i] === '{') {
      if (depth === 0) { modStart = i; break; }
      depth--;
    }
  }
  // Actually let's find "new URI" in the welcome widget area
  const welcomeArea = c.slice(Math.max(0, welcomeIdx-5000), welcomeIdx+5000);
  const uriInWelcome = welcomeArea.indexOf('new URI(');
  console.log('new URI in welcome area:', uriInWelcome);
  if (uriInWelcome >= 0) {
    console.log(welcomeArea.slice(Math.max(0, uriInWelcome-200), uriInWelcome+200));
  }
}
