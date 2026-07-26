/**
 * Kairo Ant Classpath Service — communicates with the Go Runtime Agent's
 * Ant API endpoint (/api/v1/ant/classpath/analyze) to resolve build.xml
 * classpath dependencies and watch for build.xml changes.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { AntClasspathAnalyzeResponse, AntClasspathWarning } from '@kairo/protocol';

export type AntClasspathAnalysis = AntClasspathAnalyzeResponse;
export type AntResolveWarning = AntClasspathWarning;

export interface ClasspathInfo {
    source: 'ant' | 'yaml' | 'autodetect' | 'manual';
    warnings: AntResolveWarning[];
    lastAnalyzed?: string;
}

@injectable()
export class AntClasspathService {
    @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
    @inject(FileService) protected readonly fileService!: FileService;
    @inject(MessageService) protected readonly messageService!: MessageService;

    protected readonly onDidChangeClasspathEmitter = new Emitter<AntClasspathAnalysis>();
    readonly onDidChangeClasspath: Event<AntClasspathAnalysis> = this.onDidChangeClasspathEmitter.event;

    protected lastAnalysis: AntClasspathAnalysis | undefined;

    /**
     * Analyze build.xml and return the classpath resolution result.
     */
    async analyze(projectRoot: string, buildFile?: string): Promise<AntClasspathAnalysis> {
        if (!projectRoot || projectRoot.trim() === '') {
            const empty: AntClasspathAnalysis = {
                success: false,
                classpath: [],
                classpathCount: 0,
                sourceRoots: [],
                properties: {},
                warnings: [{ message: 'No project root provided', severity: 'info' }],
                message: 'No active project',
            };
            this.lastAnalysis = empty;
            this.onDidChangeClasspathEmitter.fire(empty);
            return empty;
        }
        try {
            const result = await this.runtime.request(
                'POST /api/v1/ant/classpath/analyze',
                { projectRoot, buildFile },
                { timeoutMs: 15_000 }
            );
            this.lastAnalysis = result;
            this.onDidChangeClasspathEmitter.fire(result);
            return result;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            const fallback: AntClasspathAnalysis = {
                success: false,
                classpath: [],
                classpathCount: 0,
                sourceRoots: [],
                properties: {},
                warnings: [{ message: msg, severity: 'error' }],
                message: msg,
            };
            this.lastAnalysis = fallback;
            this.onDidChangeClasspathEmitter.fire(fallback);
            return fallback;
        }
    }

    /**
     * Watch build.xml for changes and automatically re-analyze.
     * Returns a disposable to stop watching.
     */
    watchBuildFile(projectRoot: string): Disposable {
        const buildXmlUri = new URI(projectRoot).resolve('build.xml');
        const watchParentUri = buildXmlUri.parent;

        let debounceTimer: ReturnType<typeof setTimeout> | undefined;
        const disposables: Disposable[] = [];

        try {
            this.fileService.watch(watchParentUri);
            const fileChangeListener = this.fileService.onDidFilesChange(event => {
                for (const change of event.changes) {
                    if (change.resource.path.toString().endsWith('build.xml')) {
                        if (debounceTimer) clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(async () => {
                            await this.analyze(projectRoot);
                            this.messageService.info('build.xml changed, classpath refreshed');
                        }, 1000);
                    }
                }
            });
            disposables.push(fileChangeListener);
        } catch (error) {
            console.warn('Failed to watch build.xml:', error);
        }

        return Disposable.create(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            disposables.forEach(d => d.dispose());
        });
    }

    /**
     * Get the current classpath info (source and warnings).
     */
    getClasspathInfo(): ClasspathInfo {
        return {
            source: this.lastAnalysis?.success ? 'ant' : 'autodetect',
            warnings: this.lastAnalysis?.warnings ?? [],
            lastAnalyzed: new Date().toISOString(),
        };
    }

    /**
     * Get the last analysis result.
     */
    getLastAnalysis(): AntClasspathAnalysis | undefined {
        return this.lastAnalysis;
    }
}
