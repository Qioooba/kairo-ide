/**
 * ProjectModel Single Source of Truth — unified project configuration,
 * deterministic ordered classpath, revision monotonic progression, and
 * workspace lifecycle isolation (PR13 - T44 ~ T46).
 */

import type {
  OrderedClasspathEntry,
  ClasspathConflictDiagnostic,
  ProjectModelDiagnostic,
  ProjectModelSnapshot,
} from '@kairo/protocol';

export interface ProjectModelOptions {
  projectId: string;
  rootPath: string;
  sourceRoots?: string[];
  resourceRoots?: string[];
  webRoots?: string[];
  outputDir?: string;
  encoding?: string;
  sourceLevel?: string;
  targetLevel?: string;
  compiler?: { toolchainId: string; version: string; executablePath?: string };
  runtimeJvm?: { id: string; home: string; version: string };
  classpath?: OrderedClasspathEntry[];
}

export type RevisionChangeListener = (snapshot: ProjectModelSnapshot) => void;

export class ProjectModelManager {
  private projectId: string;
  private rootPath: string;
  private revision = 1;
  private workspaceGeneration = 1;
  private sourceRoots: string[] = [];
  private resourceRoots: string[] = [];
  private webRoots: string[] = [];
  private outputDir = 'build/classes';
  private encoding = 'UTF-8';
  private sourceLevel = '1.6';
  private targetLevel = '1.6';
  private compiler = { toolchainId: 'javac', version: '1.6' };
  private runtimeJvm = { id: 'jvm-1.6', home: '', version: '1.6' };
  private classpath: OrderedClasspathEntry[] = [];
  private diagnostics: ProjectModelDiagnostic[] = [];
  private listeners = new Set<RevisionChangeListener>();

  constructor(opts: ProjectModelOptions) {
    this.projectId = opts.projectId;
    this.rootPath = opts.rootPath;
    if (opts.sourceRoots) this.sourceRoots = [...opts.sourceRoots];
    if (opts.resourceRoots) this.resourceRoots = [...opts.resourceRoots];
    if (opts.webRoots) this.webRoots = [...opts.webRoots];
    if (opts.outputDir) this.outputDir = opts.outputDir;
    if (opts.encoding) this.encoding = opts.encoding;
    if (opts.sourceLevel) this.sourceLevel = opts.sourceLevel;
    if (opts.targetLevel) this.targetLevel = opts.targetLevel;
    if (opts.compiler) this.compiler = { ...opts.compiler };
    if (opts.runtimeJvm) this.runtimeJvm = { ...opts.runtimeJvm };
    if (opts.classpath) {
      this.classpath = [...opts.classpath];
      this.recalculateDiagnostics();
    }
  }

  getRevision(): number {
    return this.revision;
  }

  getWorkspaceGeneration(): number {
    return this.workspaceGeneration;
  }

  getSnapshot(): ProjectModelSnapshot {
    return {
      projectId: this.projectId,
      rootPath: this.rootPath,
      revision: this.revision,
      sourceRoots: [...this.sourceRoots],
      resourceRoots: [...this.resourceRoots],
      webRoots: [...this.webRoots],
      outputDir: this.outputDir,
      encoding: this.encoding,
      sourceLevel: this.sourceLevel,
      targetLevel: this.targetLevel,
      compiler: { ...this.compiler },
      runtimeJvm: { ...this.runtimeJvm },
      classpath: [...this.classpath],
      diagnostics: [...this.diagnostics],
      updatedAt: new Date().toISOString(),
    };
  }

  onRevisionChange(listener: RevisionChangeListener): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  /**
   * Validate that a caller's expected revision matches the active revision (T45).
   */
  validateRevision(expectedRevision: number): boolean {
    return this.revision === expectedRevision;
  }

  /**
   * Update source roots and bump revision (T45).
   */
  updateSourceRoots(sourceRoots: string[]): ProjectModelSnapshot {
    this.sourceRoots = [...sourceRoots];
    return this.bumpRevision();
  }

  /**
   * Update output directory and bump revision (T45).
   */
  updateOutputDir(outputDir: string): ProjectModelSnapshot {
    this.outputDir = outputDir;
    return this.bumpRevision();
  }

  /**
   * Update ordered classpath and recalculate conflict diagnostics (T44, T45).
   */
  updateClasspath(classpath: OrderedClasspathEntry[]): ProjectModelSnapshot {
    this.classpath = [...classpath];
    this.recalculateDiagnostics();
    return this.bumpRevision();
  }

  /**
   * Update toolchain / compiler settings and bump revision.
   */
  updateToolchain(
    sourceLevel: string,
    targetLevel: string,
    compiler?: { toolchainId: string; version: string; executablePath?: string },
  ): ProjectModelSnapshot {
    this.sourceLevel = sourceLevel;
    this.targetLevel = targetLevel;
    if (compiler) {
      this.compiler = { ...compiler };
    }
    return this.bumpRevision();
  }

  /**
   * Detect duplicate class names between dependency JARs while preserving exact classpath order (T44).
   */
  detectClasspathConflicts(classpath: OrderedClasspathEntry[]): ClasspathConflictDiagnostic[] {
    const classOwner = new Map<string, string>(); // className -> winningPath
    const conflicts: ClasspathConflictDiagnostic[] = [];

    // Classpath is scanned in strict index order: first appearance wins, later is shadowed
    for (const entry of classpath) {
      if (!entry.classes || entry.classes.length === 0) continue;

      for (const cls of entry.classes) {
        const winner = classOwner.get(cls);
        if (!winner) {
          classOwner.set(cls, entry.path);
        } else if (winner !== entry.path) {
          conflicts.push({
            className: cls,
            winningPath: winner,
            shadowedPath: entry.path,
            message: `Class '${cls}' in '${entry.path}' is shadowed by earlier classpath entry '${winner}'`,
          });
        }
      }
    }

    return conflicts;
  }

  private recalculateDiagnostics(): void {
    const newDiagnostics: ProjectModelDiagnostic[] = [];

    // 1. Classpath conflicts (T44)
    const conflicts = this.detectClasspathConflicts(this.classpath);
    for (const conflict of conflicts) {
      newDiagnostics.push({
        type: 'classpath_conflict',
        severity: 'warning',
        message: conflict.message,
        path: conflict.shadowedPath,
        details: {
          className: conflict.className,
          winningPath: conflict.winningPath,
          shadowedPath: conflict.shadowedPath,
        },
      });
    }

    // 2. Unresolved classpath paths
    for (const entry of this.classpath) {
      if (!entry.resolved) {
        newDiagnostics.push({
          type: 'unresolved_path',
          severity: 'warning',
          message: `Classpath entry does not exist on disk: '${entry.path}'`,
          path: entry.path,
        });
      }
    }

    this.diagnostics = newDiagnostics;
  }

  private bumpRevision(): ProjectModelSnapshot {
    this.revision++;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore listener exceptions
      }
    }
    return snapshot;
  }

  /**
   * Switch workspace: completely reset state, bump generation, and prevent leaking old workspace state (T46).
   */
  switchWorkspace(newRootPath: string, newProjectId?: string): ProjectModelSnapshot {
    this.workspaceGeneration++;
    this.revision = 1;
    this.rootPath = newRootPath;
    this.projectId = newProjectId ?? newRootPath.split(/[/\\]/).pop() ?? 'project';
    this.sourceRoots = [];
    this.resourceRoots = [];
    this.webRoots = [];
    this.classpath = [];
    this.diagnostics = [];

    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore
      }
    }
    return snapshot;
  }
}
