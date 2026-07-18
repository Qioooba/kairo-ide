import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject } from '@theia/core/shared/inversify';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { KairoProjectService } from './project-service';
import { ActiveProjectService } from './active-project-service';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { ProjectConfig } from '@kairo/protocol';

@injectable()
export class ImportWizardWidget extends ReactWidget {
    static readonly ID = 'kairo-import-wizard';

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

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
            workspaceService: this.workspaceService,
            fileDialogService: this.fileDialogService,
            projectService: this.projectService,
            activeProject: this.activeProject,
            runtime: this.runtime,
        });
    }
}

interface ImportWizardProps {
    workspaceService: WorkspaceService;
    fileDialogService: FileDialogService;
    projectService: KairoProjectService;
    activeProject: ActiveProjectService;
    runtime: RuntimeConnectionService;
}

const ImportWizard: React.FC<ImportWizardProps> = ({
    workspaceService, fileDialogService, projectService, activeProject, runtime,
}) => {
    const [step, setStep] = React.useState(1);
    const [workspacePath, setWorkspacePath] = React.useState('');
    const [workspaceId, setWorkspaceId] = React.useState('');
    const [detectedConfig, setDetectedConfig] = React.useState<any>(null);
    const [scanning, setScanning] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [saveError, setSaveError] = React.useState('');
    const [saveSuccess, setSaveSuccess] = React.useState(false);
    const [projectName, setProjectName] = React.useState('my-project');
    const [sourceLevel, setSourceLevel] = React.useState('1.6');
    const [encoding, setEncoding] = React.useState('GBK');
    const [buildTool, setBuildTool] = React.useState('ant');

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
        setSaveSuccess(false);

        try {
            // Step 1: Scan the workspace to detect project layout
            const scanResult = await runtime.request(
                'POST /api/v1/workspaces/{workspaceId}/scan',
                { deep: true },
                { pathParams: { workspaceId } },
            ) as any;

            const detected = scanResult?.detected || (scanResult?.detected ? null : scanResult);

            // Step 2: Build the project config from the form
            const projectId = `project-${Date.now()}`;
            const projectConfig: ProjectConfig = {
                schemaVersion: 1,
                id: projectId,
                name: projectName,
                rootPath: workspacePath,
                sourceLayout: detected?.layout || detectedConfig?.layout || {
                    src: ['src'],
                    webRoot: 'web',
                    config: [],
                },
                encoding: {
                    default: encoding as any,
                },
                java: {
                    languageServer: {
                        toolchainId: 'auto',
                        fingerprint: '',
                    },
                    compiler: {
                        toolchainId: 'auto',
                        fingerprint: '',
                        sourceLevel: sourceLevel as any,
                        targetLevel: sourceLevel as any,
                    },
                    runtime: {
                        toolchainId: 'auto',
                        fingerprint: '',
                    },
                },
                serverRuntime: {
                    type: 'tomcat',
                    config: {},
                },
                build: {
                    mode: buildTool as any,
                },
                deploy: {
                    mode: 'copy',
                    target: 'webapps',
                },
                hotReload: {
                    mode: 'staticSync',
                },
            };

            // Step 3: Save the project config
            await runtime.request(
                'PUT /api/v1/projects/{projectId}',
                { config: projectConfig },
                { pathParams: { projectId } },
            );

            // Step 4: Update the ActiveProjectService
            await activeProject.setProject({
                workspaceId,
                projectId,
                name: projectName,
                root: workspacePath,
            });

            setSaveSuccess(true);
            setStep(4);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setSaveError(msg);
        } finally {
            setSaving(false);
        }
    }, [runtime, workspaceId, workspacePath, projectName, sourceLevel, encoding, buildTool, detectedConfig, activeProject]);

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
                        <form className="kairo-config-form" data-testid="project-config-form">
                            <label>
                                Project Name:
                                <input
                                    type="text"
                                    data-testid="input-project-name"
                                    value={projectName}
                                    onChange={e => setProjectName(e.target.value)}
                                />
                            </label>
                            <label>
                                Source Level:
                                <select
                                    data-testid="select-source-level"
                                    value={sourceLevel}
                                    onChange={e => setSourceLevel(e.target.value)}
                                >
                                    <option value="1.5">1.5</option>
                                    <option value="1.6">1.6</option>
                                    <option value="1.7">1.7</option>
                                    <option value="1.8">1.8</option>
                                </select>
                            </label>
                            <label>
                                Encoding:
                                <select
                                    data-testid="select-encoding"
                                    value={encoding}
                                    onChange={e => setEncoding(e.target.value)}
                                >
                                    <option value="UTF-8">UTF-8</option>
                                    <option value="GBK">GBK</option>
                                    <option value="GB18030">GB18030</option>
                                    <option value="ISO-8859-1">ISO-8859-1</option>
                                </select>
                            </label>
                            <label>
                                Build Tool:
                                <select
                                    data-testid="select-build-tool"
                                    value={buildTool}
                                    onChange={e => setBuildTool(e.target.value)}
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
                            >
                                {saving ? 'Saving...' : 'Save Configuration'}
                            </button>
                            {saveError && (
                                <p className="kairo-error" data-testid="save-error">
                                    Error: {saveError}
                                </p>
                            )}
                            {saveSuccess && (
                                <p className="kairo-success" data-testid="save-success">
                                    Configuration saved successfully!
                                </p>
                            )}
                        </form>
                    </div>
                )}

                {step === 4 && (
                    <div className="kairo-wizard-step-content" data-testid="step-content-4">
                        <p>Your project is ready! Kairo IDE will now open your workspace.</p>
                        <button
                            className="theia-button main"
                            onClick={handleStartIDE}
                            data-testid="start-ide-btn"
                        >
                            Start Kairo IDE
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};