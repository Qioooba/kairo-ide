'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
require('../setup-tmp.cjs'); // KAIRO_TMP override
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  scanFileForPII,
  scanFileForDataCollection,
  scanFileForRetentionPolicies,
  scanFileForCrossBorderTransfer,
  checkDataMinimization,
  validateRetentionPolicies,
  generateDPIA,
  generateGDPRReport,
  generateSummary,
  PII_PATTERNS,
  DATA_COLLECTION_PATTERNS,
  RETENTION_PATTERNS,
  CROSS_BORDER_PATTERNS
} = require(path.join(__dirname, '..', '..', 'scripts', 'compliance', 'gdpr-check.cjs'));

// ---- PII Detection ----

test('scanFileForPII - detects email addresses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const email = "user@example.com";\nconst admin = "admin@test.org";');

  const findings = scanFileForPII(filePath);
  const emailFinding = findings.find(f => f.type === 'email');
  assert.ok(emailFinding, 'should detect email');
  assert.equal(emailFinding.severity, 'high');
  assert.equal(emailFinding.occurrences, 2);
});

test('scanFileForPII - detects IP addresses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const host = "192.168.1.1";\nconst dns = "10.0.0.1";');

  const findings = scanFileForPII(filePath);
  const ipFinding = findings.find(f => f.type === 'ipv4');
  assert.ok(ipFinding, 'should detect IPv4');
  assert.equal(ipFinding.severity, 'medium');
});

test('scanFileForPII - detects Chinese phone numbers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const phone = "13800138000";');

  const findings = scanFileForPII(filePath);
  const phoneFinding = findings.find(f => f.type === 'phone_cn');
  assert.ok(phoneFinding, 'should detect Chinese phone number');
  assert.equal(phoneFinding.severity, 'high');
});

test('scanFileForPII - detects Chinese ID card numbers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const idCard = "110101199001011234";');

  const findings = scanFileForPII(filePath);
  const idFinding = findings.find(f => f.type === 'id_card_cn');
  assert.ok(idFinding, 'should detect Chinese ID card');
  assert.equal(idFinding.severity, 'critical');
});

test('scanFileForPII - detects passwords in code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const password = "superSecret123";');

  const findings = scanFileForPII(filePath);
  const pwdFinding = findings.find(f => f.type === 'password');
  assert.ok(pwdFinding, 'should detect password');
  assert.equal(pwdFinding.severity, 'critical');
});

test('scanFileForPII - detects API keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const api_key = "sk-abcdefghijklmnopqrstuvwxyz";');

  const findings = scanFileForPII(filePath);
  const apiFinding = findings.find(f => f.type === 'api_key');
  assert.ok(apiFinding, 'should detect API key');
  assert.equal(apiFinding.severity, 'high');
});

test('scanFileForPII - detects database connection strings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const url = "jdbc:mysql://localhost:3306/mydb?user=root&password=secret";');

  const findings = scanFileForPII(filePath);
  const dbFinding = findings.find(f => f.type === 'db_connection');
  assert.ok(dbFinding, 'should detect DB connection string');
  assert.equal(dbFinding.severity, 'high');
});

test('scanFileForPII - no PII in clean file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'console.log("hello world");\nconst x = 42;');

  const findings = scanFileForPII(filePath);
  // May detect GDPR reference keywords; filter those out
  const nonInfo = findings.filter(f => f.severity !== 'info');
  assert.equal(nonInfo.length, 0, 'should not find PII in clean file');
});

// ---- Data Collection Detection ----

test('scanFileForDataCollection - detects console.log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'console.log("debug info");\nconsole.log("user data");');

  const findings = scanFileForDataCollection(filePath);
  const logFinding = findings.find(f => f.type === 'console.log');
  assert.ok(logFinding, 'should detect console.log');
  assert.equal(logFinding.occurrences, 2);
});

test('scanFileForDataCollection - detects localStorage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'localStorage.setItem("token", "abc123");');

  const findings = scanFileForDataCollection(filePath);
  const lsFinding = findings.find(f => f.type === 'localStorage');
  assert.ok(lsFinding, 'should detect localStorage');
});

