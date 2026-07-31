import { injectable, inject } from '@theia/core/shared/inversify';
import { TestStore, TestRun, TestMethodResult, TestItem, TestStatus } from './test-store';

/**
 * JUnit XML output parser.
 *
 * Parses the standard JUnit XML report format:
 * ```xml
 * <testsuite name="..." tests="10" failures="2" errors="1" skipped="1" time="0.5">
 *   <testcase classname="com.example.MyTest" name="testFoo" time="0.1">
 *     <failure message="expected:<true> but was:<false>" type="junit.framework.AssertionFailedError">
 *       at com.example.MyTest.testFoo(MyTest.java:25)
 *     </failure>
 *   </testcase>
 *   <testcase classname="com.example.MyTest" name="testBar" time="0.05">
 *     <skipped/>
 *   </testcase>
 * </testsuite>
 * ```
 */
export interface JUnitXmlSuite {
    name: string;
    tests: number;
    failures: number;
    errors: number;
    skipped: number;
    time: number;
    testCases: JUnitXmlTestCase[];
}

export interface JUnitXmlTestCase {
    className: string;
    name: string;
    time: number;
    failure?: {
        message: string;
        type: string;
        stackTrace: string[];
    };
    error?: {
        message: string;
        type: string;
        stackTrace: string[];
    };
    skipped?: boolean;
}

/**
 * Parse JUnit XML output into structured results.
 */
