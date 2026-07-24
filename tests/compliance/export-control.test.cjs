'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  scanFileForCrypto,
  classifyECCN,
  checkDependencyOrigins,
  checkSanctionedEntities,
  generateExportControlReport,
  classifyAlgorithm,
  CRYPTO_PATTERNS,
  ECCN_CATEGORIES,
  SANCTIONED_ENTITIES,
  RESTRICTED_DESTINATIONS,
  DEPENDENCY_ORIGIN_MAP
} = require(path.join(__dirname, '..', '..', 'scripts', 'compliance', 'export-control.cjs'));

// ---- Cryptographic Algorithm Detection ----

test('scanFileForCrypto - detects AES in source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-ec-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);');

  const findings = scanFileForCrypto(filePath);
  const aesFinding = findings.find(f => f.algorithm === 'AES');
  assert.ok(aesFinding, 'should detect AES algorithm');
});

test('scanFileForCrypto - detects RSA in source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-ec-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });');

  const findings = scanFileForCrypto(filePath);
  const rsaFinding = findings.find(f => f.algorithm === 'RSA');
  assert.ok(rsaFinding, 'should detect RSA algorithm');
});

test('scanFileForCrypto - detects ECC in source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-ec-'));
  const filePath = path.join(dir, 'test.go');
  fs.writeFileSync(filePath, 'curve := elliptic.P256()\nkey, _ := ecdsa.GenerateKey(curve, rand.Reader)');

  const findings = scanFileForCrypto(filePath);
  const eccFinding = findings.find(f => f.algorithm === 'ECC');
  assert.ok(eccFinding, 'should detect ECC algorithm');
});

test('scanFileForCrypto - detects TLS in source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-ec-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, '// Use TLS 1.2 for secure connections\nconst options = { secureProtocol: "TLSv1_2_method" };\nconst ctx = SSL_CTX_new(TLS_method());');

  const findings = scanFileForCrypto(filePath);
  const tlsFinding = findings.find(f => f.algorithm === 'TLS');
  assert.ok(tlsFinding, 'should detect TLS');
});

test('scanFileForCrypto - detects SHA-2 in source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-ec-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'const hash = crypto.createHash("sha256");');

  const findings = scanFileForCrypto(filePath);
  const shaFinding = findings.find(f => f.algorithm === 'SHA-2');
  assert.ok(shaFinding, 'should detect SHA-2');
});

test('scanFileForCrypto - no crypto in plain file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-ec-'));
  const filePath = path.join(dir, 'test.js');
  fs.writeFileSync(filePath, 'console.log("hello world");');

  const findings = scanFileForCrypto(filePath);
  assert.equal(findings.length, 0);
});

test('scanFileForCrypto - skips binary files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-ec-'));
  const filePath = path.join(dir, 'test.exe');
  // Binary content that might match patterns
  fs.writeFileSync(filePath, 'MZ\x00\x00AES\x00RSA\x00TLS');

  const findings = scanFileForCrypto(filePath);
  assert.equal(findings.length, 0, 'should skip .exe files');
});

// ---- Algorithm Classification ----

test('classifyAlgorithm - AES is symmetric', () => {
  assert.equal(classifyAlgorithm('AES'), 'symmetric-encryption');
});

test('classifyAlgorithm - RSA is asymmetric', () => {
  assert.equal(classifyAlgorithm('RSA'), 'asymmetric-encryption');
});

test('classifyAlgorithm - ECC is asymmetric', () => {
  assert.equal(classifyAlgorithm('ECC'), 'asymmetric-encryption');
});

test('classifyAlgorithm - SHA-2 is hash', () => {
  assert.equal(classifyAlgorithm('SHA-2'), 'hash-function');
});

test('classifyAlgorithm - TLS is transport-security', () => {
  assert.equal(classifyAlgorithm('TLS'), 'transport-security');
});

test('classifyAlgorithm - HMAC is message-authentication', () => {
  assert.equal(classifyAlgorithm('HMAC'), 'message-authentication');
});

test('classifyAlgorithm - X.509 is certificate', () => {
  assert.equal(classifyAlgorithm('X.509'), 'certificate');
});

// ---- ECCN Classification ----

test('classifyECCN - no crypto findings returns EAR99', () => {
  const result = classifyECCN([]);
  assert.equal(result.eccn, 'EAR99');
});

test('classifyECCN - with AES returns 5D002', () => {
  const findings = [{ algorithm: 'AES', category: 'symmetric-encryption' }];
  const result = classifyECCN(findings);
  assert.equal(result.eccn, '5D002');
});

