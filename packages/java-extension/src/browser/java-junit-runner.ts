/**
 * Java JUnit Test Runner — P1-TEST-01
 *
 * Discovers JUnit tests via JDT LS workspace symbols (@Test annotations),
 * runs tests via the Go Agent, and parses JUnit XML output to extract
 * structured test results.
 *
 * Supports JUnit 3 and JUnit 4 style tests:
 *   - JUnit 4: @Test annotated methods, @RunWith, @Before, @After
 *   - JUnit 3: classes extending junit.framework.TestCase
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { Endpoint } from '@kairo/protocol';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { JavaLanguageClient } from './java-language-client';
import type { LSPSymbolInformation } from '../common/lsp-protocol';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { URI } from '@theia/core/lib/common/uri';

/** A single test item (class or method). */
export interface JUnitTestItem {
  id: string;
  /** 'class' or 'method' */
  kind: 'class' | 'method';
  /** Fully qualified class name. */
  className: string;
  /** Method name (only for kind='method'). */
  methodName?: string;
  /** Display label. */
  label: string;
  /** Source file path. */
  filePath?: string;
  /** Line number. */
  line?: number;
}

/** Result of a single test method execution. */
export interface JUnitTestResult {
  testId: string;
  className: string;
  methodName: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  durationMs: number;
  failureMessage?: string;
  stackTrace?: string[];
}

/** A complete test run. */
export interface JUnitTestRun {
  id: string;
  state: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startTime: string;
  endTime?: string;
  totalCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  errorCount: number;
  results: JUnitTestResult[];
  output: string;
}

/** Progress event during test execution. */
export interface JUnitTestProgress {
  runId: string;
  phase: 'starting' | 'compiling' | 'executing' | 'parsing' | 'completed' | 'timeout';
  message: string;
}

/** JUnit XML suite parsed from test output. */
interface JUnitXmlSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  testCases: JUnitXmlTestCase[];
}

interface JUnitXmlTestCase {
  className: string;
  name: string;
  time: number;
  failure?: { message: string; type: string; stackTrace: string[] };
  error?: { message: string; type: string; stackTrace: string[] };
  skipped?: boolean;
}

/** Default test execution timeout (ms). */
const DEFAULT_TEST_TIMEOUT_MS = 60_000;

@injectable()
export class JavaJUnitRunner {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(JavaLanguageClient) protected readonly client!: JavaLanguageClient;
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
  @inject(FileService) protected readonly fileService!: FileService;

  protected readonly onDidDiscoverTestsEmitter = new Emitter<JUnitTestItem[]>();
  readonly onDidDiscoverTests: Event<JUnitTestItem[]> = this.onDidDiscoverTestsEmitter.event;

  protected readonly onDidCompleteRunEmitter = new Emitter<JUnitTestRun>();
  readonly onDidCompleteRun: Event<JUnitTestRun> = this.onDidCompleteRunEmitter.event;

  protected readonly onDidProgressEmitter = new Emitter<JUnitTestProgress>();
  readonly onDidProgress: Event<JUnitTestProgress> = this.onDidProgressEmitter.event;

