import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject } from '@theia/core/shared/inversify';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { KairoProjectService } from './project-service';
import { ActiveProjectService } from './active-project-service';
import { RuntimeConnectionService } from '@kairo/runtime-extension';

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

    constructor() {
        super();
        this.id = ImportWizardWidget.ID;
        this.title.label = 'Welcome to Kairo IDE';
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
            onClose: () => this.close(),
        });
    }
}

interface ImportWizardProps {
    fileDialogService: FileDialogService;
    projectService: KairoProjectService;
    activeProject: ActiveProjectService;
    runtime: RuntimeConnectionService;
    onClose: () => void;
}

const ImportWizard: React.FC<ImportWizardProps> = ({
    fileDialogService, projectService, activeProject, runtime, onClose,
}) => {
    const [step, setStep] = React.useState(1);
    const [workspacePath, setWorkspacePath] = React.useState('');
    const [workspaceId, setWorkspaceId] = React.useState('');
    const [detectedConfig, setDetectedConfig] = React.useState<any>(null);
    const [scanning, setScanning] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [saveError, setSaveError] = React.useState('');
    const [projectName, setProjectName] = React.useState('my-project');
    const [sourceLevel, setSourceLevel] = React.useState('1.6');
    const [encoding, setEncoding] = React.useState('GBK');
    const [buildTool, setBuildTool] = React.useState('ant');
    const [projectId, setProjectId] = React.useState('');

    const handleOpenWorkspace = React.useCallback(async () => {
        const dialog = await fileDialogService.showOpenDialog({
            title: 'Open Workspace Folder',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
        });
        if (dialog) {
            const path = String(dialog.path);
            setWorkspacePath(path);
            setScanning(true);
            setStep(2);
            try {
                const ws = await projectService.openWorkspace(path);
                setWorkspaceId(ws.id);
                setProjectId(`project-${ws.id}`);
                const layout = await projectService.detectLayout(ws.id);
                setDetectedConfig(layout);
            } catch {
                setDetectedConfig(null);
            } finally {
                setScanning(false);
            }
        }
    }, [fileDialogService, projectService]);

    const handleSaveConfig = React.useCallback(async () => {
        setSaving(true);
        setSaveError('');

        try {
            const trimmedName = projectName.trim();
            if (!trimmedName) {
                throw new Error('Project name cannot be empty.');
            }
            if (trimmedName.length > 100) {
                throw new Error('Project name cannot exceed 100 characters.');
            }
            if (!projectId) {
                throw new Error('No workspace selected. Open a workspace folder first.');
            }

            // Step 4: Scan the workspace to detect project layout
            const scanResult = await runtime.request(
                'POST /api/v1/workspaces/{workspaceId}/scan',
                { deep: true },
                { pathParams: { workspaceId } },
            ) as any;

            const detected = scanResult?.detected || (scanResult?.detected ? null : scanResult);
            const layout = detected?.layout || detectedConfig?.layout || {
                src: ['src'],
                webRoot: 'WebRoot',
                config: [],
            };

            // The Runtime Agent's domain.Project expects a flat shape on the
            // PUT /api/v1/projects/{projectId} wire. Send encoding as a
            // normalized lowercase string (not the protocol's nested object),
            // and include workspaceId so the disk store can scope the project.
            const domainProject = {
                id: projectId,
                workspaceId,
                name: trimmedName,
                rootPath: workspacePath,
                sourceRoots: layout.src || ['src'],
                resourceRoots: layout.resources || ['src/main/resources'],
                webappDir: layout.webRoot || 'WebRoot',
                outputDir: 'build/classes',
                sourceLevel,
                targetLevel: sourceLevel,
                encoding: normalizeEncodingId(encoding),
                buildTool,
                contextPath: '',
            } as any;

            const saved = await projectService.create(domainProject);

            await activeProject.setProject({
                workspaceId,
                projectId: saved.id,
                name: saved.name,
                root: saved.rootPath || workspacePath,
            });

            // Close wizard, refresh views (NO reload)
            onClose();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setSaveError(msg);
        } finally {
            setSaving(false);
        }
    }, [runtime, projectService, workspaceId, workspacePath, projectName, sourceLevel, encoding, buildTool, detectedConfig, activeProject, onClose, projectId]);

    const handleStartIDE = React.useCallback(async () => {
        if (workspacePath && projectService) {
            try {
                if (projectService.currentWorkspace()) {
                    window.location.reload();
                } else {
                    await projectService.openWorkspace(workspacePath, projectName);
                    window.location.reload();
                }
            } catch {
                window.location.reload();
            }
        }
    }, [workspacePath, projectName, projectService]);

    return (
        <div className="kairo-import-wizard" data-testid="import-wizard">
            <header className="kairo-wizard-header">
                <h1 data-testid="wizard-title">Welcome to Kairo IDE</h1>
                <p className="kairo-wizard-subtitle">Set up your legacy Java project</p>
            </header>

            <div className="kairo-wizard-steps">
                <div className={`kairo-wizard-step ${step >= 1 ? 'active' : ''}`} data-testid="step-1">
                    <span className="step-number">1</span>
                    <span className="step-label">Open Workspace</span>
                </div>
                <div className={`kairo-wizard-step ${step >= 2 ? 'active' : ''}`} data-testid="step-2">
                    <span className="step-number">2</span>
                    <span className="step-label">Detect Project</span>
                </div>
                <div className={`kairo-wizard-step ${step >= 3 ? 'active' : ''}`} data-testid="step-3">
                    <span className="step-number">3</span>
                    <span className="step-label">Configure</span>
                </div>
                <div className={`kairo-wizard-step ${step >= 4 ? 'active' : ''}`} data-testid="step-4">
                    <span className="step-number">4</span>
                    <span className="step-label">Ready</span>
                </div>
            </div>

            <div className="kairo-wizard-content">
                {step === 1 && (
                    <div className="kairo-wizard-step-content" data-testid="step-content-1">
                        <p>Select the root folder of your legacy Java project.</p>
                        <button
                            className="theia-button main"
                            onClick={handleOpenWorkspace}
                            data-testid="open-workspace-btn"
                            aria-label="Open workspace folder"
                        >
                            Open Workspace Folder
                        </button>
                        {workspacePath && (
                            <p className="kairo-selected-path" data-testid="selected-path">
                                Selected: {workspacePath}
                            </p>
                        )}
                    </div>
                )}

                {step === 2 && (
                    <div className="kairo-wizard-step-content" data-testid="step-content-2">
                        {scanning ? (
                            <p>Scanning project...</p>
                        ) : detectedConfig ? (
                            <div>
                                <p>Found project configuration:</p>
                                <pre data-testid="detected-config">{JSON.stringify(detectedConfig, null, 2)}</pre>
                                <button
                                    className="theia-button main"
                                    onClick={() => setStep(3)}
                                    data-testid="continue-to-configure"
                                    aria-label="Continue to configuration"
                                >
                                    Continue
                                </button>
                            </div>
                        ) : (
                            <div>
                                <p>No existing project configuration found.</p>
                                <button
                                    className="theia-button main"
                                    onClick={() => setStep(3)}
                                    data-testid="create-new-config"
                                    aria-label="Create new configuration"
                                >
                                    Create New Configuration
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {step === 3 && (
                    <div className="kairo-wizard-step-content" data-testid="step-content-3">
                        <p>Configure your project settings:</p>
                        <form className="kairo-config-form" data-testid="project-config-form" onSubmit={e => e.preventDefault()}>
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
                            <label htmlFor="select-source-level">
                                Source Level:
                                <select
                                    id="select-source-level"
                                    data-testid="select-source-level"
                                    value={sourceLevel}
                                    onChange={e => setSourceLevel(e.target.value)}
                                    aria-label="Java source level"
                                >
                                    <option value="1.5">1.5</option>
                                    <option value="1.6">1.6</option>
                                    <option value="1.7">1.7</option>
                                    <option value="1.8">1.8</option>
                                </select>
                            </label>
                            <label htmlFor="select-encoding">
                                Encoding:
                                <select
                                    id="select-encoding"
                                    data-testid="select-encoding"
                                    value={encoding}
                                    onChange={e => setEncoding(e.target.value)}
                                    aria-label="File encoding"
                                >
                                    <option value="UTF-8">UTF-8</option>
                                    <option value="GBK">GBK</option>
                                    <option value="GB18030">GB18030</option>
                                    <option value="ISO-8859-1">ISO-8859-1</option>
                                </select>
                            </label>
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
                            <button
                                type="button"
                                className="theia-button main"
                                onClick={handleSaveConfig}
                                disabled={saving}
                                data-testid="save-config-btn"
                                aria-label="Save configuration"
                            >
                                {saving ? 'Saving...' : 'Save Configuration'}
                            </button>
                            {saveError && (
                                <p className="kairo-error" data-testid="save-error" role="alert">
                                    Error: {saveError}
                                </p>
                            )}
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
};