test('classifyECCN - with TLS returns 5D002', () => {
  const findings = [{ algorithm: 'TLS', category: 'transport-security' }];
  const result = classifyECCN(findings);
  assert.equal(result.eccn, '5D002');
});

test('classifyECCN - with only hash functions returns 5D002 (TLS)', () => {
  const findings = [{ algorithm: 'SHA-2', category: 'hash-function' }];
  const result = classifyECCN(findings);
  // Hash functions alone don't trigger 5D002
  assert.equal(result.eccn, 'EAR99');
});

// ---- Dependency Origin Check ----

test('checkDependencyOrigins - returns findings', () => {
  const result = checkDependencyOrigins();
  assert.ok(Array.isArray(result.findings));
  assert.ok(result.findings.length > 0);
  assert.ok(Array.isArray(result.restricted));
});

test('checkDependencyOrigins - known dependencies have country info', () => {
  const result = checkDependencyOrigins();
  const ts = result.findings.find(f => f.dependency === 'typescript');
  assert.ok(ts, 'should have typescript entry');
  assert.equal(ts.country, 'US');
});

// ---- Sanctioned Entity Check ----

test('checkSanctionedEntities - returns findings list', () => {
  const result = checkSanctionedEntities();
  assert.ok(Array.isArray(result.findings));
  assert.ok(result.findings.length > 0);
  assert.ok(Array.isArray(result.hits));
});

test('checkSanctionedEntities - all entities have required fields', () => {
  const result = checkSanctionedEntities();
  for (const entity of result.findings) {
    assert.ok(entity.name);
    assert.ok(entity.type);
    assert.ok(entity.sanction);
  }
});

// ---- Export Control Report Generation ----

test('generateExportControlReport - valid structure', () => {
  const cryptoFindings = [{ file: 'test.js', algorithm: 'AES', category: 'symmetric-encryption' }];
  const eccn = classifyECCN(cryptoFindings);
  const origin = checkDependencyOrigins();
  const sanction = checkSanctionedEntities();

  const report = generateExportControlReport(cryptoFindings, eccn, origin, sanction);
  assert.equal(report.report, 'Export Control Assessment');
  assert.ok(report.eccnClassification);
  assert.ok(report.cryptographySummary);
  assert.ok(report.dependencyOriginCheck);
  assert.ok(report.sanctionedEntityCheck);
  assert.ok(Array.isArray(report.recommendations));
});

test('generateExportControlReport - includes recommendations', () => {
  const cryptoFindings = [{ file: 'test.js', algorithm: 'AES', category: 'symmetric-encryption' }];
  const eccn = classifyECCN(cryptoFindings);
  const origin = checkDependencyOrigins();
  const sanction = checkSanctionedEntities();

  const report = generateExportControlReport(cryptoFindings, eccn, origin, sanction);
  assert.ok(report.recommendations.length > 0);
  const hasBestPractice = report.recommendations.some(r => r.category === 'best-practice');
  assert.ok(hasBestPractice);
});

// ---- CRYPTO_PATTERNS ----

test('CRYPTO_PATTERNS - has all expected algorithms', () => {
  const expected = ['AES', 'RSA', 'ECC', 'TLS', 'SHA-2', 'SHA-3', 'HMAC', 'X.509'];
  for (const algo of expected) {
    assert.ok(CRYPTO_PATTERNS[algo], `should have ${algo} patterns`);
    assert.ok(Array.isArray(CRYPTO_PATTERNS[algo]), `${algo} patterns should be an array`);
  }
});

// ---- RESTRICTED_DESTINATIONS ----

test('RESTRICTED_DESTINATIONS - includes expected countries', () => {
  assert.ok(RESTRICTED_DESTINATIONS.includes('Cuba'));
  assert.ok(RESTRICTED_DESTINATIONS.includes('Iran'));
  assert.ok(RESTRICTED_DESTINATIONS.includes('North Korea'));
  assert.ok(RESTRICTED_DESTINATIONS.includes('Syria'));
});

// ---- DEPENDENCY_ORIGIN_MAP ----

test('DEPENDENCY_ORIGIN_MAP - has entries for known deps', () => {
  assert.ok(DEPENDENCY_ORIGIN_MAP['typescript']);
  assert.ok(DEPENDENCY_ORIGIN_MAP['github.com/gorilla/websocket']);
  assert.ok(DEPENDENCY_ORIGIN_MAP['Apache Tomcat']);
});