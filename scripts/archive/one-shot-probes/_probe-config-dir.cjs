// Search for THEIA_CONFIG_DIR pattern
const a = require('@electron/asar');
const s = a.extractFile('dist/win-unpacked/resources/app.asar', 'apps/desktop/lib/backend/main.js').toString('utf8');

// THEIA_CONFIG_DIR - how it's used
const m = s.match(/.{40}THEIA_CONFIG_DIR.{80}/g);
console.log('THEIA_CONFIG_DIR usage:');
if (m) m.slice(0, 3).forEach(x => console.log('  ' + x));

// Look for the EnvVariablesServer implementation
const m2 = s.match(/EnvVariablesServer[^,;)\n]{0,200}/g);
console.log('\nEnvVariablesServer:');
if (m2) m2.slice(0, 3).forEach(x => console.log('  ' + x));

// Find the actual config dir logic
const m3 = s.match(/.{30}configDir.{80}/g);
console.log('\nconfigDir:');
if (m3) m3.slice(0, 5).forEach(x => console.log('  ' + x));
