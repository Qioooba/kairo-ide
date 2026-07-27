const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  // Read the original status bar HTML
  const originalHTML = `
  <!DOCTYPE html>
  <html>
  <head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@theia/core@1.73.1/lib/browser/theia-core.css">
  <style>
    body { margin: 0; background: #1a1b1e; color: #cccccc; font-family: -apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, sans-serif; font-size: 13px; }
    .theia-ApplicationShell { position: relative; width: 100vw; height: 100vh; background: #1a1b1e; }
    .main-area { padding: 40px; }
    .placeholder { color: #888; font-size: 14px; }
    /* Status bar - old (without fix) */
    #theia-statusBar.old .element {
      padding: 0;
    }
    #theia-statusBar.old .element > span + span {
      margin-left: 3px;
    }
    /* Status bar - new (with fix) */
    #theia-statusBar.new .element {
      padding: 0 6px;
      line-height: 22px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      box-sizing: border-box;
    }
    #theia-statusBar.new .area > .element + .element {
      margin-left: 2px;
    }
    #theia-statusBar.new .element > span + span {
      margin-left: 4px;
    }
    #theia-statusBar.new .area.right .element {
      padding: 0 4px;
    }
    .codicon { display: inline-block; font-style: normal; }
    .codicon-file-directory:before { content: "\\f07b"; }
    .codicon-code:before { content: "\\f121"; color: #75beff; }
    .codicon-source-control:before { content: "\\ea6b"; }
    .codicon-text:before { content: "\\f08e"; }
    .codicon-check:before { content: "\\f121"; color: #89d185; }
    .codicon-server-process:before { content: "\\f077"; }
    .codicon-debug-alt-small:before { content: "\\f121"; }
    .codicon-pulse:before { content: "\\f121"; color: #73c991; }
    .codicon-error:before { content: "\\f121"; }
    .codicon-warning:before { content: "\\ea6b"; }
    .codicon-bell:before { content: "\\f121"; }
    .codicon-layout:before { content: "\\f121"; }
  </style>
  </head>
  <body>
  <div class="theia-ApplicationShell">
    <div class="main-area">
      <p class="placeholder">Browser frontend status bar comparison</p>
      <h3 style="color:#cccccc; font-weight: 400; font-size: 14px; margin-top: 24px;">OLD (no padding, items touching)</h3>
      <div id="theia-statusBar" class="old" style="position: absolute; bottom: 280px; left: 0; width: 100%; height: 22px; background: rgb(26, 27, 30); border-top: 1px solid #333;">
        <div class="area left" style="display: flex;">
          <div class="element hasCommand"><span class="codicon codicon-file-directory"></span><span> Project: (no workspace)</span></div>
          <div class="element hasCommand"><span class="codicon codicon-code"></span><span> JDK: stopped</span></div>
          <div class="element hasCommand"><span class="codicon codicon-source-control"></span><span> SVN: not found</span></div>
          <div class="element hasCommand"><span class="codicon codicon-text"></span><span> Encoding: -</span></div>
          <div class="element hasCommand"><span class="codicon codicon-check"></span><span> Build: succeeded</span></div>
          <div class="element hasCommand"><span class="codicon codicon-server-process"></span><span> Server: 已停止</span></div>
          <div class="element hasCommand"><span class="codicon codicon-debug-alt-small"></span><span> Debug: unknown</span></div>
          <div class="element hasCommand"><span class="codicon codicon-pulse"></span><span> Agent: 已连接</span></div>
          <div class="element hasCommand"><span class="codicon codicon-error"></span><span> 0 </span><span class="codicon codicon-warning"></span><span> 0</span></div>
        </div>
        <div class="area right" style="position: absolute; right: 8px; top: 0; display: flex;">
          <div class="element hasCommand"><span class="codicon codicon-bell"></span></div>
          <div class="element hasCommand"><span class="codicon codicon-bell"></span></div>
          <div class="element hasCommand"><span class="codicon codicon-layout"></span></div>
        </div>
      </div>
      <h3 style="color:#cccccc; font-weight: 400; font-size: 14px; margin-top: 24px;">NEW (KAIRO-STATUSBAR-OVERLAP-01 fix applied)</h3>
      <div id="theia-statusBar" class="new" style="position: absolute; bottom: 20px; left: 0; width: 100%; height: 22px; background: rgb(26, 27, 30); border-top: 1px solid #333;">
        <div class="area left" style="display: flex;">
          <div class="element hasCommand"><span class="codicon codicon-file-directory"></span><span> Project: (no workspace)</span></div>
          <div class="element hasCommand"><span class="codicon codicon-code"></span><span> JDK: stopped</span></div>
          <div class="element hasCommand"><span class="codicon codicon-source-control"></span><span> SVN: not found</span></div>
          <div class="element hasCommand"><span class="codicon codicon-text"></span><span> Encoding: -</span></div>
          <div class="element hasCommand"><span class="codicon codicon-check"></span><span> Build: succeeded</span></div>
          <div class="element hasCommand"><span class="codicon codicon-server-process"></span><span> Server: 已停止</span></div>
          <div class="element hasCommand"><span class="codicon codicon-debug-alt-small"></span><span> Debug: unknown</span></div>
          <div class="element hasCommand"><span class="codicon codicon-pulse"></span><span> Agent: 已连接</span></div>
          <div class="element hasCommand"><span class="codicon codicon-error"></span><span> 0 </span><span class="codicon codicon-warning"></span><span> 0</span></div>
        </div>
        <div class="area right" style="position: absolute; right: 8px; top: 0; display: flex;">
          <div class="element hasCommand"><span class="codicon codicon-bell"></span></div>
          <div class="element hasCommand"><span class="codicon codicon-bell"></span></div>
          <div class="element hasCommand"><span class="codicon codicon-layout"></span></div>
        </div>
      </div>
    </div>
  </div>
  </body>
  </html>
  `;
  fs.writeFileSync('/tmp/statusbar-comparison.html', originalHTML);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file:///tmp/statusbar-comparison.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/kairo-statusbar-comparison.png', fullPage: false });
  console.log('Saved comparison');
  // Take close-up of each bar
  await page.screenshot({ path: '/tmp/kairo-statusbar-old.png', fullPage: false, clip: { x: 0, y: 540, width: 1920, height: 80 } });
  await page.screenshot({ path: '/tmp/kairo-statusbar-new.png', fullPage: false, clip: { x: 0, y: 980, width: 1920, height: 80 } });
  await browser.close();
})();
