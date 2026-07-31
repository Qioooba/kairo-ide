/**
 * Kairo Extension Compatibility Report — evaluates how well a VS Code extension
 * is expected to work within the Kairo/Theia environment.
 *
 * Checks:
 *   - Engine version compatibility
 *   - Category-based compatibility heuristics
 *   - Known conflict detection with Kairo built-in features
 *   - Activation event risk assessment
 *   - Contributes-based compatibility score
 */

import { KairoExtension } from '../common/kairo-extension-model';
import { satisfies } from 'semver';

/**
 * Per-category compatibility profiles.
 * Each category has a baseline compatibility score and known issues.
 */
export interface CategoryCompat {
  /** Category name */
  readonly category: string;
  /** Base compatibility score: 0.0 = incompatible, 1.0 = fully compatible */
  readonly baseScore: number;
  /** Known issues for this category */
  readonly knownIssues: string[];
}

const CATEGORY_COMPAT: CategoryCompat[] = [
  {
    category: 'Programming Languages',
    baseScore: 0.9,
    knownIssues: [
      'Language Server Protocol (LSP) extensions work well with Theia',
      'TextMate grammars are fully supported',
      'May conflict with Kairo built-in language support for Java/JSP',
    ],
  },
  {
    category: 'Themes',
    baseScore: 0.95,
    knownIssues: [
      'Color themes and icon themes are well-supported',
      'Some theme token scopes may differ from VS Code',
    ],
  },
  {
    category: 'Snippets',
    baseScore: 0.95,
    knownIssues: [
      'Snippet format is fully compatible',
      'Snippet variables ($TM_FILENAME, etc.) are mostly supported',
    ],
  },
  {
    category: 'Linters',
    baseScore: 0.8,
    knownIssues: [
      'Linter extensions that use the Diagnostics API work well',
      'Some linter extensions may require Node.js native modules',
    ],
  },
  {
    category: 'Debuggers',
    baseScore: 0.6,
    knownIssues: [
      'Debug Adapter Protocol (DAP) is supported',
      'Debug UI may differ from VS Code',
      'May conflict with Kairo built-in Java debugger',
    ],
  },
  {
    category: 'Formatters',
    baseScore: 0.85,
    knownIssues: [
      'Formatting API is well-supported',
      'Some formatters may require external binaries',
    ],
  },
  {
    category: 'Keymaps',
    baseScore: 0.5,
    knownIssues: [
      'Keybinding contributions are partially supported',
      'Some advanced keybinding features may not work',
      'Kairo has its own keybinding system that may conflict',
    ],
  },
  {
    category: 'Other',
    baseScore: 0.5,
    knownIssues: [
      'Untested category — compatibility not guaranteed',
      'Test thoroughly before production use',
    ],
  },
];

/**
 * Built-in Kairo features that may conflict with extensions.
 */
export interface KairoFeature {
  readonly id: string;
  readonly name: string;
  /** Extension IDs that are known to conflict */
  readonly conflictingExtensions: string[];
  readonly recommendation: string;
}

const KAIRO_FEATURES: KairoFeature[] = [
  {
    id: 'kairo-java-ls',
    name: 'Kairo Java Language Server',
    conflictingExtensions: ['redhat.java', 'georgewfraser.vscode-javac'],
    recommendation: 'Disable the Kairo Java LS before using this extension, or vice versa.',
  },
  {
    id: 'kairo-java-debug',
    name: 'Kairo Java Debugger',
    conflictingExtensions: ['vscjava.vscode-java-debug'],
    recommendation: 'Only one Java debugger should be active at a time.',
  },
  {
    id: 'kairo-maven',
    name: 'Kairo Maven Support',
    conflictingExtensions: ['vscjava.vscode-maven'],
    recommendation: 'Kairo has built-in Maven support. Use the extension only if you need features not in Kairo Maven.',
  },
  {
    id: 'kairo-terminal',
    name: 'Kairo Terminal',
    conflictingExtensions: [],
    recommendation: 'Kairo uses its own terminal implementation. Terminal extensions may not work correctly.',
  },
  {
    id: 'kairo-scm',
    name: 'Kairo SCM (Git/SVN)',
    conflictingExtensions: ['eamodio.gitlens'],
    recommendation: 'GitLens provides rich Git features that may overlap with Kairo SCM.',
  },
];