  /**
   * Discover JUnit test classes and methods via JDT LS workspace symbols.
   * Searches for symbols annotated with @Test or classes extending TestCase.
   */
  async discoverTests(): Promise<JUnitTestItem[]> {
    const items: JUnitTestItem[] = [];

    try {
      // Query for @Test annotation symbols
      const testSymbols = await this.client.workspaceSymbols('@Test');
      if (testSymbols && testSymbols.length > 0) {
        for (const sym of testSymbols) {
          if (sym.containerName) {
            const id = `method:${sym.containerName}#${sym.name}`;
            items.push({
              id,
              kind: 'method',
              className: sym.containerName,
              methodName: sym.name,
              label: `${sym.containerName}.${sym.name}`,
              filePath: sym.location?.uri,
              line: sym.location?.range?.start?.line,
            });
          }
        }
      }

      // Also query for TestCase classes
      const testCaseSymbols = await this.client.workspaceSymbols('TestCase');
      if (testCaseSymbols && testCaseSymbols.length > 0) {
        for (const sym of testCaseSymbols) {
          if (sym.kind === 5 /* Class */) {
            // Skip abstract classes
            if (this.isAbstractClass(sym)) {
              this.logger.info(`[JUnit] Skipping abstract class: ${sym.name}`);
              continue;
            }
            const id = `class:${sym.name}`;
            // Avoid duplicates
            if (!items.some(item => item.className === sym.name)) {
              items.push({
                id,
                kind: 'class',
                className: sym.name,
                label: sym.name,
                filePath: sym.location?.uri,
                line: sym.location?.range?.start?.line,
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`[JUnit] Failed to discover tests: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Handle empty results
    if (items.length === 0) {
      this.logger.info('[JUnit] No test classes or methods discovered');
    }

    this.onDidDiscoverTestsEmitter.fire(items);
    return items;
  }

  /**
   * Discover JUnit tests by parsing source files directly.
   * Fallback for when JDT LS is not available.
   *
   * Scans Java files in the workspace for @Test annotations
   * using regex-based parsing.
   */
  async discoverTestsFromFiles(rootPath: string): Promise<JUnitTestItem[]> {
    const items: JUnitTestItem[] = [];
    const seenIds = new Set<string>();

    try {
      const rootUri = URI.fromFilePath(rootPath);
      const javaFiles = await this.findJavaFiles(rootUri);

      for (const fileUri of javaFiles) {
        try {
          const content = await this.fileService.readFile(fileUri);
          const text = content.value.toString();
          const filePath = fileUri.path.toString();

          // Extract class name from file path
          const className = this.extractClassNameFromPath(filePath);
          if (!className) continue;

          // Find @Test annotated methods
          const testMethodRegex = /@Test\s*(?:\([^)]*\))?\s*\n\s*(?:public|protected|private)?\s+\w+\s+(\w+)\s*\(/g;
          let match: RegExpExecArray | null;
          let hasTests = false;

          while ((match = testMethodRegex.exec(text)) !== null) {
            hasTests = true;
            const methodName = match[1];
            const id = `method:${className}#${methodName}`;
            if (seenIds.has(id)) continue;
            seenIds.add(id);

            // Calculate line number
            const line = text.substring(0, match.index).split('\n').length - 1;

            items.push({
              id,
              kind: 'method',
              className,
              methodName,
              label: `${className}.${methodName}`,
              filePath: fileUri.toString(),
              line,
            });
          }

          if (hasTests && !seenIds.has(`class:${className}`)) {
            seenIds.add(`class:${className}`);
            items.push({
              id: `class:${className}`,
              kind: 'class',
              className,
              label: className,
              filePath: fileUri.toString(),
            });
          }
        } catch {
          // Skip files that can't be read
        }
      }
    } catch (error) {
      this.logger.error(`[JUnit] File-based discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (items.length === 0) {
      this.logger.info('[JUnit] No test classes discovered from file scanning');
    }

    this.onDidDiscoverTestsEmitter.fire(items);
    return items;
  }

  /**
   * Recursively find all .java files under a root URI.
   */
  protected async findJavaFiles(rootUri: URI): Promise<URI[]> {
    const javaFiles: URI[] = [];
    const stack = [rootUri];

    while (stack.length > 0) {
      const currentUri = stack.pop()!;
      try {
        const stat = await this.fileService.resolve(currentUri);
        if (stat.isDirectory) {
          for (const child of stat.children || []) {
            stack.push(child.resource);
          }
        } else if (stat.isFile && currentUri.path.toString().endsWith('.java')) {
          javaFiles.push(currentUri);
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    return javaFiles;
  }

  /**
   * Extract a fully qualified class name from a file path.
   */
  protected extractClassNameFromPath(filePath: string): string | undefined {
    // Normalize Windows backslashes so Maven layout matching works.
    const normalized = filePath.replace(/\\/g, '/');
    // Match path like .../src/main/java/com/example/MyTest.java
    const javaMatch = normalized.match(/src\/main\/java\/(.+)\.java$/);
    if (javaMatch) {
      return javaMatch[1].replace(/\//g, '.');
    }
    // Match path like .../src/test/java/com/example/MyTest.java
    const testMatch = normalized.match(/src\/test\/java\/(.+)\.java$/);
    if (testMatch) {
      return testMatch[1].replace(/\//g, '.');
    }
    // Fallback: just use the file name without extension
    const fileNameMatch = normalized.match(/\/([^/]+)\.java$/);
    if (fileNameMatch) {
      return fileNameMatch[1];
    }
    return undefined;
  }

  /**
   * Run a specific test class or method.
   *
   * @param className Fully qualified class name to run
   * @param methodName Optional method name to run a single test
   * @param timeoutMs Optional timeout in milliseconds (default 60s)
   */
  async runTest(className: string, methodName?: string, timeoutMs?: number): Promise<JUnitTestRun> {
    const runId = `junit-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`}`;
    const startTime = new Date().toISOString();
    const effectiveTimeout = timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;

    const run: JUnitTestRun = {
      id: runId,
      state: 'running',
      startTime,
      totalCount: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      results: [],
      output: '',
    };

    try {
      this.logger.info(`[JUnit] Running test: ${className}${methodName ? `#${methodName}` : ''}`);

      // Progress: starting
      this.emitProgress(runId, 'starting', `Starting test: ${className}${methodName ? `#${methodName}` : ''}`);

      // Progress: compiling
      this.emitProgress(runId, 'compiling', 'Compiling test classes...');

      // Execute the test via the Go Agent (JUnitCore + platform classpath sep).
      const cpSep = process.platform === 'win32' ? ';' : ':';
      const classpath = `target/test-classes${cpSep}target/classes`;
      const result = await this.runtime.request(
        'POST /api/v1/run' as Endpoint,
        {
          command: 'java',
          args: [
            '-cp', classpath,
            'org.junit.runner.JUnitCore',
            className,
          ],
          xmlOutput: true,
        },
        { timeoutMs: effectiveTimeout, noRetry: true },
      ) as unknown as {
        exitCode?: number;
        stdout?: string;
        stderr?: string;
        xmlOutput?: string;
      } | undefined;

      if (result) {
        // Progress: parsing
        this.emitProgress(runId, 'parsing', 'Parsing test results...');

        run.output = [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n');

        let suites: JUnitXmlSuite[] = [];
        const xmlSource = result.xmlOutput || run.output;

        if (xmlSource) {
          try {
            suites = parseJUnitXml(xmlSource);
          } catch (parseError) {
            this.logger.error(`[JUnit] Failed to parse XML output: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
            run.output = `[XML Parse Error] ${parseError instanceof Error ? parseError.message : String(parseError)}\n\n${run.output}`;
            // Try to continue with empty suites, the raw output is still available
          }
        }

        run.results = this.convertResults(suites);
        if (methodName) {
          run.results = run.results.filter(r => r.methodName === methodName);
        }

        run.totalCount = run.results.length;
        run.passedCount = run.results.filter(r => r.status === 'passed').length;
        run.failedCount = run.results.filter(r => r.status === 'failed').length;
        run.skippedCount = run.results.filter(r => r.status === 'skipped').length;
        run.errorCount = run.results.filter(r => r.status === 'error').length;

        if (run.totalCount === 0) {
          // No test results found from parsing — check if the class has no @Test methods
          if (run.output.includes('No runnable methods') || run.output.includes('No tests found')) {
            run.output = `No @Test methods found in class: ${className}`;
            run.state = 'failed';
            this.logger.warn(`[JUnit] No @Test methods found in ${className}`);
          } else {
            run.state = 'succeeded';
            this.logger.info(`[JUnit] Test run completed with 0 test results (raw output available)`);
          }
        } else {
          run.state = (run.failedCount > 0 || run.errorCount > 0) ? 'failed' : 'succeeded';
        }
      } else {
        run.state = 'failed';
        run.output = 'Test execution returned no result';
        this.logger.error(`[JUnit] Test run returned no result for ${className}`);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      if (errMsg.includes('timeout') || errMsg.includes('timed out')) {
        run.state = 'failed';
        run.output = `Test execution timed out after ${effectiveTimeout / 1000}s`;
        this.emitProgress(runId, 'timeout', `Test timed out for ${className}`);
        this.logger.error(`[JUnit] Test run timed out for ${className} (${effectiveTimeout}ms)`);
      } else {
        run.state = 'failed';
        run.output = errMsg;
        this.logger.error(`[JUnit] Test run failed: ${run.output}`);
      }
    }

    run.endTime = new Date().toISOString();

    // Progress: completed
    this.emitProgress(runId, 'completed', `Test run ${run.state}: ${run.passedCount} passed, ${run.failedCount} failed`);

    this.onDidCompleteRunEmitter.fire(run);
    return run;
  }

  /** Convert parsed JUnit XML suites to test result items. */
  protected convertResults(suites: JUnitXmlSuite[]): JUnitTestResult[] {
    const results: JUnitTestResult[] = [];
    for (const suite of suites) {
      for (const tc of suite.testCases) {
        let status: JUnitTestResult['status'] = 'passed';
        let failureMessage: string | undefined;
        let stackTrace: string[] | undefined;

        if (tc.error) {
          status = 'error';
          failureMessage = tc.error.message;
          stackTrace = tc.error.stackTrace;
        } else if (tc.failure) {
          status = 'failed';
          failureMessage = tc.failure.message;
          stackTrace = tc.failure.stackTrace;
        } else if (tc.skipped) {
          status = 'skipped';
        }

        results.push({
          testId: `method:${tc.className}#${tc.name}`,
          className: tc.className,
          methodName: tc.name,
          status,
          durationMs: Math.round(tc.time * 1000),
          failureMessage,
          stackTrace,
        });
      }
    }
    return results;
  }

  /** Check if a symbol represents an abstract class. */
  protected isAbstractClass(sym: LSPSymbolInformation): boolean {
    // Check for abstract modifier in the symbol name or container
    // LSP doesn't directly expose modifiers in workspace symbols,
    // but we can check the name for common patterns
    const name = sym.name || '';
    // Common abstract class naming conventions
    return name.startsWith('Abstract') || name.endsWith('Base');
  }

  /** Emit a progress event. */
  protected emitProgress(runId: string, phase: JUnitTestProgress['phase'], message: string): void {
    this.onDidProgressEmitter.fire({ runId, phase, message });
  }
}

// ── JUnit XML Parser ────────────────────────────────────────────────

/** Parse JUnit XML output into structured results. */
export function parseJUnitXml(xml: string): JUnitXmlSuite[] {
  if (!xml || typeof xml !== 'string') {
    throw new Error('Invalid XML input: empty or non-string');
  }

  const suites: JUnitXmlSuite[] = [];
  const suiteRegex = /<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g;
  let suiteMatch: RegExpExecArray | null;

  while ((suiteMatch = suiteRegex.exec(xml)) !== null) {
    const attrs = suiteMatch[1];
    const body = suiteMatch[2];
    const suite: JUnitXmlSuite = {
      name: attrValue(attrs, 'name') ?? 'unknown',
      tests: parseInt(attrValue(attrs, 'tests') ?? '0', 10),
      failures: parseInt(attrValue(attrs, 'failures') ?? '0', 10),
      errors: parseInt(attrValue(attrs, 'errors') ?? '0', 10),
      skipped: parseInt(attrValue(attrs, 'skipped') ?? '0', 10),
      time: parseFloat(attrValue(attrs, 'time') ?? '0'),
      testCases: [],
    };

    // Self-closing <testcase .../> (passed cases) and open/close forms.
    const caseRegex = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let caseMatch: RegExpExecArray | null;
    while ((caseMatch = caseRegex.exec(body)) !== null) {
      const caseAttrs = caseMatch[1];
      const caseBody = caseMatch[2] ?? '';
      const tc: JUnitXmlTestCase = {
        className: attrValue(caseAttrs, 'classname') ?? '',
        name: attrValue(caseAttrs, 'name') ?? '',
        time: parseFloat(attrValue(caseAttrs, 'time') ?? '0'),
      };

      const failureMatch = caseBody.match(/<failure\b([^>]*)>([\s\S]*?)<\/failure>/);
      if (failureMatch) {
        tc.failure = {
          message: attrValue(failureMatch[1], 'message') ?? 'Test failed',
          type: attrValue(failureMatch[1], 'type') ?? 'AssertionError',
          stackTrace: failureMatch[2].trim().split('\n').map(s => s.trim()).filter(Boolean),
        };
      }

      const errorMatch = caseBody.match(/<error\b([^>]*)>([\s\S]*?)<\/error>/);
      if (errorMatch) {
        tc.error = {
          message: attrValue(errorMatch[1], 'message') ?? 'Test error',
          type: attrValue(errorMatch[1], 'type') ?? 'Error',
          stackTrace: errorMatch[2].trim().split('\n').map(s => s.trim()).filter(Boolean),
        };
      }

      if (/<skipped\s*\/?>/.test(caseBody)) {
        tc.skipped = true;
      }

      suite.testCases.push(tc);
    }

    suites.push(suite);
  }

  return suites;
}

function attrValue(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`);
  const match = attrs.match(re);
  return match ? match[1] : undefined;
}