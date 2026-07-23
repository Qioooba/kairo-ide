/**
 * Source/Class Mismatch Diagnostic — P1-DBG-03
 *
 * Detects when source code doesn't match running class files by
 * comparing timestamps of .java vs .class files. Shows a warning
 * in the status bar and Problems panel, and suggests a rebuild
 * before debugging.
 *
 * Key scenarios:
 *   - .java modified after last compilation → class is stale
 *   - .class file missing entirely → project not compiled
 *   - .class newer than .java → normal (up-to-date)
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import { Diagnostic, DiagnosticSeverity } from '@theia/core/shared/vscode-languageserver-protocol';

/** A single mismatch entry. */
export interface SourceMismatchEntry {
  /** Absolute path to the .java source file. */
  sourceFile: string;
  /** Absolute path to the corresponding .class file. */
  classFile: string;
  /** Modification time of the .java file (ms since epoch). */
  sourceMtime: number;
  /** Modification time of the .class file (ms since epoch). */
  classMtime: number;
  /** Whether the .class file is missing entirely. */
  classMissing: boolean;
}

/** Summary of a source/class mismatch scan. */
export interface SourceMismatchReport {
  /** Total .java files scanned. */
  totalScanned: number;
  /** Files where .class is missing (not compiled). */
  missingClass: number;
  /** Files where .java is newer than .class (stale). */
  staleClass: number;
  /** Files that are up to date. */
  upToDate: number;
  /** Detailed mismatch entries. */
  mismatches: SourceMismatchEntry[];
}

const SOURCE_MISMATCH_OWNER = 'kairo-java-source-mismatch';

@injectable()
export class JavaSourceMismatchDetector {
  @inject(FileService) protected readonly fileService!: FileService;
  @inject(ProblemManager) protected readonly problemManager!: ProblemManager;
  @inject(ILogger) protected readonly logger!: ILogger;

  protected readonly onDidCompleteScanEmitter = new Emitter<SourceMismatchReport>();
  readonly onDidCompleteScan: Event<SourceMismatchReport> = this.onDidCompleteScanEmitter.event;

  /** Last scan report. */
  protected lastReport: SourceMismatchReport | undefined;

  @postConstruct()
  protected init(): void {
    this.logger.info('源码/类文件不匹配检测器已初始化');
  }

  get lastScanResult(): SourceMismatchReport | undefined {
    return this.lastReport;
  }

