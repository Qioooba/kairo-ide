import * as React from 'react';
import { KairoI18nService } from '@kairo/i18n';
import { KairoDebugSessionService } from './kairo-debug-session-service';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface FrameNode {
    id: number;
    name: string;
    source?: { path?: string; name?: string };
    line?: number;
    frame?: any;
}

interface IDEAFramesPanelProps {
    sessionService: KairoDebugSessionService;
    i18n: KairoI18nService;
    onSelectFrame?: (frame: any) => void;
    onNavigate?: (path: string, line: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Frame Row                                                           */
/* ------------------------------------------------------------------ */

const FrameRow: React.FC<{
    frame: FrameNode;
    isCurrent: boolean;
    onClick: () => void;
}> = ({ frame, isCurrent, onClick }) => {
    const shortFile = frame.source?.name || frame.source?.path?.split('/').pop() || 'Unknown Source';
    const className = `kairo-debug-frame-row${isCurrent ? ' current' : ''}`;

    return (
        <div
            className={className}
            onClick={onClick}
            title={`${frame.name} (${shortFile}${frame.line !== undefined ? `:${frame.line}` : ''})`}
        >
            <span
                className={`codicon ${isCurrent ? 'codicon-chevron-right' : 'codicon-stackframe'}`}
                aria-hidden="true"
            />
            <span className="kairo-debug-frame-name">
                {frame.name}
            </span>
            {frame.line !== undefined && (
                <span className="kairo-debug-frame-location">
                    {shortFile}:{frame.line}
                </span>
            )}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Frames Panel                                                        */
/* ------------------------------------------------------------------ */

export const IDEAFramesPanel: React.FC<IDEAFramesPanelProps> = ({ sessionService, i18n, onSelectFrame, onNavigate }) => {
    const t = React.useCallback((key: string) => i18n.t(key as any), [i18n]);
    const [frames, setFrames] = React.useState<FrameNode[]>([]);
    const [currentFrameId, setCurrentFrameId] = React.useState<number | undefined>();
    const [loading, setLoading] = React.useState(false);

    const loadFrames = React.useCallback(async () => {
        setLoading(true);
        try {
            const stack = await sessionService.fetchStackFrames();
            const frameNodes: FrameNode[] = stack.frames.map(f => ({
                id: f.id,
                name: f.name,
                source: f.source,
                line: f.line,
                frame: f,
            }));
            setFrames(frameNodes);
            const focusedId = sessionService.currentFrameId;
            if (focusedId !== undefined) {
                setCurrentFrameId(focusedId);
            } else if (frameNodes.length > 0) {
                setCurrentFrameId(frameNodes[0].id);
            }
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    }, [sessionService]);

    const handleSelectFrame = React.useCallback(async (frame: FrameNode) => {
        const focused = await sessionService.focusFrame(frame.id);
        const effectiveFrameId = focused?.raw.id ?? sessionService.currentFrameId ?? frame.id;
        setCurrentFrameId(effectiveFrameId);
        if (onSelectFrame) {
            onSelectFrame(focused ?? frame.frame);
        }
        if (focused) {
            void focused.open({ preview: true });
        } else if (frame.source?.path && frame.line !== undefined && onNavigate) {
            onNavigate(frame.source.path, frame.line);
        }
    }, [onSelectFrame, onNavigate, sessionService]);

    React.useEffect(() => {
        if (sessionService.isSuspended) {
            loadFrames();
        } else {
            setFrames([]);
        }
        const disposable = sessionService.onDidChangeState(state => {
            if (state.currentFrameId !== undefined) {
                setCurrentFrameId(state.currentFrameId);
            }
            if (state.isSuspended) {
                loadFrames();
            } else if (!state.hasSession) {
                setFrames([]);
            }
        });
        return () => disposable.dispose();
    }, [loadFrames, sessionService]);

    if (loading && frames.length === 0) {
        return (
            <div className="kairo-debug-section-empty">
                {t('debug.toolWindow.loadingFrames')}
            </div>
        );
    }

    if (frames.length === 0) {
        return (
            <div className="kairo-debug-section-empty">
                {sessionService.isSuspended ? t('debug.toolWindow.noFrames') : t('debug.toolWindow.sessionNotPaused')}
            </div>
        );
    }

    return (
        <div className="kairo-debug-frames-idea">
            {frames.map(frame => (
                <FrameRow
                    key={frame.id}
                    frame={frame}
                    isCurrent={frame.id === currentFrameId}
                    onClick={() => handleSelectFrame(frame)}
                />
            ))}
        </div>
    );
};
