const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Welcome module starts at 12820672, find its end
// The welcome module contains the code: let c=d=>{e.open(new Ics.default(d.rootPath))}
// Ics is a module variable defined with he(). Let's find where Ics is defined.
const welcomeModStart = 12820672;
// Search 20000 chars from module start for Ics
const welcomeMod = c.slice(welcomeModStart, welcomeModStart + 20000);
const icsPos = welcomeMod.indexOf('Ics=');
console.log('Ics= at', icsPos, 'from module start');
if (icsPos >= 0) {
  console.log(welcomeMod.slice(Math.max(0, icsPos-20), icsPos+100));
}

// Let's find all he() calls in the first 1000 chars of welcome module
const heAll = [...welcomeMod.slice(0,1000).matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)=he\(([A-Za-z_$][A-Za-z0-9_$]*)\)/g)];
console.log('\nhe() calls in first 1000 chars:');
for (const m of heAll) console.log(' ', m[1], '<-', m[2]);

// Actually Ics might be imported via a different pattern like var Ics = he(...)
// Let me search for "Ics=" more broadly in all patterns
const icsDefs = [...welcomeMod.matchAll(/Ics=he\(([^)]+)\)/g)];
console.log('\nIcs=he() patterns:', icsDefs.map(m => m[0]));

// Maybe Ics is defined before the module function? Let's look at the global scope
// Search for Ics as a var/let/const
const icsGlobal = c.indexOf('var Ics=');
console.log('\nvar Ics= at:', icsGlobal);
const icsLet = c.indexOf('let Ics=');
console.log('let Ics= at:', icsLet);
const icsLet2 = c.indexOf(',Ics=');
console.log(',Ics= at:', icsLet2);
