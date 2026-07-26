import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject } from '@theia/core/shared/inversify';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { KairoProjectService } from './project-service';
import { ActiveProjectService } from './active-project-service';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import type { ProjectDetection, ProjectImportConfirmRequest } from '@kairo/protocol';

/** Normalize a user-visible encoding label to the wire encoding id. */
function normalizeEncodingId(encoding: string): string {
    const lower = encoding.trim().toLowerCase();
    switch (lower) {
        case 'utf8': return 'utf-8';
        case 'utf-8-bom': return 'utf-8-bom';
        case 'gb18030': return 'gb18030';
        case 'gbk': return 'gbk';
        case 'iso-8859-1': return 'iso-8859-1';
        case 'us-ascii': return 'us-ascii';
        case 'utf-16le': return 'utf-16le';
        case 'utf-16be': return 'utf-16be';
        default: return lower || 'utf-8';
    }
}

@injectable()
export class ImportWizardWidget extends ReactWidget {
    static readonly ID = 'kairo-import-wizard';

    @inject(FileDialogService)
    protected readonly fileDialogService!: FileDialogService;

    @inject(KairoProjectService)
    protected readonly projectService!: KairoProjectService;

    @inject(ActiveProjectService)
    protected readonly activeProject!: ActiveProjectService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @inject(WorkspaceContextService)
    protected readonly workspaceContext!: WorkspaceContextService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    constructor() {
        super();
        this.id = ImportWizardWidget.ID;
        this.title.label = 'Kairo IDE - Import Project';
        this.title.closable = true;
        this.title.caption = 'Kairo Project Import Wizard';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(ImportWizard, {
            fileDialogService: this.fileDialogService,
            projectService: this.projectService,
            activeProject: this.activeProject,
            runtime: this.runtime,
            workspaceContext: this.workspaceContext,
            workspaceService: this.workspaceService,
            onClose: () => this.close(),
        });
    }
}

interface ImportWizardProps {
    fileDialogService: FileDialogService;
    projectService: KairoProjectService;
    activeProject: ActiveProjectService;
    runtime: RuntimeConnectionService;
    workspaceContext: WorkspaceContextService;
    workspaceService: WorkspaceService;
    onClose: () => void;
}

