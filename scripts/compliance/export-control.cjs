#!/usr/bin/env node
'use strict';

/**
 * Export Control Checker for Kairo IDE
 * Detects cryptographic algorithms, assists with ECCN classification,
 * checks dependency origin countries, and screens against sanctioned entities.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..', '..');
const COMPLIANCE_DIR = path.join(ROOT, 'dist', 'compliance');

// ---- ECCN Classification Reference ----
// Based on EAR Category 5 Part 2 (Information Security)
const ECCN_CATEGORIES = {
  '5D002': {
    description: 'Information Security Software (encryption)',
    triggers: ['encryption', 'cryptography', 'SSL', 'TLS', 'HTTPS', 'cipher'],
    notes: 'Most mass-market encryption software is classified under 5D002.c.1 (ENC)'
  },
  '5D992': {
    description: 'Mass Market Encryption Software (ENC Unrestricted)',
    triggers: ['mass market', 'retail', 'publicly available'],
    notes: 'Commodity encryption software with limited key lengths'
  },
  'EAR99': {
    description: 'No License Required (NLR) for most destinations',
    triggers: [],
    notes: 'Default classification for most commercial software'
  }
};

// ---- Cryptographic Algorithm Patterns ----
const CRYPTO_PATTERNS = {
  // Symmetric encryption
  'AES': [
    /\bAES[-_\s]?(128|192|256|GCM|CBC|ECB|CTR)?\b/i,
    /Advanced Encryption Standard/i,
    /\bRijndael\b/i
  ],
  'DES/3DES': [
    /\b(3DES|TripleDES|DES-EDE)\b/i,
    /(?:^|[^A-Z])DES([^A-Z]|$)/i
  ],
  'Blowfish': [
    /\bBlowfish\b/i,
    /\bTwofish\b/i
  ],
  'ChaCha20': [
    /\bChaCha20\b/i,
    /\bChaCha20-Poly1305\b/i
  ],

  // Asymmetric encryption
  'RSA': [
    /\bRSA\b(?!-)/i,
    /Rivest[- ]Shamir[- ]Adleman/i,
    /\bPKCS#?1\b/i
  ],
  'ECC': [
    /\bECC\b/i,
    /\bElliptic[- ]Curve\b/i,
    /\bECDH\b/i,
    /\bECDSA\b/i,
    /\bEd25519\b/i,
    /\bEd448\b/i,
    /\bX25519\b/i,
    /\bX448\b/i,
    /\bCurve25519\b/i,
    /\bsecp256k1\b/i,
    /\bP-256\b/i,
    /\bP-384\b/i,
    /\bP-521\b/i
  ],
  'Diffie-Hellman': [
    /\bDiffie[- ]Hellman\b/i,
    /\bDH\b/,
    /\bDHE\b/
  ],

  // Hash functions
  'SHA-2': [
    /\bSHA[-_]?256\b/i,
    /\bSHA[-_]?384\b/i,
    /\bSHA[-_]?512\b/i,
    /\bSHA[-_]2\b/i
  ],
  'SHA-3': [
    /\bSHA[-_]3\b/i,
    /\bSHAKE\b/i,
    /\bKeccak\b/i
  ],
  'BLAKE2': [
    /\bBLAKE2[sb]?\b/i
  ],

  // TLS/SSL
  'TLS': [
    /\bTLS\s*(1\.[0-3]|v?1\.[0-3])?\b/i,
    /\bTransport Layer Security\b/i,
    /createSecureContext/i,
    /\bSSL_CTX\b/i
  ],
  'SSL': [
    /\bSSL\s*(2\.0|3\.0)?\b/i,
    /\bSecure Sockets Layer\b/i
  ],

  // Key derivation
  'PBKDF2': [
    /\bPBKDF2\b/i,
    /\bscrypt\b/i,
    /\bArgon2[i]?\b/i,
    /\bbcrypt\b/i
  ],

  // Digital signatures
  'HMAC': [/\bHMAC\b/i],

  // Certificate related
  'X.509': [/\bX\.509\b/i, /\bPKI\b/i, /\bcertificate\b/i]
};

// ---- Sanctioned Entities List (Sample) ----
// In production, this should be loaded from a regularly updated source
const SANCTIONED_ENTITIES = [
  // OFAC SDN list (sample entries)
  { name: 'North Korea', type: 'country', sanction: 'Comprehensive', programs: ['OFAC', 'UN'] },
  { name: 'Iran', type: 'country', sanction: 'Comprehensive', programs: ['OFAC', 'UN'] },
  { name: 'Syria', type: 'country', sanction: 'Comprehensive', programs: ['OFAC', 'UN'] },
  { name: 'Cuba', type: 'country', sanction: 'Comprehensive', programs: ['OFAC'] },
  { name: 'Crimea Region', type: 'region', sanction: 'Comprehensive', programs: ['OFAC', 'EU'] },
  { name: 'Donetsk Region', type: 'region', sanction: 'Comprehensive', programs: ['OFAC', 'EU'] },
  { name: 'Luhansk Region', type: 'region', sanction: 'Comprehensive', programs: ['OFAC', 'EU'] }
];

// ---- Restricted Destinations (EAR Country Groups D:1, E:1, E:2) ----
const RESTRICTED_DESTINATIONS = [
  'Cuba', 'Iran', 'North Korea', 'Syria',
  'Crimea Region of Ukraine', 'Donetsk Region of Ukraine', 'Luhansk Region of Ukraine'
];

// ---- Country of Origin for Common Dependencies ----
const DEPENDENCY_ORIGIN_MAP = {
  // npm packages
  'typescript': { country: 'US', origin: 'Microsoft' },
  'eslint': { country: 'US', origin: 'OpenJS Foundation' },
  'playwright': { country: 'US', origin: 'Microsoft' },
  'prettier': { country: 'US', origin: 'Prettier' },
  'axe-core': { country: 'US', origin: 'Deque Systems' },
  'rimraf': { country: 'US', origin: 'Isaac Z. Schlueter' },

  // Go modules
  'github.com/gorilla/websocket': { country: 'US', origin: 'Gorilla Web Toolkit' },
  'golang.org/x/text': { country: 'US', origin: 'Go Authors' },
  'gopkg.in/yaml.v3': { country: 'Unknown', origin: 'Canonical/Community' },

  // Bundled
  'Apache Tomcat': { country: 'US', origin: 'Apache Software Foundation' },
  'Eclipse JDT Language Server': { country: 'US', origin: 'Eclipse Foundation' }
};

// ---- Helpers ----

function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function findFiles(dir, extensions, maxDepth = 10) {
  const results = [];
  function walk(currentDir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        if (entry.name === 'dist' || entry.name === 'lib' || entry.name === 'out' || entry.name === 'gen') continue;
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

// ---- Cryptographic Algorithm Detection ----

function scanFileForCrypto(filePath) {
  const findings = [];
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return findings; }

  const ext = path.extname(filePath).toLowerCase();

  // Skip binary files and known non-code files
  if (['.exe', '.dll', '.node', '.jar', '.png', '.jpg', '.ico', '.asar', '.gz', '.zip'].includes(ext)) {
    return findings;
  }

  for (const [algorithm, patterns] of Object.entries(CRYPTO_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        findings.push({
          file: path.relative(ROOT, filePath),
          algorithm,
          category: classifyAlgorithm(algorithm)
        });
        break; // One match per algorithm per file
      }
    }
  }

  return findings;
}

function classifyAlgorithm(algorithm) {
  const symmetric = ['AES', 'DES/3DES', 'Blowfish', 'ChaCha20'];
  const asymmetric = ['RSA', 'ECC', 'Diffie-Hellman'];
  const hash = ['SHA-2', 'SHA-3', 'BLAKE2'];
  const protocol = ['TLS', 'SSL'];
  const kdf = ['PBKDF2'];
  const signature = ['HMAC'];
  const cert = ['X.509'];

  if (symmetric.includes(algorithm)) return 'symmetric-encryption';
  if (asymmetric.includes(algorithm)) return 'asymmetric-encryption';
  if (hash.includes(algorithm)) return 'hash-function';
  if (protocol.includes(algorithm)) return 'transport-security';
  if (kdf.includes(algorithm)) return 'key-derivation';
  if (signature.includes(algorithm)) return 'message-authentication';
  if (cert.includes(algorithm)) return 'certificate';
  return 'other';
}

// ---- ECCN Classification ----

function classifyECCN(cryptoFindings) {
  const hasEncryption = cryptoFindings.some(f =>
    ['symmetric-encryption', 'asymmetric-encryption'].includes(f.category)
  );
  const hasTLS = cryptoFindings.some(f => f.category === 'transport-security');

  if (hasEncryption || hasTLS) {
    return {
      eccn: '5D002',
      description: 'Information Security Software (encryption)',
      subcategory: '5D002.c.1',
      reporting: 'ENC (Unrestricted) - Self-classification report required',
      notes: 'Mass-market encryption software. Self-classification report to BIS and ENC Encryption Request Coordinator required.'
    };
  }

  return {
    eccn: 'EAR99',
    description: 'No License Required (NLR)',
    subcategory: null,
    reporting: 'None required',
    notes: 'No encryption functionality detected. Standard EAR99 classification.'
  };
}

// ---- Dependency Origin Check ----

function checkDependencyOrigins() {
  const findings = [];
  const restricted = [];

  for (const [depName, info] of Object.entries(DEPENDENCY_ORIGIN_MAP)) {
    const isRestricted = RESTRICTED_DESTINATIONS.some(d =>
      info.country.toLowerCase().includes(d.toLowerCase())
    );

    findings.push({
      dependency: depName,
      country: info.country,
      origin: info.origin,
      restricted: isRestricted
    });

    if (isRestricted) {
      restricted.push({
        dependency: depName,
        country: info.country,
        origin: info.origin,
        action: 'Review for sanctions compliance. May require OFAC license.'
      });
    }
  }

  return { findings, restricted };
}

// ---- Sanctioned Entity Check ----

function checkSanctionedEntities() {
  const findings = [];
  const hits = [];

  // Check all source files for references to sanctioned entities
  const sourceFiles = [
    ...findFiles(path.join(ROOT, 'scripts'), ['.cjs', '.js', '.ps1', '.sh']),
    ...findFiles(path.join(ROOT, 'packages'), ['.ts', '.tsx', '.json']),
    ...findFiles(path.join(ROOT, 'apps'), ['.ts', '.tsx', '.json']),
    ...findFiles(path.join(ROOT, 'runtime-agent'), ['.go'])
  ];

  for (const file of sourceFiles) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }

    for (const entity of SANCTIONED_ENTITIES) {
      const regex = new RegExp(entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      if (regex.test(content)) {
        const relPath = path.relative(ROOT, file);
        if (!hits.some(h => h.entity === entity.name && h.file === relPath)) {
          hits.push({
            entity: entity.name,
            type: entity.type,
            sanction: entity.sanction,
            file: relPath
          });
        }
      }
    }
  }

  return { findings: SANCTIONED_ENTITIES, hits };
}

// ---- Generate Export Control Report ----

function generateExportControlReport(cryptoFindings, eccnClassification, originCheck, sanctionCheck) {
  const cryptoByCategory = {};
  for (const finding of cryptoFindings) {
    if (!cryptoByCategory[finding.category]) {
      cryptoByCategory[finding.category] = [];
    }
    cryptoByCategory[finding.category].push(finding);
  }

  return {
    report: 'Export Control Assessment',
    generatedAt: new Date().toISOString(),
    project: 'kairo-ide',
    version: '0.1.0',

    eccnClassification,

    cryptographySummary: {
      totalFindings: cryptoFindings.length,
      byCategory: Object.fromEntries(
        Object.entries(cryptoByCategory).map(([k, v]) => [k, v.length])
      ),
      details: cryptoFindings.slice(0, 100) // Limit to first 100 for report size
    },

    dependencyOriginCheck: {
      totalDependencies: originCheck.findings.length,
      restrictedDestinations: originCheck.restricted.length,
      restricted: originCheck.restricted
    },

    sanctionedEntityCheck: {
      entitiesScanned: sanctionCheck.findings.length,
      hits: sanctionCheck.hits.length,
      details: sanctionCheck.hits
    },

    recommendations: generateExportRecommendations(eccnClassification, originCheck, sanctionCheck)
  };
}

function generateExportRecommendations(eccn, originCheck, sanctionCheck) {
  const recommendations = [];

  if (eccn.eccn === '5D002') {
    recommendations.push({
      severity: 'medium',
      category: 'export-classification',
      message: 'Product contains encryption functionality (ECCN 5D002).',
      action: 'Submit self-classification report to BIS and ENC Encryption Request Coordinator. Ensure ENC (Unrestricted) classification eligibility.'
    });
  }

  if (originCheck.restricted.length > 0) {
    recommendations.push({
      severity: 'high',
      category: 'sanctions',
      message: `Found ${originCheck.restricted.length} dependencies from restricted destinations.`,
      action: 'Verify no dependencies originate from comprehensively sanctioned regions. Obtain OFAC licenses if necessary.'
    });
  }

  if (sanctionCheck.hits.length > 0) {
    recommendations.push({
      severity: 'high',
      category: 'sanctions',
      message: `Found ${sanctionCheck.hits.length} references to sanctioned entities in source code.`,
      action: 'Review all references to sanctioned entities. Ensure no business with sanctioned parties.'
    });
  }

  recommendations.push({
    severity: 'low',
    category: 'best-practice',
    message: 'Regularly review export control classification and sanctions lists.',
    action: 'Schedule quarterly export control review. Update sanctioned entity lists from official sources.'
  });

  recommendations.push({
    severity: 'low',
    category: 'best-practice',
    message: 'Chinese export control compliance (中国出口管制法).',
    action: 'Review compliance with PRC Export Control Law. Check if technology falls under restricted/prohibited categories.'
  });

  return recommendations;
}

// ---- Main ----

function main() {
  fs.mkdirSync(COMPLIANCE_DIR, { recursive: true });

  console.log('[export-control] Scanning for cryptographic algorithms...');
  const sourceFiles = [
    ...findFiles(path.join(ROOT, 'scripts'), ['.cjs', '.js', '.ps1', '.sh']),
    ...findFiles(path.join(ROOT, 'packages'), ['.ts', '.tsx']),
    ...findFiles(path.join(ROOT, 'apps'), ['.ts', '.tsx', '.js']),
    ...findFiles(path.join(ROOT, 'runtime-agent'), ['.go'])
  ];

  const cryptoFindings = [];
  for (const file of sourceFiles) {
    const findings = scanFileForCrypto(file);
    cryptoFindings.push(...findings);
  }

  console.log(`[export-control] Found ${cryptoFindings.length} crypto-related findings`);

  // ECCN Classification
  console.log('[export-control] Determining ECCN classification...');
  const eccnClassification = classifyECCN(cryptoFindings);
  console.log(`[export-control] ECCN: ${eccnClassification.eccn} - ${eccnClassification.description}`);

  // Dependency Origin Check
  console.log('[export-control] Checking dependency origins...');
  const originCheck = checkDependencyOrigins();
  console.log(`[export-control] Checked ${originCheck.findings.length} dependencies, ${originCheck.restricted.length} restricted`);

  // Sanctioned Entity Check
  console.log('[export-control] Checking sanctioned entities...');
  const sanctionCheck = checkSanctionedEntities();
  console.log(`[export-control] Found ${sanctionCheck.hits.length} entity references`);

  // Generate report
  const report = generateExportControlReport(cryptoFindings, eccnClassification, originCheck, sanctionCheck);
  const reportPath = path.join(COMPLIANCE_DIR, 'export-control-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[export-control] Report written to ${path.relative(ROOT, reportPath)}`);

  // Print summary
  console.log('\n=== Export Control Summary ===');
  console.log(`ECCN: ${eccnClassification.eccn}`);
  console.log(`Crypto findings: ${cryptoFindings.length}`);

  if (cryptoFindings.length > 0) {
    const categories = {};
    for (const f of cryptoFindings) {
      categories[f.algorithm] = (categories[f.algorithm] || 0) + 1;
    }
    console.log('Algorithms detected:');
    for (const [algo, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${algo}: ${count} references`);
    }
  }

  console.log(`Restricted origin dependencies: ${originCheck.restricted.length}`);
  console.log(`Sanctioned entity references: ${sanctionCheck.hits.length}`);

  if (sanctionCheck.hits.length > 0) {
    console.log('\nSanctioned entity hits:');
    for (const hit of sanctionCheck.hits) {
      console.log(`  ${hit.entity} (${hit.type}) in ${hit.file}`);
    }
  }

  if (report.recommendations.length > 0) {
    console.log('\nRecommendations:');
    for (const rec of report.recommendations) {
      console.log(`  [${rec.severity.toUpperCase()}] ${rec.message}`);
    }
  }

  console.log('\n[export-control] Check complete.');
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
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
};