  /**
   * Scan a project directory for source/class timestamp mismatches.
   *
   * Compares each .java file's modification time against its
   * corresponding .class file in the output directory.
   *
   * @param projectRoot Absolute path to the project root
   * @param sourceDir Relative path to the source directory (e.g. 'src')
   * @param outputDir Relative path to the compiled output directory (e.g. 'WebRoot/WEB-INF/classes')
   */
  async scanProject(
    projectRoot: string,
    sourceDir: string,
    outputDir: string,
  ): Promise<SourceMismatchReport> {
    const report: SourceMismatchReport = {
      totalScanned: 0,
      missingClass: 0,
      staleClass: 0,
      upToDate: 0,
      mismatches: [],
    };

    const sourceRoot = URI.fromFilePath(`${projectRoot}/${sourceDir}`);
    const classRoot = URI.fromFilePath(`${projectRoot}/${outputDir}`);

    this.logger.info(`开始扫描源码/类文件不匹配: ${sourceRoot.path} → ${classRoot.path}`);

    try {
      await this.scanDirectory(sourceRoot, classRoot, projectRoot, sourceDir, outputDir, report);
    } catch (error) {
      this.logger.error(`源码/类文件不匹配扫描失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.lastReport = report;
    this.onDidCompleteScanEmitter.fire(report);

    // Update Problems panel with diagnostics
    await this.updateProblemMarkers(report);

    this.logger.info(
      `不匹配扫描完成: 总计 ${report.totalScanned}, ` +
      `缺失 ${report.missingClass}, 过期 ${report.staleClass}, ` +
      `最新 ${report.upToDate}`,
    );

    return report;
  }

  /**
   * Check if a specific source file is out of sync with its class file.
   */
  async checkFile(
    sourceFilePath: string,
    classFilePath: string,
  ): Promise<SourceMismatchEntry | null> {
    try {
      const sourceStat = await this.fileService.resolve(
        URI.fromFilePath(sourceFilePath),
        { resolveMetadata: true },
      );
      const sourceMtime = sourceStat.mtime;

      let classMtime = 0;
      let classMissing = false;

      try {
        const classStat = await this.fileService.resolve(
          URI.fromFilePath(classFilePath),
          { resolveMetadata: true },
        );
        classMtime = classStat.mtime;
      } catch {
        classMissing = true;
      }

      if (classMissing || (sourceMtime > classMtime)) {
        return {
          sourceFile: sourceFilePath,
          classFile: classFilePath,
          sourceMtime,
          classMtime,
          classMissing,
        };
      }
      return null;
    } catch {
      // Source file doesn't exist or can't be read — skip
      return null;
    }
  }

  /**
   * Clear all source mismatch diagnostics from the Problems panel.
   */
  clearDiagnostics(): void {
    this.problemManager.cleanAllMarkers();
  }

  /**
   * Get a human-readable Chinese summary of the last scan.
   */
  getSummary(): string {
    if (!this.lastReport) return '尚未执行源码/类文件不匹配扫描。';

    const r = this.lastReport;
    if (r.mismatches.length === 0) {
      return `源码/类文件不匹配扫描完成: 总计 ${r.totalScanned} 个文件，全部为最新。`;
    }

    const parts: string[] = [];
    if (r.missingClass > 0) {
      parts.push(`${r.missingClass} 个文件缺少 .class 文件（未编译）`);
    }
    if (r.staleClass > 0) {
      parts.push(`${r.staleClass} 个文件 .class 过期（源码已修改）`);
    }
    return `源码/类文件不匹配: ${parts.join('，')}。建议重新编译项目后再进行调试。`;
  }

  /**
   * Get the status bar text for the mismatch diagnostic.
   */
  getStatusBarText(): string {
    if (!this.lastReport) return '$(sync) 源码一致性: 未检测';

    const r = this.lastReport;
    if (r.mismatches.length === 0) {
      return '$(check) 源码一致性: 正常';
    }

    const total = r.missingClass + r.staleClass;
    return `$(warning) 源码一致性: ${total} 个不匹配`;
  }

  // ── Internal helpers ───────────────────────────────────────────

  protected async scanDirectory(
    sourceDir: URI,
    classDir: URI,
    projectRoot: string,
    sourceDirRel: string,
    outputDirRel: string,
    report: SourceMismatchReport,
  ): Promise<void> {
    try {
      const entries = await this.fileService.resolve(sourceDir);

      if (entries.children) {
        for (const child of entries.children) {
          if (child.isDirectory) {
            const subSource = sourceDir.resolve(child.name);
            const subClass = classDir.resolve(child.name);
            await this.scanDirectory(
              subSource,
              subClass,
              projectRoot,
              `${sourceDirRel}/${child.name}`,
              `${outputDirRel}/${child.name}`,
              report,
            );
          } else if (child.name.endsWith('.java')) {
            report.totalScanned++;

            const className = child.name.replace(/\.java$/, '.class');
            const _classFile = classDir.resolve(className);

            const sourceFilePath = `${projectRoot}/${sourceDirRel}/${child.name}`;
            const classFilePath = `${projectRoot}/${outputDirRel}/${className}`;

            const mismatch = await this.checkFile(sourceFilePath, classFilePath);
            if (mismatch) {
              report.mismatches.push(mismatch);
              if (mismatch.classMissing) {
                report.missingClass++;
              } else {
                report.staleClass++;
              }
            } else {
              report.upToDate++;
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  protected async updateProblemMarkers(report: SourceMismatchReport): Promise<void> {
    const uriToDiagnostics = new Map<string, Diagnostic[]>();

    for (const mismatch of report.mismatches) {
      const uri = URI.fromFilePath(mismatch.sourceFile).toString();
      const existing = uriToDiagnostics.get(uri) ?? [];

      const message = mismatch.classMissing
        ? `缺少 .class 文件: ${mismatch.classFile}。请先编译项目。`
        : `.class 文件已过期 (源码修改于 ${new Date(mismatch.sourceMtime).toLocaleString('zh-CN')}，` +
          `.class 构建于 ${new Date(mismatch.classMtime).toLocaleString('zh-CN')})。建议重新编译后再调试。`;

      existing.push({
        message,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        severity: DiagnosticSeverity.Warning,
        source: 'Kairo: 源码/类文件不匹配',
        code: mismatch.classMissing ? 'class-missing' : 'class-stale',
      });

      uriToDiagnostics.set(uri, existing);
    }

    for (const [uriStr, diagnostics] of uriToDiagnostics) {
      this.problemManager.setMarkers(new URI(uriStr), SOURCE_MISMATCH_OWNER, diagnostics);
    }
  }
}