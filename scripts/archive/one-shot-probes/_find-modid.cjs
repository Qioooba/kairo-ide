const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// The wizard module uses: ri=he(Dn()),kpr=he(Xo()),pU=he(me()),xpr=he(GSe()),Epr=he(Ca())
// These Dn, Xo, me, GSe, Ca are functions that return numeric module IDs
// The welcome module uses: wd=Ecs(Dn()),Tcs=Xo(),emr=Ca(),Ics=Acs(li())
# So li() is also a module ID function that returns the URI module ID

// Let's find the module ID functions to see their return values
// They should be defined as: function Dn(){return N} or Dn=()=>N

// Look for li as a module ID function near the welcome module
const welcomeModStart = 12820672;
// Search backwards from welcome module for function definitions
const searchArea = c.slice(Math.max(0, welcomeModStart-500000), welcomeModStart);

// Find all simple module ID functions: X=()=>N or function X(){return N}
const idFuncs = {};
const patterns = [
  /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\)\s*\{\s*return\s+(\d+)\s*\}/g,
  /([A-Za-z_$][A-Za-z0-9_$]*)=\s*\(\)\s*=>\s*(\d+)/g,
];
for (const pat of patterns) {
  let m;
  while ((m = pat.exec(searchArea)) !== null) {
    idFuncs[m[1]] = parseInt(m[2]);
  }
}

// Look for li
console.log('Module ID function li:', idFuncs['li']);
console.log('Module ID function Dn:', idFuncs['Dn']);
console.log('Module ID function Ca:', idFuncs['Ca']);
console.log('Module ID function Xo:', idFuncs['Xo']);

// Also look for Acs (importDefault) and Ecs (importStar) functions
const acsDef = searchArea.match(/function\s+Acs\s*\(/);
console.log('\nAcs found:', !!acsDef);
const heDef = searchArea.match(/function\s+he\s*\(/);
console.log('he found:', !!heDef);

// Find Acs definition
const acsIdx = searchArea.lastIndexOf('function Acs');
if (acsIdx >= 0) {
  console.log('\nAcs function:');
  console.log(searchArea.slice(acsIdx, acsIdx+200));
}
