'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  calculateLicenseScore,
  calculateExportControlScore,
  calculateGDPRScore,
  calculateAuditScore,
  calculateOverallScore,
  generateComprehensiveReport,
  generateComplianceCertificate,
  generateRemediationPlan,
  generateExecutiveSummary,
  scoreToGrade,
  SCORING_WEIGHTS
} = require(path.join(__dirname, '..', '..', 'scripts', 'compliance', 'generate-compliance-report.cjs'));

// ---- Score Calculation ----

test('calculateLicenseScore - perfect score', () => {
  const report = {
    summary: {
      totalComponents: 10,
      gplDependencies: 0,
      compatibilityIssues: 0,
      unknownLicenses: 0
    }
  };
  const result = calculateLicenseScore(report);
  assert.equal(result.score, 100);
});

test('calculateLicenseScore - with GPL dependencies', () => {
  const report = {
    summary: {
      totalComponents: 10,
      gplDependencies: 3,
      compatibilityIssues: 0,
      unknownLicenses: 0
    }
  };
  const result = calculateLicenseScore(report);
  assert.ok(result.score < 100, 'should deduct for GPL');
  assert.ok(result.score >= 70, 'should not deduct too much');
});

test('calculateLicenseScore - with compatibility issues', () => {
  const report = {
    summary: {
      totalComponents: 10,
      gplDependencies: 0,
      compatibilityIssues: 2,
      unknownLicenses: 0
    }
  };
  const result = calculateLicenseScore(report);
  assert.ok(result.score < 100);
  assert.ok(result.score >= 60);
});

test('calculateLicenseScore - null report', () => {
  const result = calculateLicenseScore(null);
  assert.equal(result.score, 0);
});

test('calculateLicenseScore - unknown licenses', () => {
  const report = {
    summary: {
      totalComponents: 10,
      gplDependencies: 0,
      compatibilityIssues: 0,
      unknownLicenses: 5
    }
  };
  const result = calculateLicenseScore(report);
  assert.ok(result.score < 100);
});

// ---- Export Control Score ----

test('calculateExportControlScore - clean report', () => {
  const report = {
    eccnClassification: { eccn: 'EAR99' },
    cryptographySummary: { totalFindings: 0 },
    dependencyOriginCheck: { restrictedDestinations: 0 },
    sanctionedEntityCheck: { hits: 0 }
  };
  const result = calculateExportControlScore(report);
  assert.equal(result.score, 100);
});

test('calculateExportControlScore - with 5D002', () => {
  const report = {
    eccnClassification: { eccn: '5D002' },
    cryptographySummary: { totalFindings: 5 },
    dependencyOriginCheck: { restrictedDestinations: 0 },
    sanctionedEntityCheck: { hits: 0 }
  };
  const result = calculateExportControlScore(report);
  assert.equal(result.score, 90);
});

test('calculateExportControlScore - with restricted origins', () => {
  const report = {
    eccnClassification: { eccn: 'EAR99' },
    cryptographySummary: { totalFindings: 0 },
    dependencyOriginCheck: { restrictedDestinations: 2 },
    sanctionedEntityCheck: { hits: 0 }
  };
  const result = calculateExportControlScore(report);
  assert.ok(result.score < 100);
});

test('calculateExportControlScore - null report', () => {
  const result = calculateExportControlScore(null);
  assert.equal(result.score, 0);
});

// ---- GDPR Score ----

test('calculateGDPRScore - clean report', () => {
  const report = {
    piiDetection: { totalFindings: 0, bySeverity: { critical: 0, high: 0 } },
    dataMinimization: { status: 'compliant' },
    dataRetention: { status: 'policy_found' },
    crossBorderTransfer: { totalFindings: 0 }
  };
  const result = calculateGDPRScore(report);
  assert.equal(result.score, 100);
});

test('calculateGDPRScore - with critical PII', () => {
  const report = {
    piiDetection: { totalFindings: 5, bySeverity: { critical: 2, high: 3 } },
    dataMinimization: { status: 'compliant' },
    dataRetention: { status: 'policy_found' },
    crossBorderTransfer: { totalFindings: 0 }
  };
  const result = calculateGDPRScore(report);
  assert.ok(result.score < 100);
  assert.ok(result.score >= 30);
});

test('calculateGDPRScore - no retention policy', () => {
  const report = {
    piiDetection: { totalFindings: 0, bySeverity: { critical: 0, high: 0 } },
    dataMinimization: { status: 'compliant' },
    dataRetention: { status: 'no_policy_found' },
    crossBorderTransfer: { totalFindings: 0 }
  };
  const result = calculateGDPRScore(report);
  assert.equal(result.score, 90);
});

test('calculateGDPRScore - null report', () => {
  const result = calculateGDPRScore(null);
  assert.equal(result.score, 0);
});

// ---- Audit Score ----

test('calculateAuditScore - clean report', () => {
  const report = {
    auditLogging: {
      totalEvents: 100,
      integrityIntact: true,
      deniedEvents: 0,
      errorEvents: 0
    }
  };
  const result = calculateAuditScore(report);
  assert.equal(result.score, 100);
});

test('calculateAuditScore - compromised integrity', () => {
  const report = {
    auditLogging: {
      totalEvents: 100,
      integrityIntact: false,
      deniedEvents: 0,
      errorEvents: 0
    }
  };
  const result = calculateAuditScore(report);
  assert.equal(result.score, 70);
});

test('calculateAuditScore - null report', () => {
  const result = calculateAuditScore(null);
  assert.equal(result.score, 0);
});

// ---- Overall Score ----

