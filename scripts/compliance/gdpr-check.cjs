#!/usr/bin/env node
'use strict';

/**
 * GDPR / Data Protection Checker for Kairo IDE
 * Detects PII data, checks data minimization, validates data retention policies,
 * checks cross-border data transfers, and generates Data Protection Impact Assessment (DPIA).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const COMPLIANCE_DIR = path.join(ROOT, 'dist', 'compliance');

// ---- PII Detection Patterns ----

const PII_PATTERNS = {
  // Email addresses
  'email': {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    severity: 'high',
    category: 'contact',
    gdprArticle: 'Art. 4(1) - Personal Data'
  },

  // IPv4 addresses
  'ipv4': {
    pattern: /\b(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/g,
    severity: 'medium',
    category: 'network',
    gdprArticle: 'Art. 4(1) - Online Identifier'
  },

  // IPv6 addresses (simplified)
  'ipv6': {
    pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    severity: 'medium',
    category: 'network',
    gdprArticle: 'Art. 4(1) - Online Identifier'
  },

  // MAC addresses
  'mac_address': {
    pattern: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,
    severity: 'low',
    category: 'device',
    gdprArticle: 'Art. 4(1) - Online Identifier'
  },

  // Phone numbers (Chinese format)
  'phone_cn': {
    pattern: /\b1[3-9]\d{9}\b/g,
    severity: 'high',
    category: 'contact',
    gdprArticle: 'Art. 4(1) - Personal Data'
  },

  // Chinese ID card numbers
  'id_card_cn': {
    pattern: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    severity: 'critical',
    category: 'identity',
    gdprArticle: 'Art. 9 - Special Category Data'
  },

  // Credit card numbers (basic)
  'credit_card': {
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    severity: 'critical',
    category: 'financial',
    gdprArticle: 'Art. 9 - Special Category Data'
  },

  // Passport numbers (Chinese format)
  'passport_cn': {
    pattern: /\b[EeGgPpSsDd]\d{7,8}\b/g,
    severity: 'critical',
    category: 'identity',
    gdprArticle: 'Art. 9 - Special Category Data'
  },

  // Social Security Numbers (US)
  'ssn_us': {
    pattern: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    severity: 'critical',
    category: 'identity',
    gdprArticle: 'Art. 9 - Special Category Data'
  },

  // API keys / tokens (generic)
  'api_key': {
    pattern: /\b(?:api[_-]?key|api[_-]?secret|access[_-]?key|secret[_-]?key|auth[_-]?token|api[_-]?token)\s*[:=]\s*['"][^'"]{16,}['"]/gi,
    severity: 'high',
    category: 'credentials',
    gdprArticle: 'Art. 32 - Security of Processing'
  },

  // Passwords in code
  'password': {
    pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    severity: 'critical',
    category: 'credentials',
    gdprArticle: 'Art. 32 - Security of Processing'
  },

  // Database connection strings
  'db_connection': {
    pattern: /\b(?:jdbc|mongodb|mysql|postgresql|sqlite|redis|mssql):\/\/[^\s'"]+/gi,
    severity: 'high',
    category: 'credentials',
    gdprArticle: 'Art. 32 - Security of Processing'
  },

  // GDPR-specific keywords in comments
  'gdpr_reference': {
    pattern: /\b(?:GDPR|CCPA|PIPL|LGPD|personal data|data subject|data protection|privacy policy|consent|right to be forgotten|data portability)\b/gi,
    severity: 'info',
    category: 'compliance',
    gdprArticle: 'GDPR Reference'
  }
};

// ---- Data Minimization Patterns ----

const DATA_COLLECTION_PATTERNS = [
  { pattern: /\bconsole\.log\s*\(/g, name: 'console.log', description: 'Logging to console (may leak data in production)' },
  { pattern: /\blogger\.(?:info|debug|warn|error|trace)\s*\(/g, name: 'logger call', description: 'Structured logging (check what is logged)' },
  { pattern: /\bfs\.writeFile\b/g, name: 'file write', description: 'Writing data to filesystem' },
  { pattern: /\bJSON\.stringify\b/g, name: 'JSON serialization', description: 'Serializing data (could contain PII)' },
  { pattern: /\blocalStorage\.(?:setItem|getItem)\b/g, name: 'localStorage', description: 'Client-side storage (check for PII)' },
  { pattern: /\bsessionStorage\.(?:setItem|getItem)\b/g, name: 'sessionStorage', description: 'Session storage (check for PII)' },
  { pattern: /\bdocument\.cookie\b/g, name: 'cookie', description: 'Cookie access (check for tracking data)' },
  { pattern: /\bfetch\s*\(/g, name: 'HTTP fetch', description: 'Network request (check data being sent)' },
  { pattern: /\baxios\b/g, name: 'axios request', description: 'HTTP request (check data being sent)' },
  { pattern: /\bsetTimeout\s*\(.*\bfs\./g, name: 'delayed file write', description: 'Delayed data persistence' },
  { pattern: /\bprocess\.env\./g, name: 'environment variable', description: 'Environment variable access (check for secrets)' }
];

// ---- Data Retention Patterns ----

const RETENTION_PATTERNS = [
  { pattern: /retention|retain|keep.*days|keep.*months|keep.*years|delete.*after|purge.*after|expir/i, name: 'retention policy reference' },
  { pattern: /TEMP|TMP|temp|tmp|cache|\.log|\.tmp/i, name: 'temporary/cache file reference' }
];

// ---- Cross-Border Transfer Patterns ----

const CROSS_BORDER_PATTERNS = [
  { pattern: /aws|amazon|cloudfront|s3\.amazonaws/i, name: 'AWS (US)', region: 'us', adequacy: 'EU-US Data Privacy Framework' },
  { pattern: /azure|microsoft\.com|windows\.net/i, name: 'Azure (US)', region: 'us', adequacy: 'EU-US Data Privacy Framework' },
  { pattern: /gcp|googleapis|googlecloud|firebase/i, name: 'Google Cloud (US)', region: 'us', adequacy: 'EU-US Data Privacy Framework' },
  { pattern: /aliyun|aliyuncs|alibaba/i, name: 'Alibaba Cloud (CN)', region: 'cn', adequacy: 'Standard Contractual Clauses required' },
  { pattern: /tencent|qcloud/i, name: 'Tencent Cloud (CN)', region: 'cn', adequacy: 'Standard Contractual Clauses required' },
  { pattern: /huawei.*cloud|huaweicloud/i, name: 'Huawei Cloud (CN)', region: 'cn', adequacy: 'Standard Contractual Clauses required' }
];

// ---- Data Protection Impact Assessment (DPIA) Template ----

function generateDPIA(piiFindings, dataCollectionFindings, retentionFindings, crossBorderFindings) {
  const criticalFindings = piiFindings.filter(f => f.severity === 'critical');
  const highFindings = piiFindings.filter(f => f.severity === 'high');
  const crossBorderUS = crossBorderFindings.filter(f => f.region === 'us');
  const crossBorderCN = crossBorderFindings.filter(f => f.region === 'cn');

  return {
    dpia: {
      title: 'Data Protection Impact Assessment - Kairo IDE',
      version: '1.0',
      date: new Date().toISOString(),
      project: 'Kairo IDE',
      projectDescription: 'Cross-platform IDE for legacy Java Web projects (JDK 1.6 / Tomcat 6 / JSP / Servlet / GBK)',

      // Section 1: Description of Processing
      processingDescription: {
        purpose: 'Software development tool providing IDE capabilities including code editing, compilation, debugging, and deployment to local/remote Tomcat servers.',
        dataSubjects: ['Developers using Kairo IDE', 'System administrators'],
        dataCategories: ['Workspace configuration', 'Project metadata', 'Server connection details', 'Build artifacts', 'Log files'],
        technologyUsed: ['Electron/Node.js', 'Go runtime agent', 'TypeScript', 'Java debugging tools'],
        dataFlows: [
          'User configures workspace → stored locally in workspace files',
          'User deploys to Tomcat → agent manages deployment artifacts',
          'Agent communicates with IDE frontend → local WebSocket connection',
          'Build output → local filesystem'
        ]
      },

      // Section 2: Necessity and Proportionality
      necessityAndProportionality: {
        dataMinimization: {
          status: dataCollectionFindings.length > 0 ? 'review_required' : 'compliant',
          findings: dataCollectionFindings.length,
          recommendation: 'Review all data collection points. Ensure only necessary data is collected and processed.'
        },
        storageLimitation: {
          status: retentionFindings.length > 0 ? 'review_required' : 'no_policy_found',
          findings: retentionFindings.length,
          recommendation: 'Implement explicit data retention policies. Define maximum retention periods for logs, cache, and temporary files.'
        },
        purposeLimitation: {
          status: 'compliant',
          notes: 'Data is used solely for IDE functionality and development purposes.'
        }
      },

      // Section 3: Risk Assessment
      riskAssessment: {
        piiExposure: {
          riskLevel: criticalFindings.length > 0 ? 'high' : highFindings.length > 0 ? 'medium' : 'low',
          criticalFindings: criticalFindings.length,
          highFindings: highFindings.length,
          totalFindings: piiFindings.length,
          details: piiFindings.slice(0, 50).map(f => ({
            type: f.type,
            severity: f.severity,
            file: f.file,
            category: f.category,
            gdprArticle: f.gdprArticle
          }))
        },

        crossBorderTransfer: {
          riskLevel: crossBorderFindings.length > 0 ? 'medium' : 'low',
          usServices: crossBorderUS.length,
          cnServices: crossBorderCN.length,
          totalServices: crossBorderFindings.length,
          adequacyMechanisms: {
            us: 'EU-US Data Privacy Framework (if certified)',
            cn: 'Standard Contractual Clauses (SCCs) required',
            other: 'Transfer Impact Assessment required'
          },
          details: crossBorderFindings.map(f => ({
            service: f.name,
            region: f.region,
            adequacy: f.adequacy,
            file: f.file
          }))
        },

        securityMeasures: {
          encryption: 'TLS/SSL for network communications',
          accessControl: 'Local-only by default; remote access requires explicit configuration',
          logging: 'Audit logging implemented in Go runtime agent',
          dataIsolation: 'Workspace data stored in user-specific directories'
        }
      },

      // Section 4: Risk Mitigation Measures
      riskMitigation: {
        immediate: [],
        shortTerm: [],
        longTerm: []
      }
    },

    // Generate risk mitigation recommendations
    recommendations: generateDPIARecommendations(piiFindings, dataCollectionFindings, crossBorderFindings)
  };
}

function generateDPIARecommendations(piiFindings, dataCollectionFindings, crossBorderFindings) {
  const recommendations = [];

  if (piiFindings.filter(f => f.severity === 'critical').length > 0) {
    recommendations.push({
      severity: 'critical',
      category: 'pii-exposure',
      message: 'Critical PII patterns detected (ID cards, credit cards, passwords).',
      action: 'Immediately remove all hardcoded credentials and sensitive PII from source code. Replace with environment variables or secure vaults.'
    });
  }

  if (piiFindings.filter(f => f.severity === 'high').length > 0) {
    recommendations.push({
      severity: 'high',
      category: 'pii-exposure',
      message: 'High-severity PII patterns detected (emails, API keys, phone numbers).',
      action: 'Review all PII instances. Mask or remove PII from logs and code. Implement data anonymization where possible.'
    });
  }

  if (dataCollectionFindings.length > 0) {
    recommendations.push({
      severity: 'medium',
      category: 'data-minimization',
      message: `Found ${dataCollectionFindings.length} data collection/processing points.`,
      action: 'Audit data collection points. Implement data minimization — only collect what is necessary. Document lawful basis for processing.'
    });
  }

  if (crossBorderFindings.length > 0) {
    recommendations.push({
      severity: 'medium',
      category: 'cross-border-transfer',
      message: `Found ${crossBorderFindings.length} references to cloud services in different jurisdictions.`,
      action: 'Ensure appropriate transfer mechanisms are in place (SCCs, BCRs, adequacy decisions). Conduct Transfer Impact Assessment.'
    });
  }

  recommendations.push({
    severity: 'low',
    category: 'data-retention',
    message: 'No explicit data retention policy detected.',
    action: 'Implement data retention schedules. Define maximum retention periods for all data categories. Implement automatic data purging.'
  });

  recommendations.push({
    severity: 'low',
    category: 'data-subject-rights',
    message: 'Ensure data subject rights are supported.',
    action: 'Implement mechanisms for data access, rectification, erasure, and portability requests. Document procedures in privacy policy.'
  });

  recommendations.push({
    severity: 'low',
    category: 'pipil-compliance',
    message: 'Chinese PIPL (个人信息保护法) compliance.',
    action: 'If processing data of Chinese citizens, ensure compliance with PIPL. Implement separate consent mechanisms and data localization requirements.'
  });

  return recommendations;
}

// ---- Helpers ----

function findFiles(dir, extensions, maxDepth = 10, excludeDirs = ['node_modules', 'dist', 'lib', 'out', 'gen', '.git', 'bundled']) {
  const results = [];
  function walk(currentDir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.cjs') continue;
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (excludeDirs.includes(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(full);
        }
      }
    }
  }
  walk(dir, 0);
  return results;
}

// ---- PII Detection ----

function scanFileForPII(filePath) {
  const findings = [];
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return findings; }

  const relPath = path.relative(ROOT, filePath);

  for (const [piiType, config] of Object.entries(PII_PATTERNS)) {
    const matches = content.match(config.pattern);
    if (matches && matches.length > 0) {
      findings.push({
        type: piiType,
        severity: config.severity,
        category: config.category,
        gdprArticle: config.gdprArticle,
        file: relPath,
        occurrences: matches.length,
        // Don't include actual matched values in report for security
        sample: matches[0].replace(/[a-zA-Z0-9]/g, 'X').slice(0, 20) + '...'
      });
    }
  }

  return findings;
}

// ---- Data Collection Detection ----

function scanFileForDataCollection(filePath) {
  const findings = [];
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return findings; }

  const relPath = path.relative(ROOT, filePath);

  for (const { pattern, name, description } of DATA_COLLECTION_PATTERNS) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      findings.push({
        type: name,
        description,
        file: relPath,
        occurrences: matches.length
      });
    }
  }

  return findings;
}

// ---- Data Retention Detection ----

function scanFileForRetentionPolicies(filePath) {
  const findings = [];
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return findings; }

  const relPath = path.relative(ROOT, filePath);

  for (const { pattern, name } of RETENTION_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        type: name,
        file: relPath
      });
    }
  }

  return findings;
}

// ---- Cross-Border Data Transfer Detection ----

function scanFileForCrossBorderTransfer(filePath) {
  const findings = [];
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return findings; }

  const relPath = path.relative(ROOT, filePath);

  for (const { pattern, name, region, adequacy } of CROSS_BORDER_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        service: name,
        region,
        adequacy,
        file: relPath
      });
    }
  }

  return findings;
}

// ---- Data Minimization Check ----

function checkDataMinimization(dataCollectionFindings) {
  const categories = {};
  for (const finding of dataCollectionFindings) {
    categories[finding.type] = (categories[finding.type] || 0) + 1;
  }

  const riskAreas = [];
  if (categories['console.log'] > 10) {
    riskAreas.push({
      type: 'excessive-logging',
      severity: 'medium',
      message: `High number of console.log calls (${categories['console.log']}). May leak PII in production logs.`,
      action: 'Remove or replace console.log with structured logging. Ensure PII is not logged.'
    });
  }

  if (categories['file write'] > 5) {
    riskAreas.push({
      type: 'file-persistence',
      severity: 'low',
      message: `Multiple file write operations (${categories['file write']}). Verify data minimization.`,
      action: 'Review what data is persisted to filesystem. Ensure only necessary data is stored.'
    });
  }

  return {
    categoryCounts: categories,
    totalDataPoints: dataCollectionFindings.length,
    riskAreas,
    status: riskAreas.length > 0 ? 'review_required' : 'compliant'
  };
}

// ---- Data Retention Policy Validation ----

function validateRetentionPolicies(retentionFindings) {
  const hasExplicitPolicy = retentionFindings.some(f => f.type === 'retention policy reference');
  const tempFileRefs = retentionFindings.filter(f => f.type === 'temporary/cache file reference');

  return {
    hasExplicitPolicy,
    explicitPolicyReferences: retentionFindings.filter(f => f.type === 'retention policy reference').length,
    tempFileReferences: tempFileRefs.length,
    status: hasExplicitPolicy ? 'policy_found' : 'no_policy_found',
    recommendation: hasExplicitPolicy
      ? 'Review existing retention policies for completeness.'
      : 'No explicit data retention policy found. Define and document retention periods for all data categories.'
  };
}

// ---- Generate GDPR Report ----

function generateGDPRReport(piiFindings, dataCollectionFindings, retentionFindings, crossBorderFindings, minimizationResult, retentionResult, dpia) {
  return {
    report: 'GDPR / Data Protection Compliance Assessment',
    generatedAt: new Date().toISOString(),
    project: 'kairo-ide',
    version: '0.1.0',

    piiDetection: {
      totalFindings: piiFindings.length,
      bySeverity: {
        critical: piiFindings.filter(f => f.severity === 'critical').length,
        high: piiFindings.filter(f => f.severity === 'high').length,
        medium: piiFindings.filter(f => f.severity === 'medium').length,
        low: piiFindings.filter(f => f.severity === 'low').length,
        info: piiFindings.filter(f => f.severity === 'info').length
      },
      byCategory: groupBy(piiFindings, 'category'),
      findings: piiFindings.slice(0, 100)
    },

    dataMinimization: minimizationResult,

    dataRetention: retentionResult,

    crossBorderTransfer: {
      totalFindings: crossBorderFindings.length,
      byRegion: groupBy(crossBorderFindings, 'region'),
      findings: crossBorderFindings
    },

    dpia: dpia.dpia,

    recommendations: dpia.recommendations
  };
}

// ---- Summary Generation ----

function generateSummary(report) {
  const totalPII = report.piiDetection.totalFindings;
  const criticalPII = report.piiDetection.bySeverity.critical;
  const hasCrossBorder = report.crossBorderTransfer.totalFindings > 0;
  const hasRetentionPolicy = report.dataRetention.hasExplicitPolicy;

  let overallRisk = 'low';
  if (criticalPII > 0) overallRisk = 'critical';
  else if (totalPII > 10) overallRisk = 'high';
  else if (totalPII > 5 || hasCrossBorder) overallRisk = 'medium';

  return {
    project: 'kairo-ide',
    generatedAt: new Date().toISOString(),
    overallRisk,
    complianceStatus: {
      piiDetection: totalPII === 0 ? 'pass' : criticalPII > 0 ? 'fail' : 'review',
      dataMinimization: report.dataMinimization.status === 'compliant' ? 'pass' : 'review',
      dataRetention: hasRetentionPolicy ? 'pass' : 'review',
      crossBorderTransfer: hasCrossBorder ? 'review' : 'pass',
      dpia: 'completed'
    },
    keyFindings: [
      `Total PII findings: ${totalPII} (${criticalPII} critical)`,
      `Data collection points: ${report.dataMinimization.totalDataPoints}`,
      `Cross-border service references: ${report.crossBorderTransfer.totalFindings}`,
      `Data retention policy: ${hasRetentionPolicy ? 'found' : 'NOT FOUND'}`
    ],
    urgentActions: report.recommendations.filter(r => r.severity === 'critical' || r.severity === 'high')
  };
}

function groupBy(arr, key) {
  const result = {};
  for (const item of arr) {
    const val = item[key] || 'unknown';
    result[val] = (result[val] || 0) + 1;
  }
  return result;
}

// ---- Main ----

function main() {
  fs.mkdirSync(COMPLIANCE_DIR, { recursive: true });

  console.log('[gdpr-check] Scanning for PII data...');
  const sourceFiles = [
    ...findFiles(path.join(ROOT, 'scripts'), ['.cjs', '.js', '.ps1', '.sh', '.json']),
    ...findFiles(path.join(ROOT, 'packages'), ['.ts', '.tsx', '.json']),
    ...findFiles(path.join(ROOT, 'apps'), ['.ts', '.tsx', '.js', '.json', '.html', '.css']),
    ...findFiles(path.join(ROOT, 'runtime-agent'), ['.go', '.yaml', '.yml']),
    ...findFiles(path.join(ROOT, 'tests'), ['.cjs', '.ts', '.js'])
  ];

  const piiFindings = [];
  const dataCollectionFindings = [];
  const retentionFindings = [];
  const crossBorderFindings = [];

  for (const file of sourceFiles) {
    piiFindings.push(...scanFileForPII(file));
    dataCollectionFindings.push(...scanFileForDataCollection(file));
    retentionFindings.push(...scanFileForRetentionPolicies(file));
    crossBorderFindings.push(...scanFileForCrossBorderTransfer(file));
  }

  console.log(`[gdpr-check] PII findings: ${piiFindings.length}`);
  console.log(`[gdpr-check] Data collection points: ${dataCollectionFindings.length}`);
  console.log(`[gdpr-check] Retention references: ${retentionFindings.length}`);
  console.log(`[gdpr-check] Cross-border references: ${crossBorderFindings.length}`);

  // Data minimization check
  const minimizationResult = checkDataMinimization(dataCollectionFindings);

  // Retention policy validation
  const retentionResult = validateRetentionPolicies(retentionFindings);

  // Generate DPIA
  const dpia = generateDPIA(piiFindings, dataCollectionFindings, retentionFindings, crossBorderFindings);

  // Generate report
  const report = generateGDPRReport(piiFindings, dataCollectionFindings, retentionFindings, crossBorderFindings, minimizationResult, retentionResult, dpia);
  const reportPath = path.join(COMPLIANCE_DIR, 'gdpr-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[gdpr-check] GDPR report written to ${path.relative(ROOT, reportPath)}`);

  // Generate DPIA separately
  const dpiaPath = path.join(COMPLIANCE_DIR, 'dpia-report.json');
  fs.writeFileSync(dpiaPath, JSON.stringify(dpia, null, 2));
  console.log(`[gdpr-check] DPIA written to ${path.relative(ROOT, dpiaPath)}`);

  // Generate summary
  const summary = generateSummary(report);
  const summaryPath = path.join(COMPLIANCE_DIR, 'gdpr-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`[gdpr-check] Summary written to ${path.relative(ROOT, summaryPath)}`);

  // Print summary
  console.log('\n=== GDPR Check Summary ===');
  console.log(`Overall risk: ${summary.overallRisk.toUpperCase()}`);
  console.log(`PII findings: ${piiFindings.length} (${piiFindings.filter(f => f.severity === 'critical').length} critical, ${piiFindings.filter(f => f.severity === 'high').length} high)`);
  console.log(`Data collection points: ${dataCollectionFindings.length}`);
  console.log(`Cross-border references: ${crossBorderFindings.length}`);
  console.log(`Data retention policy: ${retentionResult.status}`);

  if (summary.urgentActions.length > 0) {
    console.log('\nUrgent actions required:');
    for (const action of summary.urgentActions) {
      console.log(`  [${action.severity.toUpperCase()}] ${action.message}`);
      console.log(`    → ${action.action}`);
    }
  }

  if (piiFindings.filter(f => f.severity === 'critical').length > 0) {
    console.error('\n[gdpr-check] CRITICAL PII exposures found!');
    process.exit(1);
  }

  console.log('\n[gdpr-check] Check complete.');
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
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
};