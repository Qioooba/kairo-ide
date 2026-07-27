const { _electron: electron } = require('playwright');
const path = require('path');

const exePath = path.join(__dirname, 'apps/desktop/dist2/win-unpacked/Kairo IDE.exe');

(async () => {
  console.log('Launching Kairo IDE from:', exePath);
  process.env.KAIRO_DEV = '1';
  
  const electronApp = await electron.launch({
    executablePath: exePath,
    env: {
      ...process.env,
      KAIRO_DEV: '1',
    },
    timeout: 60000,
  });

  console.log('Electron app launched, waiting for window...');
  const window = await electronApp.firstWindow({ timeout: 60000 });
  console.log('Window opened, title:', await window.title());
  
  // Wait for app to be ready
  await window.waitForTimeout(10000);
  
  // Check console messages
  console.log('Checking console for errors...');
  const errors = [];
  window.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      errors.push(text);
      console.log('[ERROR]', text);
    }
  });
  window.on('pageerror', err => {
    errors.push(err.message);
    console.log('[PAGE ERROR]', err.message);
  });

  await window.waitForTimeout(5000);
  
  // Take a screenshot
  await window.screenshot({ path: 'test-screenshot.png' });
  console.log('Screenshot saved to test-screenshot.png');
  
  // Check URL
  const url = window.url();
  console.log('Current URL:', url);
  
  // Try to find welcome page or import wizard elements
  const pageContent = await window.content();
  const hasWelcome = pageContent.includes('Welcome') || pageContent.includes('欢迎') || pageContent.includes('Import');
  console.log('Has welcome/import content:', hasWelcome);
  
  await window.waitForTimeout(2000);
  
  await electronApp.close();
  console.log('App closed.');
  console.log('Total errors found:', errors.length);
  if (errors.length > 0) {
    console.log('Errors:', errors);
    process.exit(1);
  } else {
    console.log('SUCCESS: App launched without critical errors!');
    process.exit(0);
  }
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
