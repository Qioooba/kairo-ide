#!/usr/bin/env node
'use strict';

/**
 * Compliance Report Generator for Kairo IDE
 * Generates comprehensive compliance reports combining license, export control,
 * GDPR, and audit findings into a unified report with compliance scoring,
 * remediation recommendations, and optional compliance certificate.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const COMPLIANCE_DIR = path.join(ROOT, 'dist', 'compliance');

// ---- Compliance Scoring ----

const SCORING_WEIGHTS = {
  license: 0.30,       // 30% - License compliance
  exportControl: 0.20, // 20% - Export control
  gdpr: 0.25,          // 25% - GDPR / data protection
  audit: 0.25          // 25% - Audit logging
};

function calculateLicenseScore(licenseReport) {
  let score = 100;
  if (!licenseReport) return { score: 0, details: ['No license report available'] };

  const summary = licenseReport.summary;
  if (!summary) return { score: 0, details: ['Invalid license report format'] };

  // Deduct for GPL dependencies
  if (summary.gplDependencies > 0) {
    score -= Math.min(summary.gplDependencies * 5, 30);
  }

  // Deduct for compatibility issues
  if (summary.compatibilityIssues > 0) {
    score -= Math.min(summary.compatibilityIssues * 10, 40);
  }

  // Deduct for unknown licenses
  if (summary.unknownLicenses > 0) {
    score -= Math.min(summary.unknownLicenses * 3, 20);
  }

  // Bonus for having license documentation
  if (summary.totalComponents > 0 && summary.unknownLicenses === 0) {
    score = Math.min(score + 5, 100);
  }

  return {
    score: Math.max(0, score),
    details: [
      `Total components: ${summary.totalComponents || 0}`,
      `GPL dependencies: ${summary.gplDependencies || 0}`,
      `Compatibility issues: ${summary.compatibilityIssues || 0}`,
      `Unknown licenses: ${summary.unknownLicenses || 0}`
    ]
  };
}

function calculateExportControlScore(exportReport) {
  let score = 100;
  if (!exportReport) return { score: 0, details: ['No export control report available'] };

  const eccn = exportReport.eccnClassification;
  if (!eccn) return { score: 0, details: ['Invalid export control report'] };

  // ECCN 5D002 requires documentation
  if (eccn.eccn === '5D002') {
    score -= 10; // Encryption detected, requires self-classification
  }

  // Restricted origin dependencies
  const restricted = exportReport.dependencyOriginCheck?.restrictedDestinations || 0;
  if (restricted > 0) {
    score -= Math.min(restricted * 20, 40);
  }

  // Sanctioned entity hits
  const sanctions = exportReport.sanctionedEntityCheck?.hits || 0;
  if (sanctions > 0) {
    score -= Math.min(sanctions * 15, 45);
  }

  return {
    score: Math.max(0, score),
    details: [
      `ECCN: ${eccn.eccn}`,
      `Crypto findings: ${exportReport.cryptographySummary?.totalFindings || 0}`,
      `Restricted origins: ${restricted}`,
      `Sanctioned entity hits: ${sanctions}`
    ]
  };
}

function calculateGDPRScore(gdprReport) {
  let score = 100;
  if (!gdprReport) return { score: 0, details: ['No GDPR report available'] };

  const pii = gdprReport.piiDetection;
  if (!pii) return { score: 0, details: ['Invalid GDPR report'] };

  // Critical PII findings
  const critical = pii.bySeverity?.critical || 0;
  if (critical > 0) {
    score -= Math.min(critical * 20, 50);
  }

  // High severity PII
  const high = pii.bySeverity?.high || 0;
  if (high > 0) {
    score -= Math.min(high * 5, 25);
  }

  // Data minimization
  if (gdprReport.dataMinimization?.status === 'review_required') {
    score -= 10;
  }

  // Data retention
  if (gdprReport.dataRetention?.status === 'no_policy_found') {
    score -= 10;
  }

  // Cross-border transfer
  if (gdprReport.crossBorderTransfer?.totalFindings > 0) {
    score -= Math.min(gdprReport.crossBorderTransfer.totalFindings * 5, 15);
  }

  return {
    score: Math.max(0, score),
    details: [
      `PII findings: ${pii.totalFindings || 0} (${critical} critical, ${high} high)`,
      `Data minimization: ${gdprReport.dataMinimization?.status || 'unknown'}`,
      `Retention policy: ${gdprReport.dataRetention?.status || 'unknown'}`,
      `Cross-border references: ${gdprReport.crossBorderTransfer?.totalFindings || 0}`
    ]
  };
}

function calculateAuditScore(auditReport) {
  let score = 100;
  if (!auditReport) return { score: 0, details: ['No audit report available'] };

  // Audit integrity
  if (auditReport.auditLogging?.integrityIntact === false) {
    score -= 30;
  }

  // Denied events
  const denied = auditReport.auditLogging?.deniedEvents || 0;
  if (denied > 0) {
    score -= Math.min(denied * 2, 20);
  }

  // Error events
  const errors = auditReport.auditLogging?.errorEvents || 0;
  if (errors > 0) {
    score -= Math.min(errors * 1, 15);
  }

  return {
    score: Math.max(0, score),
    details: [
      `Total events: ${auditReport.auditLogging?.totalEvents || 0}`,
      `Integrity: ${auditReport.auditLogging?.integrityIntact !== false ? 'intact' : 'COMPROMISED'}`,
      `Denied events: ${denied}`,
      `Error events: ${errors}`
    ]
  };
}

function calculateOverallScore(components) {
  const weights = SCORING_WEIGHTS;
  let weightedScore = 0;
  const details = [];

  for (const [name, component] of Object.entries(components)) {
    const weight = weights[name] || 0;
    weightedScore += component.score * weight;
    details.push({
      category: name,
      score: component.score,
      weight: weight,
      weighted: Math.round(component.score * weight * 100) / 100
    });
  }

  return {
    score: Math.round(weightedScore),
    maxScore: 100,
    grade: scoreToGrade(weightedScore),
    components: details
  };
}

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ---- Remediation Recommendations ----

function generateRemediationPlan(licenseReport, exportReport, gdprReport, auditReport) {
  const plan = {
    critical: [],
    high: [],
    medium: [],
    low: []
  };

  // License remediation
  if (licenseReport?.recommendations) {
    for (const rec of licenseReport.recommendations) {
      plan[rec.severity] = plan[rec.severity] || [];
      plan[rec.severity].push({
        source: 'license',
        message: rec.message,
        action: rec.action
      });
    }
  }

  // Export control remediation
  if (exportReport?.recommendations) {
    for (const rec of exportReport.recommendations) {
      plan[rec.severity] = plan[rec.severity] || [];
      plan[rec.severity].push({
        source: 'export-control',
        message: rec.message,
        action: rec.action
      });
    }
  }

  // GDPR remediation
  if (gdprReport?.recommendations) {
    for (const rec of gdprReport.recommendations) {
      plan[rec.severity] = plan[rec.severity] || [];
      plan[rec.severity].push({
        source: 'gdpr',
        message: rec.message,
        action: rec.action
      });
    }
  }

  return plan;
}

// ---- Compliance Certificate ----

function generateComplianceCertificate(overallScore, licenseReport, exportReport, gdprReport) {
  const projectName = licenseReport?.project || 'kairo-ide';
  const projectVersion = licenseReport?.version || '0.1.0';
  const projectLicense = licenseReport?.projectLicense || 'Apache-2.0';

  return {
    certificate: {
      title: 'Compliance Certificate',
      project: projectName,
      version: projectVersion,
      issuedAt: new Date().toISOString(),
      issuer: 'Kairo IDE Compliance Suite',
      certificateId: crypto.randomUUID(),

      complianceStatement: `This certifies that ${projectName} v${projectVersion} has undergone automated compliance assessment as of ${new Date().toISOString()}.`,

      scores: {
        overall: overallScore.score,
        grade: overallScore.grade,
        components: overallScore.components
      },

      scope: {
        licenseCompliance: true,
        exportControl: !!exportReport,
        gdprDataProtection: !!gdprReport,
        auditLogging: true
      },

      standards: [
        'SPDX 2.3 - Software Package Data Exchange',
        'EAR Category 5 Part 2 - Information Security',
        'GDPR - General Data Protection Regulation (EU) 2016/679',
        'PIPL - Personal Information Protection Law of PRC'
      ],

      disclaimer: 'This certificate is generated by automated tools and does not constitute legal advice. A qualified legal professional should review all compliance findings before distribution.',

      projectLicense: projectLicense,
      generatedBy: 'kairo-compliance-suite v1.0'
    }
  };
}

// ---- Comprehensive Report Generation ----

function generateComprehensiveReport(licenseReport, exportReport, gdprReport, auditReport) {
  // Calculate scores
  const licenseScore = calculateLicenseScore(licenseReport);
  const exportScore = calculateExportControlScore(exportReport);
  const gdprScore = calculateGDPRScore(gdprReport);
  const auditScore = calculateAuditScore(auditReport);

  const scores = {
    license: licenseScore,
    exportControl: exportScore,
    gdpr: gdprScore,
    audit: auditScore
  };

  const overall = calculateOverallScore(scores);

  // Generate remediation plan
  const remediation = generateRemediationPlan(licenseReport, exportReport, gdprReport, auditReport);

  // Generate compliance certificate
  const certificate = generateComplianceCertificate(overall, licenseReport, exportReport, gdprReport);

  // Build comprehensive report
  return {
    report: 'Kairo IDE Comprehensive Compliance Report',
    generatedAt: new Date().toISOString(),
    project: 'kairo-ide',
    version: '0.1.0',

    executiveSummary: {
      overallScore: overall.score,
      grade: overall.grade,
      status: overall.score >= 70 ? 'PASS' : overall.score >= 60 ? 'CONDITIONAL_PASS' : 'FAIL',
      summary: generateExecutiveSummary(overall, scores, remediation),
      keyMetrics: {
        licenseCompliance: `${licenseScore.score}%`,
        exportControl: `${exportScore.score}%`,
        gdprDataProtection: `${gdprScore.score}%`,
        auditLogging: `${auditScore.score}%`
      }
    },

    detailedScores: {
      overall,
      components: scores
    },

    remediationPlan: remediation,

    certificate: certificate.certificate,

    reportSources: {
      license: licenseReport ? 'dist/compliance/license-summary.json' : null,
      exportControl: exportReport ? 'dist/compliance/export-control-report.json' : null,
      gdpr: gdprReport ? 'dist/compliance/gdpr-report.json' : null,
      audit: auditReport ? 'runtime-agent audit log' : null
    },

    appendices: {
      licenseSummary: licenseReport?.summary || null,
      exportControlSummary: exportReport ? {
        eccn: exportReport.eccnClassification?.eccn,
        cryptoFindings: exportReport.cryptographySummary?.totalFindings,
        restrictedOrigins: exportReport.dependencyOriginCheck?.restrictedDestinations,
        sanctionHits: exportReport.sanctionedEntityCheck?.hits
      } : null,
      gdprSummary: gdprReport ? {
        piiTotal: gdprReport.piiDetection?.totalFindings,
        piiCritical: gdprReport.piiDetection?.bySeverity?.critical,
        dataMinimization: gdprReport.dataMinimization?.status,
        crossBorder: gdprReport.crossBorderTransfer?.totalFindings
      } : null,
      auditSummary: auditReport?.auditLogging || null
    }
  };
}

function generateExecutiveSummary(overall, scores, remediation) {
  const grade = overall.grade;
  const criticalCount = (remediation.critical || []).length;
  const highCount = (remediation.high || []).length;
  const totalIssues = criticalCount + highCount + (remediation.medium || []).length + (remediation.low || []).length;

  if (grade === 'A') {
    return `Kairo IDE demonstrates excellent compliance posture. Overall score: ${overall.score}%. No critical or high-severity issues found.`;
  } else if (grade === 'B') {
    return `Kairo IDE shows good compliance posture with ${totalIssues} issues identified. Overall score: ${overall.score}%. ${criticalCount} critical and ${highCount} high-severity issues require attention.`;
  } else if (grade === 'C') {
    return `Kairo IDE requires compliance improvements. Overall score: ${overall.score}%. ${totalIssues} issues identified, including ${criticalCount} critical items.`;
  } else {
    return `Kairo IDE has significant compliance gaps. Overall score: ${overall.score}%. ${totalIssues} issues identified. Immediate remediation required.`;
  }
}

// ---- Helpers ----

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ---- Main ----

function main() {
  fs.mkdirSync(COMPLIANCE_DIR, { recursive: true });

  console.log('[compliance-report] Loading sub-reports...');

  const licenseReport = readJSON(path.join(COMPLIANCE_DIR, 'license-summary.json'));
  const exportReport = readJSON(path.join(COMPLIANCE_DIR, 'export-control-report.json'));
  const gdprReport = readJSON(path.join(COMPLIANCE_DIR, 'gdpr-report.json'));
  const auditReport = readJSON(path.join(COMPLIANCE_DIR, 'audit-report.json'));

  if (licenseReport) console.log('  ✓ License report loaded');
  else console.log('  ✗ License report not found');
  if (exportReport) console.log('  ✓ Export control report loaded');
  else console.log('  ✗ Export control report not found');
  if (gdprReport) console.log('  ✓ GDPR report loaded');
  else console.log('  ✗ GDPR report not found');
  if (auditReport) console.log('  ✓ Audit report loaded');
  else console.log('  ✗ Audit report not found (optional)');

  console.log('[compliance-report] Generating comprehensive report...');
  const report = generateComprehensiveReport(licenseReport, exportReport, gdprReport, auditReport);

  // Write comprehensive report
  const reportPath = path.join(COMPLIANCE_DIR, 'comprehensive-compliance-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[compliance-report] Report written to ${path.relative(ROOT, reportPath)}`);

  // Write certificate separately
  const certPath = path.join(COMPLIANCE_DIR, 'compliance-certificate.json');
  fs.writeFileSync(certPath, JSON.stringify(report.certificate, null, 2));
  console.log(`[compliance-report] Certificate written to ${path.relative(ROOT, certPath)}`);

  // Print executive summary
  console.log('\n═══════════════════════════════════════════');
  console.log('  Kairo IDE Compliance Report');
  console.log('═══════════════════════════════════════════');
  console.log(`\n  Overall Score: ${report.executiveSummary.overallScore}% (Grade: ${report.executiveSummary.grade})`);
  console.log(`  Status: ${report.executiveSummary.status}`);
  console.log(`\n  Component Scores:`);
  console.log(`    License:       ${report.detailedScores.components.license.score}%`);
  console.log(`    Export Control: ${report.detailedScores.components.exportControl.score}%`);
  console.log(`    GDPR:          ${report.detailedScores.components.gdpr.score}%`);
  console.log(`    Audit:         ${report.detailedScores.components.audit.score}%`);

  console.log(`\n  Remediation Plan:`);
  const priorities = ['critical', 'high', 'medium', 'low'];
  for (const priority of priorities) {
    const items = report.remediationPlan[priority] || [];
    if (items.length > 0) {
      console.log(`    [${priority.toUpperCase()}] ${items.length} items`);
      for (const item of items) {
        console.log(`      - ${item.message}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════');

  // Exit with non-zero if overall score is failing
  if (report.executiveSummary.status === 'FAIL') {
    console.error('\n[compliance-report] Compliance check FAILED. Review and remediate issues.');
    process.exit(1);
  }

  console.log('[compliance-report] Report generation complete.');
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
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
};