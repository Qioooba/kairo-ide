// Search backend main.js for theia env vars
const a = require('@electron/asar');
const s = a.extractFile('dist/win-unpacked/resources/app.asar', 'apps/desktop/lib/backend/main.js').toString('utf8');

const matches = s.match(/THEIA_[A-Z_]+/g) || [];
console.log('THEIA_* env vars:', [...new Set(matches)].join(', '));

// Check for user home / settings.json patterns
const m2 = s.match(/userStoragePath|user_home|HOME_DIR|envVarServer|getValue\(.{1,40}home.{0,20}\)/g) || [];
console.log('user home patterns:', m2.slice(0, 10).join(', '));

// Find the function that resolves user home
const m3 = s.match(/userHome|envVariablesServer|getUserStorage/gi) || [];
console.log('user storage:', m3.slice(0, 10).join(', '));