export function parseJUnitXml(xml: string): JUnitXmlSuite[] {
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

        const caseRegex = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g;
        let caseMatch: RegExpExecArray | null;
        while ((caseMatch = caseRegex.exec(body)) !== null) {
            const caseAttrs = caseMatch[1];
            const caseBody = caseMatch[2];
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

/**
 * Extract a stack trace location (file:line) from a stack trace line.
 * Matches patterns like:
 *   at com.example.MyTest.testFoo(MyTest.java:25)
 *   at com.example.MyTest.testFoo(Unknown Source)
 */
export function parseFailureLocation(stackTrace: string[]): { file: string; line: number } | undefined {
    for (const line of stackTrace) {
        // Match: at package.Class.method(File.java:123)
        const match = line.match(/at\s+[\w.]+\s*\((\w+\.java):(\d+)\)/);
        if (match) {
            return { file: match[1], line: parseInt(match[2], 10) };
        }
        // Also match: package.Class.method(File.java:123)
        const match2 = line.match(/\((\w+\.java):(\d+)\)/);
        if (match2) {
            return { file: match2[1], line: parseInt(match2[2], 10) };
        }
    }
    return undefined;
}

function attrValue(attrs: string, name: string): string | undefined {
    const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);
    const match = attrs.match(re);
    return match ? match[1] : undefined;
}

/**
 * Test runner service.
 *
 * Orchestrates test execution:
 * 1. Compiles test classes with javac
 * 2. Runs tests with java + JUnit runner
 * 3. Parses JUnit XML output
 * 4. Updates TestStore with results
 */
@injectable()
export class TestRunner {
    @inject(TestStore)
    private readonly store!: TestStore;

    /**
     * Build the javac compilation command for test classes.
     *
     * @param classpath Colon-separated classpath entries
     * @param sourceFiles List of .java source file paths
     * @param outputDir Output directory for .class files
     * @param sourceLevel Java source level (e.g., "1.6")
     */
    buildJavacCommand(
        classpath: string[],
        sourceFiles: string[],
        outputDir: string,
        sourceLevel: string = '1.6',
    ): string[] {
        const args: string[] = ['javac'];
        args.push('-source', sourceLevel);
        args.push('-target', sourceLevel);
        args.push('-d', outputDir);
        if (classpath.length > 0) {
            args.push('-cp', classpath.join(typeof process !== 'undefined' && process.platform === 'win32' ? ';' : ':'));
        }
        args.push(...sourceFiles);
        return args;
    }

    /**
     * Build the java command to run JUnit tests.
     *
     * For JUnit 4:
     *   java -cp classpath org.junit.runner.JUnitCore com.example.MyTest
     *
     * For JUnit 3:
     *   java -cp classpath junit.textui.TestRunner com.example.MyTest
     *
     * The XML output is typically captured via a custom runner
     * or by piping to an XML formatter.
     */
    buildJavaRunCommand(
        classpath: string[],
        testClass: string,
        framework: 'junit3' | 'junit4',
        _xmlOutputFile?: string,
    ): string[] {
        const fullCp = [...classpath];
        if (framework === 'junit4') {
            // JUnit 4 runner
            fullCp.push('junit-4.jar', 'hamcrest-core.jar');
        } else {
            // JUnit 3 runner
            fullCp.push('junit.jar');
        }

        const args: string[] = ['java'];
        args.push('-cp', fullCp.join(typeof process !== 'undefined' && process.platform === 'win32' ? ';' : ':'));
        if (framework === 'junit4') {
            args.push('org.junit.runner.JUnitCore');
        } else {
            args.push('junit.textui.TestRunner');
        }
        args.push(testClass);

        return args;
    }

    /**
     * Convert parsed JUnit XML results to TestMethodResult objects.
     */
    convertResults(suites: JUnitXmlSuite[]): TestMethodResult[] {
        const results: TestMethodResult[] = [];
        for (const suite of suites) {
            for (const tc of suite.testCases) {
                const testId = `method:${tc.className}#${tc.name}`;
                let status: TestStatus = 'passed';
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
                    testId,
                    status,
                    durationMs: Math.round(tc.time * 1000),
                    failureMessage,
                    stackTrace,
                });
            }
        }
        return results;
    }

    /**
     * Create a TestRun from compiled and executed results.
     */
    createTestRun(
        id: string,
        workspaceId: string,
        projectId: string,
        scope: TestRun['scope'],
        target: string,
        results: TestMethodResult[],
        output: string,
        startTime: string,
        endTime: string,
    ): TestRun {
        const passed = results.filter(r => r.status === 'passed').length;
        const failed = results.filter(r => r.status === 'failed').length;
        const skipped = results.filter(r => r.status === 'skipped').length;
        const errors = results.filter(r => r.status === 'error').length;
        const hasFailures = failed > 0 || errors > 0;

        return {
            id,
            workspaceId,
            projectId,
            scope,
            target,
            state: hasFailures ? 'failed' : 'succeeded',
            startTime,
            endTime,
            totalCount: results.length,
            passedCount: passed,
            failedCount: failed,
            skippedCount: skipped,
            errorCount: errors,
            results,
            output,
        };
    }

    /**
     * Process test execution results and update the TestStore.
     *
     * @param runId Unique run identifier
     * @param xmlOutput JUnit XML output from test execution
     * @param rawOutput Raw stdout/stderr from the test process
     * @param workspaceId Current workspace ID
     * @param projectId Current project ID
     * @param scope Scope of the test run
     * @param target Target of the test run
     * @param startTime ISO timestamp of run start
     * @param endTime ISO timestamp of run end
     */
    processResults(
        runId: string,
        xmlOutput: string,
        rawOutput: string,
        workspaceId: string,
        projectId: string,
        scope: TestRun['scope'],
        target: string,
        startTime: string,
        endTime: string,
    ): TestRun {
        const suites = parseJUnitXml(xmlOutput);
        const results = this.convertResults(suites);
        const run = this.createTestRun(
            runId,
            workspaceId,
            projectId,
            scope,
            target,
            results,
            rawOutput,
            startTime,
            endTime,
        );

        // Update individual test item statuses in the store
        const updatedItems: TestItem[] = [];
        for (const result of results) {
            const existing = this.store.getItem(result.testId);
            if (existing) {
                updatedItems.push({
                    ...existing,
                    status: result.status,
                    durationMs: result.durationMs,
                    failureMessage: result.failureMessage,
                });
            }
        }

        if (updatedItems.length > 0) {
            this.store.updateItems(updatedItems);
        }

        this.store.addRun(run);
        return run;
    }
}