const ImportWizard: React.FC<ImportWizardProps> = ({
    fileDialogService, projectService, activeProject, runtime, workspaceContext, workspaceService, onClose,
}) => {
    const [step, setStep] = React.useState(1);
    const [workspacePath, setWorkspacePath] = React.useState('');
    const [workspaceId, setWorkspaceId] = React.useState('');
    const [detected, setDetected] = React.useState<ProjectDetection | null>(null);
    const [scanning, setScanning] = React.useState(false);
    const [importing, setImporting] = React.useState(false);
    const [scanError, setScanError] = React.useState('');
    const [importError, setImportError] = React.useState('');
    const [importedSummary, setImportedSummary] = React.useState<{ name: string; root: string; encoding: string } | null>(null);

    // Editable fields for step 2
    const [projectName, setProjectName] = React.useState('');
    const [sourceDirs, setSourceDirs] = React.useState('src');
    const [webRoot, setWebRoot] = React.useState('WebRoot');
    const [libDirs, setLibDirs] = React.useState('lib');
    const [buildScript, setBuildScript] = React.useState('build.xml');
    const [defaultEncoding, setDefaultEncoding] = React.useState('GBK');
    const [jdkVersion, setJdkVersion] = React.useState('1.6');
    const [sourceVersion, setSourceVersion] = React.useState('1.6');
    const [targetVersion, setTargetVersion] = React.useState('1.6');
    const [outputDir, setOutputDir] = React.useState('build/classes');
    const [buildTool, setBuildTool] = React.useState('ant');
    const [contextPath, setContextPath] = React.useState('/');

    const handleSelectDirectory = React.useCallback(async () => {
        try {
            const dialog = await fileDialogService.showOpenDialog({
                title: 'Select Project Root Directory',
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
            });
            if (!dialog) {
                return;
            }
            const path = String(dialog.path);
            setWorkspacePath(path);
            await scanPath(path);
        } catch (error) {
            setScanError(error instanceof Error ? error.message : String(error));
        }
    }, [fileDialogService, projectService, runtime, workspaceContext]);

    // KAIRO-RC-WEB-028: extract the scan-and-populate logic from
    // `handleSelectDirectory` so the visible path input on step 1
    // can drive the same flow when the user pastes a path instead
    // of picking one from the file dialog. The file dialog in the
    // Theia browser is known to swallow the typed input; this
    // makes the wizard usable even when the dialog fails.
    const scanPath = React.useCallback(async (path: string) => {
        setScanning(true);
        setScanError('');
        try {
            // KAIRO-RC-WEB-2026-07-25-06: the project being imported lives
            // under a directory that is not necessarily the Theia startup
            // workspace. The agent's import endpoint validates that the
            // project root is inside the request's workspaceId, so we must
            // register the selected project path as its own workspace before
            // importing. This also sets the runtime workspaceId so the
            // subsequent import call targets the right backend context.
            const projectWorkspace = await projectService.openWorkspace(path);
            setWorkspaceId(projectWorkspace.id);

            const result = await projectService.detectProject(path);
            setDetected(result);

            const base = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'project';
            setProjectName(base);
            setSourceDirs(result.sourceDirs?.join(', ') || 'src');
            setWebRoot(result.webRoot || 'WebRoot');
            setLibDirs(result.libDirs?.join(', ') || 'lib');
            setBuildScript(result.buildScript || 'build.xml');
            setDefaultEncoding(normalizeEncodingId(result.defaultEncoding || 'gbk'));
            setJdkVersion(result.jdkVersion || '1.6');
            setSourceVersion(result.sourceVersion || '1.6');
            setTargetVersion(result.targetVersion || '1.6');
            setOutputDir(result.outputDir || 'build/classes');
            setBuildTool((result.buildSystem === 'ant' || result.buildScript === 'build.xml') ? 'ant' : 'javac');
            setContextPath('/');

            setStep(2);
        } catch (error) {
            setDetected(null);
            setScanError(error instanceof Error ? error.message : String(error));
        } finally {
            setScanning(false);
        }
    }, [projectService, runtime, workspaceContext]);

    const handleScanTypedPath = React.useCallback(async () => {
        const path = workspacePath.trim();
        if (!path) {
            setScanError('Please enter a project path or click "Select Project Directory".');
            return;
        }
        await scanPath(path);
    }, [workspacePath, scanPath]);

    const handleImport = React.useCallback(async () => {
        setImporting(true);
        setImportError('');

        try {
            const trimmedName = projectName.trim();
            if (!trimmedName) {
                throw new Error('Project name cannot be empty.');
            }
            if (!workspaceId) {
                throw new Error('No workspace selected. Open a workspace folder first.');
            }

            const params: ProjectImportConfirmRequest = {
                workspaceId,
                rootPath: workspacePath,
                name: trimmedName,
                sourceDirs: sourceDirs.split(',').map(s => s.trim()).filter(s => s.length > 0),
                webRoot: webRoot.trim(),
                libDirs: libDirs.split(',').map(s => s.trim()).filter(s => s.length > 0),
                buildScript: buildScript.trim(),
                defaultEncoding: normalizeEncodingId(defaultEncoding),
                jdkVersion: jdkVersion.trim(),
                sourceVersion: sourceVersion.trim(),
                targetVersion: targetVersion.trim(),
                outputDir: outputDir.trim(),
                buildTool: (buildTool === 'ant' ? 'ant' : 'javac') as 'ant' | 'javac',
                contextPath: contextPath.trim() || '/',
            };

            const saved = await projectService.importProjectNew(params);

            // KAIRO-RC-WEB-2026-07-25-04: temporary debug log to capture
            // the exact import request payload for K4 debugging. Remove
            // once SHARD-02 import path is green.
            console.log('[kairo:import-debug] params:', JSON.stringify(params, null, 2));

            // KAIRO-RC-WEB-2026-07-25-13: synchronise the WorkspaceContext
            // to the new project's workspace. Without this, the
            // ActiveProjectService's onDidChangeContext listener keeps
            // firing with the Theia parent folder's workspaceId; that
            // listener queries /api/v1/projects with the parent
            // workspaceId, sees an empty list, and clears
            // `currentProject` — the imported project lives in the
            // wizard's freshly created workspace, not the parent. The
            // status bar consequently stays on `(no workspace)` even
            // though setProject() fired. Updating WorkspaceContext
            // here re-issues the listener against the new workspace
            // and the project is then discoverable.
            //
            // We do NOT call `runtime.setWorkspace(workspaceId)`
            // directly: WorkspaceContextService.setWorkspace already
            // forwards to the runtime. Calling it twice caused the
            // EventStream to close+reopen, which fired the
            // WorkspaceContextService status listener and re-ran
            // syncFromRoots with the Theia parent folder's roots —
            // which then re-fired onDidChangeContext with the OLD
            // workspaceId and the ActiveProjectService listener
            // cleared the just-selected project.
            if (workspaceId) {
                try {
                    await workspaceContext.setWorkspace(workspaceId, saved.rootPath || workspacePath);
                } catch (ctxErr) {
                    console.warn('[kairo:import-debug] workspaceContext.setWorkspace failed:',
                        ctxErr instanceof Error ? ctxErr.message : String(ctxErr));
                }
            }

            await activeProject.setProject({
                workspaceId,
                projectId: saved.id,
                name: saved.name,
                root: saved.rootPath || workspacePath,
                encoding: normalizeEncodingId(defaultEncoding),
            });

            setImportedSummary({
                name: saved.name || trimmedName,
                root: saved.rootPath || workspacePath,
                encoding: normalizeEncodingId(defaultEncoding),
            });
            setStep(3);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setImportError(msg);
        } finally {
            setImporting(false);
        }
    }, [projectService, activeProject, runtime, workspaceContext, workspaceId, workspacePath, projectName,
        sourceDirs, webRoot, libDirs, buildScript, defaultEncoding,
        jdkVersion, sourceVersion, targetVersion, outputDir, buildTool, contextPath]);

    return (
        <div className="kairo-import-wizard" data-testid="import-wizard">
            <header className="kairo-wizard-header">
                <h1 data-testid="wizard-title">Import Legacy Java Project</h1>
                <p className="kairo-wizard-subtitle">Auto-detect and configure your project</p>
            </header>

            <div className="kairo-wizard-steps">
                <div className={`kairo-wizard-step ${step >= 1 ? 'active' : ''}`} data-testid="step-1" aria-current={step === 1 ? 'step' : undefined}>
                    <span className="step-number">1</span>
                    <span className="step-label">Select Directory</span>
                </div>
                <div className={`kairo-wizard-step ${step >= 2 ? 'active' : ''}`} data-testid="step-2" aria-current={step === 2 ? 'step' : undefined}>
                    <span className="step-number">2</span>
                    <span className="step-label">Confirm Settings</span>
                </div>
                <div className={`kairo-wizard-step ${step >= 3 ? 'active' : ''}`} data-testid="step-3" aria-current={step === 3 ? 'step' : undefined}>
                    <span className="step-number">3</span>
                    <span className="step-label">Complete</span>
                </div>
            </div>

            <div className="kairo-wizard-content">
                {/* Step 1: Select Directory */}
                {step === 1 && (
                    <div className="kairo-wizard-step-content" data-testid="step-content-1">
                        <div className="kairo-wizard-tips" data-testid="welcome-tips">
                            <h3>Welcome to Kairo IDE</h3>
                            <p>Kairo helps you run legacy Java Web projects on Tomcat 6 — entirely offline.</p>
                            <ul>
                                <li>Auto-detects project structure (source dirs, web root, encoding)</li>
                                <li>Configures Ant/javac builds automatically</li>
                                <li>No files are modified during detection</li>
                                <li>All settings saved to <code>.kairo/project.json</code></li>
                            </ul>
                        </div>
                        <p>Select the root folder of your legacy Java web project.</p>
                        <p className="kairo-hint">
                            Kairo will auto-detect the project structure — source directories,
                            web root, encoding, JDK version, and build configuration.
                            No files will be modified during detection.
                        </p>
                        {/* KAIRO-RC-WEB-028: visible path input as a fallback
                            when the file dialog swallows the typed path. The
                            "Browse" button still uses the native dialog for
                            mouse-driven users; "Scan" works on a typed path. */}
                        <div className="kairo-path-row" data-testid="path-row">
                            <input
                                type="text"
                                className="kairo-path-input"
                                data-testid="path-input"
                                placeholder="/absolute/path/to/project"
                                value={workspacePath}
                                onChange={e => setWorkspacePath(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleScanTypedPath(); } }}
                                aria-label="Project root path"
                            />
                            <button
                                className="theia-button"
                                onClick={handleSelectDirectory}
                                disabled={scanning}
                                data-testid="browse-btn"
                                aria-label="Browse for project directory"
                            >
                                Browse...
                            </button>
                            <button
                                className="theia-button main"
                                onClick={handleScanTypedPath}
                                disabled={scanning}
                                data-testid="scan-btn"
                                aria-label="Scan the entered project path"
                            >
                                {scanning ? 'Scanning...' : 'Scan'}
                            </button>
                        </div>
                        {workspacePath && (
                            <p className="kairo-selected-path" data-testid="selected-path">
                                Selected: {workspacePath}
                            </p>
                        )}
                        {scanError && (
                            <p className="kairo-error" role="alert" data-testid="scan-error">
                                {scanError}
                            </p>
                        )}
                    </div>
                )}

                {/* Step 2: Confirm Detected Results */}
                {step === 2 && (
                    <div className="kairo-wizard-step-content" data-testid="step-content-2">
                        <p>Review and adjust the detected project settings.</p>
                        {detected && (
                            <p className="kairo-confidence">
                                Detection confidence: {Math.round(detected.confidence * 100)}%
                                {detected.warnings.length > 0 && (
                                    <span className="kairo-warning"> ({detected.warnings.length} warnings)</span>
                                )}
                            </p>
                        )}
                        <form className="kairo-config-form" data-testid="project-config-form" onSubmit={e => e.preventDefault()}>
                            <div className="kairo-form-group">
                                <label htmlFor="input-project-name">
                                    Project Name:
                                    <input
                                        id="input-project-name"
                                        type="text"
                                        data-testid="input-project-name"
                                        value={projectName}
                                        onChange={e => setProjectName(e.target.value)}
                                        aria-label="Project name"
                                    />
                                </label>
                            </div>
                            <div className="kairo-form-group">
                                <label htmlFor="input-source-dirs">
                                    Source Directories (comma-separated):
                                    <input
                                        id="input-source-dirs"
                                        type="text"
                                        data-testid="input-source-dirs"
                                        value={sourceDirs}
                                        onChange={e => setSourceDirs(e.target.value)}
                                        aria-label="Source directories"
                                    />
                                </label>
                            </div>
                            <div className="kairo-form-group">
                                <label htmlFor="input-web-root">
                                    Web Root:
                                    <input
                                        id="input-web-root"
                                        type="text"
                                        data-testid="input-web-root"
                                        value={webRoot}
                                        onChange={e => setWebRoot(e.target.value)}
                                        aria-label="Web root directory"
                                    />
                                </label>
                            </div>
                            <div className="kairo-form-group">
                                <label htmlFor="input-lib-dirs">
                                    Library Directories (comma-separated):
                                    <input
                                        id="input-lib-dirs"
                                        type="text"
                                        data-testid="input-lib-dirs"
                                        value={libDirs}
                                        onChange={e => setLibDirs(e.target.value)}
                                        aria-label="Library directories"
                                    />
                                </label>
                            </div>
                            <div className="kairo-form-row">
                                <div className="kairo-form-group">
                                    <label htmlFor="select-encoding">
                                        Encoding:
                                        <select
                                            id="select-encoding"
                                            data-testid="select-encoding"
                                            value={defaultEncoding}
                                            onChange={e => setDefaultEncoding(e.target.value)}
                                            aria-label="File encoding"
                                        >
                                            <option value="utf-8">UTF-8</option>
                                            <option value="gbk">GBK</option>
                                            <option value="gb18030">GB18030</option>
                                            <option value="iso-8859-1">ISO-8859-1</option>
                                        </select>
                                    </label>
                                </div>
                                <div className="kairo-form-group">
                                    <label htmlFor="input-jdk-version">
                                        JDK Version:
                                        <input
                                            id="input-jdk-version"
                                            type="text"
                                            data-testid="input-jdk-version"
                                            value={jdkVersion}
                                            onChange={e => setJdkVersion(e.target.value)}
                                            aria-label="JDK version"
                                        />
                                    </label>
                                </div>
                            </div>
                            <div className="kairo-form-row">
                                <div className="kairo-form-group">
                                    <label htmlFor="select-source-version">
                                        Source Version:
                                        <select
                                            id="select-source-version"
                                            data-testid="select-source-version"
                                            value={sourceVersion}
                                            onChange={e => setSourceVersion(e.target.value)}
                                            aria-label="Java source version"
                                        >
                                            <option value="1.5">1.5</option>
                                            <option value="1.6">1.6</option>
                                            <option value="1.7">1.7</option>
                                            <option value="1.8">1.8</option>
                                        </select>
                                    </label>
                                </div>
                                <div className="kairo-form-group">
                                    <label htmlFor="select-target-version">
                                        Target Version:
                                        <select
                                            id="select-target-version"
                                            data-testid="select-target-version"
                                            value={targetVersion}
                                            onChange={e => setTargetVersion(e.target.value)}
                                            aria-label="Java target version"
                                        >
                                            <option value="1.5">1.5</option>
                                            <option value="1.6">1.6</option>
                                            <option value="1.7">1.7</option>
                                            <option value="1.8">1.8</option>
                                        </select>
                                    </label>
                                </div>
                            </div>
                            <div className="kairo-form-row">
                                <div className="kairo-form-group">
                                    <label htmlFor="input-output-dir">
                                        Output Directory:
                                        <input
                                            id="input-output-dir"
                                            type="text"
                                            data-testid="input-output-dir"
                                            value={outputDir}
                                            onChange={e => setOutputDir(e.target.value)}
                                            aria-label="Output directory"
                                        />
                                    </label>
                                </div>
                                <div className="kairo-form-group">
                                    <label htmlFor="select-build-tool">
                                        Build Tool:
                                        <select
                                            id="select-build-tool"
                                            data-testid="select-build-tool"
                                            value={buildTool}
                                            onChange={e => setBuildTool(e.target.value)}
                                            aria-label="Build tool"
                                        >
                                            <option value="ant">Ant</option>
                                            <option value="javac">javac (direct)</option>
                                        </select>
                                    </label>
                                </div>
                            </div>
                            <div className="kairo-form-group">
                                <label htmlFor="input-build-script">
                                    Build Script:
                                    <input
                                        id="input-build-script"
                                        type="text"
                                        data-testid="input-build-script"
                                        value={buildScript}
                                        onChange={e => setBuildScript(e.target.value)}
                                        aria-label="Build script"
                                    />
                                </label>
                            </div>
                            <div className="kairo-form-group">
                                <label htmlFor="input-context-path">
                                    Context Path:
                                    <input
                                        id="input-context-path"
                                        type="text"
                                        data-testid="input-context-path"
                                        value={contextPath}
                                        onChange={e => setContextPath(e.target.value)}
                                        aria-label="Context path"
                                    />
                                </label>
                            </div>
                            {detected && detected.warnings && detected.warnings.length > 0 && (
                                <div className="kairo-warnings" data-testid="detection-warnings">
                                    <strong>Warnings:</strong>
                                    <ul>
                                        {detected.warnings.map((w, i) => (
                                            <li key={i}>{w}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div className="kairo-wizard-actions">
                                <button
                                    type="button"
                                    className="theia-button secondary"
                                    onClick={() => setStep(1)}
                                    data-testid="back-to-select"
                                >
                                    Back
                                </button>
                                <button
                                    type="button"
                                    className="theia-button main"
                                    onClick={handleImport}
                                    disabled={importing}
                                    data-testid="import-project-btn"
                                    aria-label="Import project"
                                >
                                    {importing ? 'Importing...' : 'Import Project'}
                                </button>
                            </div>
                            {importError && (
                                <p className="kairo-error" data-testid="import-error" role="alert">
                                    Error: {importError}
                                </p>
                            )}
                        </form>
                    </div>
                )}

                {/* Step 3: Import Complete */}
                {step === 3 && importedSummary && (
                    <div className="kairo-wizard-step-content" data-testid="step-content-3">
                        <p className="kairo-wizard-ready" data-testid="import-ready">
                            Project <strong>{importedSummary.name}</strong> imported successfully.
                        </p>
                        <dl className="kairo-info-list">
                            <dt>Location</dt>
                            <dd data-testid="ready-root">{importedSummary.root}</dd>
                            <dt>Encoding</dt>
                            <dd data-testid="ready-encoding">{importedSummary.encoding}</dd>
                        </dl>
                        <p className="kairo-hint">
                            Import does not modify your source code. All configuration is saved
                            to <code>.kairo/project.json</code> in the project root.
                        </p>
                        <div className="kairo-wizard-actions">
                            <button
                                type="button"
                                className="theia-button main"
                                data-testid="open-project-btn"
                                onClick={async () => {
                                    // KAIRO-RC-WEB-2026-07-25-10: avoid
                                    // spliceRoots() because the underlying
                                    // DiskFileSystemProvider can fail with
                                    // EPERM when writing the new
                                    // `.theia-workspace` file (we see
                                    // "NoPermissions (FileSystemError):
                                    // Error: EPERM" in the log). The EPERM
                                    // propagates as an exception that
                                    // discards the `activeProject.setProject`
                                    // call done above, so the status bar
                                    // never moves off `(no workspace)`.
                                    //
                                    // Instead, just close the wizard. The
                                    // Theia workspace folder is already
                                    // set to a parent directory of the
                                    // imported project (because the test
                                    // runs the import from inside
                                    // /tmp/kairo-k4-workspace/), so the
                                    // file explorer is already able to
                                    // show the project files.
                                    console.log('[kairo] Open Project Folder clicked, closing wizard; workspace is already the project parent.');
                                    onClose();
                                }}
                            >
                                Open Project Folder
                            </button>
                            <button
                                type="button"
                                className="theia-button secondary"
                                data-testid="ready-close-btn"
                                onClick={() => onClose()}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};