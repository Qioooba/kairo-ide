import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { TestStore, TestMethodResult } from './test-store';
import { parseFailureLocation } from './test-runner';

/**
 * Convert a test status to Monaco MarkerSeverity.
 */
export function toMarkerSeverity(status: TestMethodResult['status']): monaco.MarkerSeverity {
    switch (status) {
        case 'failed':
        case 'error':
            return monaco.MarkerSeverity.Error;
        default:
            return monaco.MarkerSeverity.Info;
    }
}

/**
 * Convert a TestMethodResult to a monaco.editor.IMarkerData.
 */
export function testResultToMarker(result: TestMethodResult): monaco.editor.IMarkerData | undefined {
    if (!result.failureMessage) return undefined;

    // Extract file and line from stack trace
    let startLine = 1;
    const startColumn = 1;
    let _fileRef = '';

    if (result.stackTrace && result.stackTrace.length > 0) {
        const location = parseFailureLocation(result.stackTrace);
        if (location) {
            startLine = location.line;
            _fileRef = location.file;
        }
    }

    return {
        severity: toMarkerSeverity(result.status),
        message: result.failureMessage,
        source: 'Kairo Test',
        startLineNumber: startLine >= 1 ? startLine : 1,
        startColumn,
        endLineNumber: startLine >= 1 ? startLine : 1,
        endColumn: startColumn + 1,
    };
}

/**
 * Find a Monaco text model by file path suffix.
 */
function findModelByFilePath(filePath: string): monaco.editor.ITextModel | undefined {
    const models = monaco.editor.getModels();
    const normalized = filePath.replace(/^file:\/\//, '').replace(/\\/g, '/');
    for (const model of models) {
        const modelPath = model.uri.path.replace(/\\/g, '/');
        if (modelPath.endsWith(normalized) || normalized.endsWith(modelPath)) {
            return model;
        }
    }
    return undefined;
}

/**
 * TestMarkerAdapter converts failed test results to Monaco editor markers.
 *
 * When a test run completes with failures, this adapter:
 * 1. Parses stack traces to find source locations
 * 2. Creates Monaco markers at the assertion/failure locations
 * 3. Clicking a marker navigates to the source location
 * 4. Shows the stack trace and error message in the marker tooltip
 */
@injectable()
export class TestMarkerAdapter {
    @inject(TestStore)
    private readonly store!: TestStore;

    private readonly owner = 'kairo-test';

    @postConstruct()
    protected init(): void {
        this.store.onDidChangeRuns(runs => {
            const latest = runs[runs.length - 1];
            if (latest && latest.results && latest.results.length > 0) {
                const failed = latest.results.filter(r => r.status === 'failed' || r.status === 'error');
                if (failed.length > 0) {
                    this.setMarkers(failed);
                } else {
                    this.clearAll();
                }
            }
        });
    }

    /**
     * Set markers for failed test results.
     */
    setMarkers(failedResults: TestMethodResult[]): void {
        // Group markers by file
        const byFile = new Map<string, monaco.editor.IMarkerData[]>();

        for (const result of failedResults) {
            if (!result.stackTrace || result.stackTrace.length === 0) continue;
            const location = parseFailureLocation(result.stackTrace);
            if (!location) continue;

            // Find the test item to get the full file path
            const testItem = this.store.getItem(result.testId);
            const filePath = testItem?.filePath ?? location.file;

            const marker = testResultToMarker(result);
            if (!marker) continue;

            const existing = byFile.get(filePath) ?? [];
            existing.push(marker);
            byFile.set(filePath, existing);
        }

        // Apply markers to Monaco models
        const updatedModels = new Set<monaco.editor.ITextModel>();
        for (const [filePath, markers] of byFile) {
            const model = findModelByFilePath(filePath);
            if (model) {
                monaco.editor.setModelMarkers(model, this.owner, markers);
                updatedModels.add(model);
            }
        }

        // Clear markers from models not in the current failure set
        const allModels = monaco.editor.getModels();
        for (const model of allModels) {
            if (!updatedModels.has(model)) {
                monaco.editor.setModelMarkers(model, this.owner, []);
            }
        }
    }

    /**
     * Clear all test failure markers from all Monaco models.
     */
    clearAll(): void {
        const models = monaco.editor.getModels();
        for (const model of models) {
            monaco.editor.setModelMarkers(model, this.owner, []);
        }
    }
}