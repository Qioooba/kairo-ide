const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

const welcomeModStart = 12820672;
const wizModStart = 12765079;

const betweenWizWelcome = c.slice(wizModStart, welcomeModStart);
console.log('Distance between wizard and welcome modules:', welcomeModStart - wizModStart, 'chars');
console.log('First 200 chars between them:', betweenWizWelcome.slice(0, 200));

const moduleMarkers = [...betweenWizWelcome.matchAll(/F\(\(\)=>\{"use strict";/g)];
console.log('\nModule markers between wizard and welcome:', moduleMarkers.length);

console.log('\nBoth use Dn(), Xo(), Ca() - same module ID functions => SAME CLOSURE SCOPE!');
console.log('Available: Acs (importDefault), li() (URI module ID), he (require)');

const wizArea = c.slice(Math.max(0, wizModStart-500000), wizModStart);
const liFunc = wizArea.match(/function\s+li\s*\(\)\s*\{\s*return\s+(\d+)\s*\}/);
if (liFunc) {
  console.log('\nli() function found! Returns module ID:', liFunc[1]);
} else {
  const liArrow = wizArea.match(/li=\s*\(\)\s*=>\s*(\d+)/);
  console.log('\nli() as arrow:', liArrow ? liArrow[0] : 'not found');
}

const acsIdx = wizArea.lastIndexOf('function Acs');
if (acsIdx >= 0) {
  console.log('\nAcs function found at', acsIdx, 'from wizArea start:');
  console.log(wizArea.slice(acsIdx, acsIdx+300));
}

// Find Ecs too (importStar used in welcome)
const ecsIdx = wizArea.lastIndexOf('function Ecs');
if (ecsIdx >= 0) {
  console.log('\nEcs function found at', ecsIdx, 'from wizArea start:');
  console.log(wizArea.slice(ecsIdx, ecsIdx+300));
}