// ---- Data Retention Detection ----

test('scanFileForRetentionPolicies - detects retention references', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, '// Data retention: keep logs for 90 days\nconst retentionDays = 90;');

  const findings = scanFileForRetentionPolicies(filePath);
  assert.ok(findings.length > 0, 'should detect retention references');
});

test('scanFileForRetentionPolicies - detects temp file references', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const cacheFile = "/tmp/data.cache";\nconst logFile = "app.log";');

  const findings = scanFileForRetentionPolicies(filePath);
  const tempFinding = findings.find(f => f.type === 'temporary/cache file reference');
  assert.ok(tempFinding, 'should detect temp/cache file references');
});

// ---- Cross-Border Transfer Detection ----

test('scanFileForCrossBorderTransfer - detects AWS references', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const s3 = new AWS.S3();\nconst bucket = "my-bucket";');

  const findings = scanFileForCrossBorderTransfer(filePath);
  const awsFinding = findings.find(f => f.service === 'AWS (US)');
  assert.ok(awsFinding, 'should detect AWS');
  assert.equal(awsFinding.region, 'us');
});

test('scanFileForCrossBorderTransfer - detects Alibaba Cloud', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gdpr-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const oss = require("aliyun-sdk");');

  const findings = scanFileForCrossBorderTransfer(filePath);
  const aliFinding = findings.find(f => f.service === 'Alibaba Cloud (CN)');
  assert.ok(aliFinding, 'should detect Alibaba Cloud');
  assert.equal(aliFinding.region, 'cn');
});

// ---- Data Minimization Check ----

test('checkDataMinimization - empty findings', () => {
  const result = checkDataMinimization([]);
  assert.equal(result.status, 'compliant');
  assert.equal(result.totalDataPoints, 0);
});

test('checkDataMinimization - with excessive logging', () => {
  const findings = Array(15).fill({ type: 'console.log', description: 'test', file: 'test.js', occurrences: 1 });
  const result = checkDataMinimization(findings);
  assert.equal(result.status, 'review_required');
  assert.ok(result.riskAreas.length > 0);
});

// ---- Retention Policy Validation ----

test('validateRetentionPolicies - no policy found', () => {
  const result = validateRetentionPolicies([]);
  assert.equal(result.status, 'no_policy_found');
  assert.equal(result.hasExplicitPolicy, false);
});

test('validateRetentionPolicies - policy found', () => {
  const findings = [
    { type: 'retention policy reference', file: 'test.js' }
  ];
  const result = validateRetentionPolicies(findings);
  assert.equal(result.status, 'policy_found');
  assert.equal(result.hasExplicitPolicy, true);
});

// ---- DPIA Generation ----

test('generateDPIA - valid structure', () => {
  const piiFindings = [
    { type: 'email', severity: 'high', category: 'contact', gdprArticle: 'Art. 4', file: 'test.js', occurrences: 1, sample: 'XXX@XXX.XXX' }
  ];
  const dpia = generateDPIA(piiFindings, [], [], []);
  assert.ok(dpia.dpia);
  assert.ok(dpia.dpia.processingDescription);
  assert.ok(dpia.dpia.necessityAndProportionality);
  assert.ok(dpia.dpia.riskAssessment);
  assert.ok(dpia.dpia.riskMitigation);
  assert.ok(Array.isArray(dpia.recommendations));
});

test('generateDPIA - critical PII generates critical recommendations', () => {
  const piiFindings = [
    { type: 'id_card_cn', severity: 'critical', category: 'identity', gdprArticle: 'Art. 9', file: 'test.js', occurrences: 1, sample: 'XXX...' }
  ];
  const dpia = generateDPIA(piiFindings, [], [], []);
  const criticalRecs = dpia.recommendations.filter(r => r.severity === 'critical');
  assert.ok(criticalRecs.length > 0, 'should have critical recommendations');
});

