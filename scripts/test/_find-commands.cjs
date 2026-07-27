const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Let's find all commands related to opening folders
const commands = [];
const patterns = [
  /id:"([^"]*open[^"]*folder[^"]*)"/gi,
  /id:"([^"]*workspace[^"]*open[^"]*)"/gi,
  /id:"([^"]*navigator[^"]*open[^"]*)"/gi,
];
for (const pat of patterns) {
  let m;
  while ((m = pat.exec(c)) !== null) {
    commands.push(m[1]);
  }
}
console.log('Folder/workspace open commands:', [...new Set(commands)].slice(0, 20));

// Also look for "Add Root Folder" or "Open Folder" command
const addRoot = c.indexOf('Add Root Folder');
console.log('\n"Add Root Folder" at:', addRoot);
if (addRoot > 0) {
  // Find command id nearby
  const ctx = c.slice(Math.max(0, addRoot-500), addRoot+100);
  const idMatch = ctx.match(/id:"([^"]+)"/g);
  console.log('Nearby command IDs:', idMatch);
}

const openFolder = c.indexOf('Open Folder');
console.log('\n"Open Folder" at:', openFolder);
if (openFolder > 0) {
  const ctx = c.slice(Math.max(0, openFolder-500), openFolder+100);
  const idMatch = ctx.match(/id:"([^"]+)"/g);
  console.log('Nearby command IDs:', idMatch);
}