test('calculateOverallScore - all perfect', () => {
  const scores = {
    license: { score: 100 },
    exportControl: { score: 100 },
    gdpr: { score: 100 },
    audit: { score: 100 }
  };
  const result = calculateOverallScore(scores);
  assert.equal(result.score, 100);
  assert.equal(result.grade, 'A');
});

test('calculateOverallScore - mixed scores', () => {
  const scores = {
    license: { score: 80 },
    exportControl: { score: 90 },
    gdpr: { score: 70 },
    audit: { score: 85 }
  };
  const result = calculateOverallScore(scores);
  assert.ok(result.score > 0);
  assert.ok(result.score < 100);
  assert.ok(result.grade);
});

// ---- Score to Grade ----

test('scoreToGrade - A grade', () => {
  assert.equal(scoreToGrade(95), 'A');
  assert.equal(scoreToGrade(90), 'A');
});

test('scoreToGrade - B grade', () => {
  assert.equal(scoreToGrade(85), 'B');
  assert.equal(scoreToGrade(80), 'B');
});

test('scoreToGrade - C grade', () => {
  assert.equal(scoreToGrade(75), 'C');
  assert.equal(scoreToGrade(70), 'C');
});

test('scoreToGrade - D grade', () => {
  assert.equal(scoreToGrade(65), 'D');
  assert.equal(scoreToGrade(60), 'D');
});

test('scoreToGrade - F grade', () => {
  assert.equal(scoreToGrade(55), 'F');
  assert.equal(scoreToGrade(0), 'F');
});

// ---- Remediation Plan ----

test('generateRemediationPlan - merges all sources', () => {
  const licenseReport = {
    recommendations: [
      { severity: 'high', message: 'GPL dependency found', action: 'Review' }
    ]
  };
  const exportReport = {
    recommendations: [
      { severity: 'medium', message: 'ECCN 5D002', action: 'File report' }
    ]
  };
  const gdprReport = {
    recommendations: [
      { severity: 'critical', message: 'PII exposed', action: 'Remove PII' }
    ]
  };

  const plan = generateRemediationPlan(licenseReport, exportReport, gdprReport, null);
  assert.ok(plan.critical.length > 0);
  assert.ok(plan.high.length > 0);
  assert.ok(plan.medium.length > 0);
});

// ---- Compliance Certificate ----

test('generateComplianceCertificate - valid structure', () => {
  const overall = {
    score: 85,
    grade: 'B',
    components: [
      { category: 'license', score: 80, weight: 0.3, weighted: 24 }
    ]
  };
  const certificate = generateComplianceCertificate(overall, { project: 'test', version: '1.0', projectLicense: 'MIT' }, null, null);
  assert.ok(certificate.certificate);
  assert.ok(certificate.certificate.certificateId);
  assert.equal(certificate.certificate.scores.overall, 85);
  assert.equal(certificate.certificate.scores.grade, 'B');
  assert.ok(certificate.certificate.disclaimer);
  assert.ok(Array.isArray(certificate.certificate.standards));
});

// ---- Comprehensive Report ----

test('generateComprehensiveReport - valid structure', () => {
  const licenseReport = {
    project: 'test',
    version: '1.0',
    projectLicense: 'Apache-2.0',
    summary: {
      totalComponents: 10, gplDependencies: 0, compatibilityIssues: 0, unknownLicenses: 0
    },
    recommendations: []
  };
  const exportReport = {
    eccnClassification: { eccn: 'EAR99' },
    cryptographySummary: { totalFindings: 0 },
    dependencyOriginCheck: { restrictedDestinations: 0 },
    sanctionedEntityCheck: { hits: 0 },
    recommendations: []
  };
  const gdprReport = {
    piiDetection: { totalFindings: 0, bySeverity: { critical: 0, high: 0 } },
    dataMinimization: { status: 'compliant' },
    dataRetention: { status: 'policy_found' },
    crossBorderTransfer: { totalFindings: 0 },
    recommendations: []
  };

  const report = generateComprehensiveReport(licenseReport, exportReport, gdprReport, null);
  assert.ok(report.executiveSummary);
  assert.ok(report.detailedScores);
  assert.ok(report.remediationPlan);
  assert.ok(report.certificate);
  assert.ok(report.appendices);
  assert.ok(report.executiveSummary.overallScore >= 0);
  assert.ok(report.executiveSummary.grade);
});

test('generateComprehensiveReport - with null reports', () => {
  const report = generateComprehensiveReport(null, null, null, null);
  assert.ok(report.executiveSummary);
  assert.ok(report.executiveSummary.overallScore >= 0);
});

// ---- Executive Summary ----

test('generateExecutiveSummary - A grade', () => {
  const summary = generateExecutiveSummary(
    { score: 95, grade: 'A' },
    { license: { score: 95 }, exportControl: { score: 95 }, gdpr: { score: 95 }, audit: { score: 95 } },
    { critical: [], high: [], medium: [], low: [] }
  );
  assert.ok(summary.includes('excellent'));
});

test('generateExecutiveSummary - F grade', () => {
  const summary = generateExecutiveSummary(
    { score: 45, grade: 'F' },
    { license: { score: 45 }, exportControl: { score: 45 }, gdpr: { score: 45 }, audit: { score: 45 } },
    { critical: [{ message: 'test' }], high: [{ message: 'test' }], medium: [], low: [] }
  );
  assert.ok(summary.includes('significant'));
});

// ---- SCORING_WEIGHTS ----

test('SCORING_WEIGHTS - sum to 1.0', () => {
  const total = Object.values(SCORING_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(total, 1.0);
});