// ---- GDPR Report Generation ----

test('generateGDPRReport - valid structure', () => {
  const piiFindings = [];
  const dataCollectionFindings = [];
  const retentionFindings = [];
  const crossBorderFindings = [];
  const minimization = checkDataMinimization(dataCollectionFindings);
  const retention = validateRetentionPolicies(retentionFindings);
  const dpia = generateDPIA(piiFindings, dataCollectionFindings, retentionFindings, crossBorderFindings);

  const report = generateGDPRReport(piiFindings, dataCollectionFindings, retentionFindings, crossBorderFindings, minimization, retention, dpia);
  assert.ok(report.piiDetection);
  assert.ok(report.dataMinimization);
  assert.ok(report.dataRetention);
  assert.ok(report.crossBorderTransfer);
  assert.ok(report.dpia);
  assert.ok(Array.isArray(report.recommendations));
});

// ---- Summary Generation ----

test('generateSummary - overall risk low for clean report', () => {
  const piiFindings = [];
  const dataCollectionFindings = [];
  const retentionFindings = [];
  const crossBorderFindings = [];
  const minimization = checkDataMinimization(dataCollectionFindings);
  const retention = validateRetentionPolicies(retentionFindings);
  const dpia = generateDPIA(piiFindings, dataCollectionFindings, retentionFindings, crossBorderFindings);
  const report = generateGDPRReport(piiFindings, dataCollectionFindings, retentionFindings, crossBorderFindings, minimization, retention, dpia);

  const summary = generateSummary(report);
  assert.equal(summary.overallRisk, 'low');
});

test('generateSummary - overall risk critical with critical PII', () => {
  const piiFindings = [
    { type: 'id_card_cn', severity: 'critical', category: 'identity', gdprArticle: 'Art. 9', file: 'test.js', occurrences: 1, sample: 'XXX...' }
  ];
  const dataCollectionFindings = [];
  const retentionFindings = [];
  const crossBorderFindings = [];
  const minimization = checkDataMinimization(dataCollectionFindings);
  const retention = validateRetentionPolicies(retentionFindings);
  const dpia = generateDPIA(piiFindings, dataCollectionFindings, retentionFindings, crossBorderFindings);
  const report = generateGDPRReport(piiFindings, dataCollectionFindings, retentionFindings, crossBorderFindings, minimization, retention, dpia);

  const summary = generateSummary(report);
  assert.equal(summary.overallRisk, 'critical');
});

// ---- PII_PATTERNS ----

test('PII_PATTERNS - has all expected categories', () => {
  const expected = ['email', 'ipv4', 'phone_cn', 'id_card_cn', 'credit_card', 'password', 'api_key', 'db_connection'];
  for (const key of expected) {
    assert.ok(PII_PATTERNS[key], `should have ${key} pattern`);
    assert.ok(PII_PATTERNS[key].pattern instanceof RegExp, `${key} should be a RegExp`);
    assert.ok(PII_PATTERNS[key].severity, `${key} should have severity`);
  }
});

// ---- DATA_COLLECTION_PATTERNS ----

test('DATA_COLLECTION_PATTERNS - has entries', () => {
  assert.ok(Array.isArray(DATA_COLLECTION_PATTERNS));
  assert.ok(DATA_COLLECTION_PATTERNS.length > 0);
  for (const entry of DATA_COLLECTION_PATTERNS) {
    assert.ok(entry.pattern);
    assert.ok(entry.name);
    assert.ok(entry.description);
  }
});

// ---- CROSS_BORDER_PATTERNS ----

test('CROSS_BORDER_PATTERNS - has entries', () => {
  assert.ok(Array.isArray(CROSS_BORDER_PATTERNS));
  assert.ok(CROSS_BORDER_PATTERNS.length > 0);
  for (const entry of CROSS_BORDER_PATTERNS) {
    assert.ok(entry.pattern);
    assert.ok(entry.name);
    assert.ok(entry.region);
    assert.ok(entry.adequacy);
  }
});