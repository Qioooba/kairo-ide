import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable } from '@theia/core/lib/common/disposable';
import URI from '@theia/core/lib/common/uri';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import { Diagnostic, DiagnosticSeverity } from '@theia/core/shared/vscode-languageserver-protocol';
import { AntClasspathService, AntClasspathAnalysis } from './ant-classpath-service';
import { ActiveProjectService } from '@kairo/project-extension';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { ProjectInfo } from '@kairo/project-extension';

const ANT_MARKER_OWNER = 'kairo-ant';

@injectable()
export class AntClasspathContribution implements FrontendApplicationContribution {
    @inject(AntClasspathService) protected readonly antClasspathService!: AntClasspathService;
    @inject(ActiveProjectService) protected readonly activeProject!: ActiveProjectService;
    @inject(ProblemManager) protected readonly problemManager!: ProblemManager;
    @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
    @inject(ILogger) protected readonly logger!: ILogger;

    protected watcher: Disposable | undefined;
    protected lastBuildXmlUri: URI | undefined;

    @postConstruct()
    protected init(): void {
        this.activeProject.onDidChangeProject(project => {
            this.handleProjectChange(project);
        });

        this.antClasspathService.onDidChangeClasspath(result => {
            this.handleClasspathChange(result);
        });
    }

    onStart(_app: FrontendApplication): void {
        // Initialization is handled in @postConstruct.
    }

    protected handleProjectChange(project: ProjectInfo | undefined): void {
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = undefined;
        }

        if (!project) {
            this.clearAntMarkers();
            return;
        }

        const rootPath = project.root;
        if (!rootPath || rootPath.trim() === '') {
            this.clearAntMarkers();
            return;
        }

        this.antClasspathService.analyze(rootPath).then(result => {
            if (result.success) {
                void this.refreshJdtProject(project);
            }
            this.reportAntWarnings(result, rootPath);
        }).catch(err => {
            this.logger.error(`Ant classpath analysis failed: ${err instanceof Error ? err.message : String(err)}`);
        });

        this.watcher = this.antClasspathService.watchBuildFile(rootPath);
    }

    protected handleClasspathChange(result: AntClasspathAnalysis): void {
        const project = this.activeProject.project;
        if (!project) return;

        this.reportAntWarnings(result, project.root);

        if (result.success) {
            void this.refreshJdtProject(project);
        }
    }

    protected async refreshJdtProject(project: ProjectInfo): Promise<void> {
        try {
            await this.runtime.request(
                'POST /api/v1/jdtls/project',
                {
                    workspaceId: project.workspaceId,
                    rootPath: project.root,
                    projectId: project.projectId,
                },
            );
            this.logger.info(`JDT project refreshed for ${project.projectId}`);
        } catch (err) {
            this.logger.error(`Failed to refresh JDT project for ${project.projectId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    protected reportAntWarnings(result: AntClasspathAnalysis, rootPath: string): void {
        const buildXmlPath = result.buildFile ?? `${rootPath}/build.xml`;
        const buildXmlUri = URI.fromFilePath(buildXmlPath);
        this.lastBuildXmlUri = buildXmlUri;

        if (!result.warnings || result.warnings.length === 0) {
            this.problemManager.setMarkers(buildXmlUri, ANT_MARKER_OWNER, []);
            return;
        }

        const diagnostics: Diagnostic[] = result.warnings.map(w => ({
            range: {
                start: { line: Math.max(0, (w.line ?? 1) - 1), character: 0 },
                end: { line: Math.max(0, (w.line ?? 1) - 1), character: 0 },
            },
            severity: toDiagnosticSeverity(w.severity),
            source: ANT_MARKER_OWNER,
            message: w.message,
        }));

        this.problemManager.setMarkers(buildXmlUri, ANT_MARKER_OWNER, diagnostics);
    }

    protected clearAntMarkers(): void {
        if (this.lastBuildXmlUri) {
            this.problemManager.setMarkers(this.lastBuildXmlUri, ANT_MARKER_OWNER, []);
            this.lastBuildXmlUri = undefined;
        }
    }
}

function toDiagnosticSeverity(severity: 'error' | 'warning' | 'info'): DiagnosticSeverity {
    switch (severity) {
        case 'error': return DiagnosticSeverity.Error;
        case 'warning': return DiagnosticSeverity.Warning;
        case 'info': return DiagnosticSeverity.Information;
        default: return DiagnosticSeverity.Warning;
    }
}
