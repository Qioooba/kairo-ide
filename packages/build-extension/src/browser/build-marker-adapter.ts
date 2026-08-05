import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { BuildStore, type BuildDiagnostic } from './build-store';

/**
 * Map build diagnostic severity string to monaco.MarkerSeverity.
 * Monaco severities: Error=8, Warning=4, Info=2, Hint=1.
 */
export function toMarkerSeverity(severity: BuildDiagnostic['severity']): monaco.MarkerSeverity {
    switch (severity) {
        case 'error': return monaco.MarkerSeverity.Error;
        case 'warning': return monaco.MarkerSeverity.Warning;
        case 'info': return monaco.MarkerSeverity.Info;
        default: return monaco.MarkerSeverity.Error;
    }
}

/**
 * Convert a BuildDiagnostic to a monaco.editor.IMarkerData.
 * The line and column from the build diagnostic are expected to be 1-based.
 */
export function diagnosticToMarker(d: BuildDiagnostic): monaco.editor.IMarkerData {
    const endLine = d.endLine ?? d.line;
    const endColumn = d.endColumn ?? (d.column >= 1 ? d.column + 1 : 2);
    return {
        severity: toMarkerSeverity(d.severity),
        message: d.message,
        source: 'Kairo Build',
        code: d.code,
        startLineNumber: d.line >= 1 ? d.line : 1,
        startColumn: d.column >= 1 ? d.column : 1,
        endLineNumber: endLine >= 1 ? endLine : 1,
        endColumn: endColumn >= 1 ? endColumn : 2,
    };
}

/**
 * Find a Monaco text model whose URI path ends with the given file path suffix.
 * Returns undefined if no matching model is found.
 */
function findModelByFilePath(filePath: string): monaco.editor.ITextModel | undefined {
    const models = monaco.editor.getModels();
    // Normalize the search path: strip leading file:// and trim
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
 * BuildMarkerAdapter converts build diagnostics to Monaco editor markers
 * and registers them via monaco.editor.setModelMarkers. Markers automatically
 * appear in the Problems panel and support click-to-navigate to source location.
 *
 * It subscribes to the BuildStore and automatically sets markers whenever
 * a build completes with diagnostics.
 *
 * Bound as FrontendApplicationContribution so DI instantiates it at startup
 * (BD-P1-18) — binding alone does not construct the singleton.
 */
@injectable()
export class BuildMarkerAdapter implements FrontendApplicationContribution {
    @inject(BuildStore)
    private readonly buildStore!: BuildStore;

    private readonly owner = 'kairo-build';

    @postConstruct()
    protected init(): void {
        this.buildStore.onDidChange(builds => {
            const latest = builds[builds.length - 1];
            if (latest && latest.diagnostics && latest.diagnostics.length > 0) {
                this.setDiagnostics(latest.diagnostics);
            } else if (latest && (!latest.diagnostics || latest.diagnostics.length === 0)) {
                this.clearAll();
            }
        });
    }

    onStart(): void {
        // Subscription happens in @postConstruct; nothing else required.
    }

    /**
     * Set build diagnostics as markers on the relevant Monaco editor models.
     * Existing markers from previous builds are cleared first.
     */
    setDiagnostics(diagnostics: BuildDiagnostic[]): void {
        // Group diagnostics by file path
        const byFile = new Map<string, BuildDiagnostic[]>();
        for (const d of diagnostics) {
            const existing = byFile.get(d.file) ?? [];
            existing.push(d);
            byFile.set(d.file, existing);
        }

        // Track which models received markers from this build
        const updatedModels = new Set<monaco.editor.ITextModel>();

        for (const [filePath, diags] of byFile) {
            const model = findModelByFilePath(filePath);
            if (model) {
                const markers = diags.map(diagnosticToMarker);
                monaco.editor.setModelMarkers(model, this.owner, markers);
                updatedModels.add(model);
            }
        }

        // Clear markers from any model that previously had build markers
        // but is no longer in the current diagnostic set
        const allModels = monaco.editor.getModels();
        for (const model of allModels) {
            if (!updatedModels.has(model)) {
                monaco.editor.setModelMarkers(model, this.owner, []);
            }
        }
    }

    /**
     * Clear all build markers from all Monaco models.
     */
    clearAll(): void {
        const models = monaco.editor.getModels();
        for (const model of models) {
            monaco.editor.setModelMarkers(model, this.owner, []);
        }
    }
}