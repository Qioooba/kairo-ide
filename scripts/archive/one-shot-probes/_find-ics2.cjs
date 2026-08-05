const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Ics=Acs(li()) at position 12820672 + 14934 = 12835606
// Let's look at context around ,Ics= at 12835605
const icsPos = 12835605;
console.log(c.slice(icsPos - 200, icsPos + 200));

// Now find what Acs is and what li() is
// Acs is likely a memoized/renamed require function
// Let's look at what functions are defined that wrap he()
// Actually, let's find where li is defined - it's probably a module ID function
// In webpack, module IDs can be numbers or strings. li() returns a module ID.

// Let's search for "function li" or "li=" near the module
const welcomeModStart = 12820672;
const beforeIcs = c.slice(welcomeModStart, icsPos);
// Find all variable assignments like X=Y() or X=he(Y()) etc.
const allAssignments = [...beforeIcs.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)=([A-Za-z_$][A-Za-z0-9_$]*)\(\)/g)];
console.log('\n\nAll X=Y() assignments before Ics (last 20):');
for (const m of allAssignments.slice(-20)) {
  console.log(' ', m[1], '=', m[2], '()');
}

// Find Acs function
const acsDef = c.indexOf('function Acs');
console.log('\nfunction Acs at:', acsDef);
if (acsDef > 0) {
  console.log(c.slice(acsDef, acsDef+200));
}

// li is likely a function that returns a module ID. Let's find "li=" or "function li"
const liDef = c.indexOf(';li=');
console.log('\n;li= at:', liDef);
// Let's also look for li as a function
const liFunc = c.indexOf('li=function');
console.log('li=function at:', liFunc);
const liArrow = c.indexOf('li=()=>');
console.log('li=()=> at:', liArrow);

// Actually in webpack, modules are accessed via numeric IDs
// li() probably returns a number (module ID for URI)
// Let me just try to find what li() returns by looking at its definition
const liDef2 = c.lastIndexOf('li=', icsPos);
console.log('\nlast li= before ics:', liDef2);
if (liDef2 > 0) {
  console.log(c.slice(liDef2, liDef2+200));
}