/**
 * Compatibility report for a single extension.
 */
export interface CompatibilityReport {
  readonly extensionId: string;
  /** Overall compatibility score: 0.0 - 1.0 */
  readonly score: number;
  /** Human-readable assessment */
  readonly assessment: 'compatible' | 'partial' | 'incompatible' | 'unknown';
  /** Category-based issues */
  readonly categoryIssues: string[];
  /** Engine version issues */
  readonly engineIssues: string[];
  /** Conflicts with Kairo built-in features */
  readonly conflicts: ConflictInfo[];
  /** Overall recommendations */
  readonly recommendations: string[];
}

export interface ConflictInfo {
  readonly kairoFeature: string;
  readonly recommendation: string;
}

/**
 * Generate a compatibility report for an extension.
 */
export function generateCompatibilityReport(extension: KairoExtension): CompatibilityReport {
  const categoryIssues: string[] = [];
  const engineIssues: string[] = [];
  const conflicts: ConflictInfo[] = [];
  const recommendations: string[] = [];

  let totalScore = 0;
  let categoryCount = 0;

  // Check each category
  for (const cat of extension.categories) {
    const compat = CATEGORY_COMPAT.find(c => c.category === cat) || CATEGORY_COMPAT[CATEGORY_COMPAT.length - 1]; // "Other" fallback
    totalScore += compat.baseScore;
    categoryCount++;
    categoryIssues.push(...compat.knownIssues.map(i => `[${cat}] ${i}`));
  }

  // If no categories, use "Other" baseline
  if (categoryCount === 0) {
    const other = CATEGORY_COMPAT[CATEGORY_COMPAT.length - 1];
    totalScore = other.baseScore;
    categoryCount = 1;
    categoryIssues.push(...other.knownIssues.map(i => `[Other] ${i}`));
  }

  let score = totalScore / categoryCount;

  // Engine version check
  if (extension.engineVersion) {
    const engineReq = extension.engineVersion;
    // Check if the required version matches Theia 1.73.x
    const isCompatible = isEngineCompatible(engineReq);
    if (!isCompatible) {
      engineIssues.push(`Extension requires VS Code ${engineReq}, but Kairo provides VS Code 1.73 API surface`);
      score -= 0.2;
    }
  }

  // Check conflicts with Kairo features
  for (const feature of KAIRO_FEATURES) {
    if (feature.conflictingExtensions.includes(extension.id)) {
      conflicts.push({
        kairoFeature: feature.name,
        recommendation: feature.recommendation,
      });
      score -= 0.15;
    }
  }

  // Activation event risk assessment
  if (extension.activationEvents.includes('*')) {
    recommendations.push('This extension activates on IDE startup ("*" activation event), which may increase startup time.');
  }

  // Verify allowlist status
  if (!extension.allowlisted) {
    recommendations.push('This extension is not on the Kairo allowlist. It has not been verified for compatibility.');
    score -= 0.1;
  }

  // Clamp score
  score = Math.max(0, Math.min(1, score));

  // Determine assessment
  let assessment: CompatibilityReport['assessment'];
  if (score >= 0.8) {
    assessment = 'compatible';
  } else if (score >= 0.5) {
    assessment = 'partial';
  } else if (score >= 0.2) {
    assessment = 'incompatible';
  } else {
    assessment = 'unknown';
  }

  return {
    extensionId: extension.id,
    score,
    assessment,
    categoryIssues,
    engineIssues,
    conflicts,
    recommendations,
  };
}

/**
 * Check if an engine version requirement is compatible with Theia 1.73.1.
 */
function isEngineCompatible(engineReq: string): boolean {
  try {
    return satisfies('1.73.1', engineReq);
  } catch {
    return true;
  }
}

/**
 * Get all known Kairo features that could conflict with extensions.
 */
export function getKairoFeatures(): KairoFeature[] {
  return [...KAIRO_FEATURES];
}

/**
 * Check if a specific extension conflicts with any Kairo feature.
 */
export function checkConflicts(extensionId: string): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  for (const feature of KAIRO_FEATURES) {
    if (feature.conflictingExtensions.includes(extensionId)) {
      conflicts.push({
        kairoFeature: feature.name,
        recommendation: feature.recommendation,
      });
    }
  }
  return conflicts;
}