const fs = require('fs');
const path = require('path');

const theiaUrl = process.env.THEIA_URL || 'http://127.0.0.1:3070';
const agentUrl = process.env.AGENT_URL || 'http://127.0.0.1:18081';
const artifactDir = process.env.KAIRO_TEST_ARTIFACT_DIR || path.resolve(__dirname, 'test-results');
fs.mkdirSync(artifactDir, { recursive: true });

module.exports = {
  theiaUrl,
  agentUrl,
  probeUrl: `${theiaUrl}/?kairoAgent=${encodeURIComponent(agentUrl)}`,
  screenshotPath(name) {
    return path.join(artifactDir, name);
  },
};
