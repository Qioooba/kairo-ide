const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Find the chunk start (where shared closure variables are defined)
// The chunk starts with (()=>{var ...
const wizModStart = 12765079;
const chunkStart = c.lastIndexOf('(()=>{var ', wizModStart);
console.log('Chunk start:', chunkStart);

// Get the chunk header (where all the module ID functions and helpers are defined)
// This is everything from chunkStart to the first module definition
const chunkHeader = c.slice(chunkStart, chunkStart + 200000);

// Search for Acs, li definitions
const acsPos = chunkHeader.indexOf('Acs=');
console.log('\nAcs= at', acsPos, 'in chunk header');
if (acsPos >= 0) {
  console.log(chunkHeader.slice(acsPos, acsPos + 150));
}

const liPos = chunkHeader.indexOf('li=');
console.log('\n--- li= occurrences ---');
let searchPos = 0;
while (true) {
  const p = chunkHeader.indexOf('li=', searchPos);
  if (p < 0) break;
  // Check it's a variable definition, not part of another word
  const before = chunkHeader[p-1];
  if (!before.match(/[a-zA-Z0-9_$]/)) {
    console.log(`  li= at ${p}:`, chunkHeader.slice(Math.max(0,p-20), p+80));
  }
  searchPos = p + 3;
  if (searchPos > 100000) break;
}
