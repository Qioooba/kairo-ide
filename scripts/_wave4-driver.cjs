// Wave 4 driver: start stack on 19090/13900, run compat-scan (Chromium+WebKit) and keyboard-flow, stop stack.
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const { startStack, stopStack } = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa.SOUdxO';
const DATA_DIR = path.join(QA_ROOT, 'wave4-stack');
const AGENT_PORT = 19090;
const WEB_PORT = 13900;

async function main() {
  const stack = await startStack({ dataDir: DATA_DIR, port: AGENT_PORT, webPort: WEB_PORT, skipBuild: true });
  const env = stack.env;
  const webPort = env.KAIRO_QA_WEB_PORT || WEB_PORT;
  const url = `http://127.0.0.1:${webPort}/?kairoAgent=${encodeURIComponent(`http://127.0.0.1:${AGENT_PORT}`)}`;
  console.log('STACK UP', url);
  let failed = 0;
  try {
    for (const script of ['run-compat-scan.cjs', 'run-keyboard-flow.cjs']) {
      console.log(`=== ${script} ===`);
      const r = spawnSync('node', [path.join(__dirname, script)], {
        stdio: 'inherit',
        env: { ...process.env, KAIRO_URL: url, KAIRO_QA_ROOT: QA_ROOT },
        timeout: 20 * 60 * 1000,
      });
      console.log(`=== ${script} exit=${r.status} ===`);
      if (r.status !== 0) failed++;
    }
  } finally {
    await stopStack(DATA_DIR);
    // verify no residue on our ports
    for (const p of [AGENT_PORT, WEB_PORT]) {
      const chk = spawnSync('bash', ['-c', `lsof -nP -iTCP:${p} -sTCP:LISTEN | tail -n +2 | awk '{print $2}' | xargs kill 2>/dev/null`]);
      void chk;
    }
    console.log('STACK STOPPED');
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
