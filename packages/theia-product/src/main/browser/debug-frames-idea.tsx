import * as React from 'react';
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
    const [hovered, setHovered] = React.useState(false);
    const shortFile = frame.source?.name || frame.source?.path?.split('/').pop() || 'Unknown Source';

    return (
        <div
            style={{
                padding: '2px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                background: isCurrent
                    ? 'var(--theia-list-activeSelectionBackground)'
                    : hovered
                    ? 'var(--theia-list-hoverBackground)'
                    : 'transparent',
                color: isCurrent
                    ? 'var(--theia-list-activeSelectionForeground)'
                    : 'var(--theia-list-foreground)',
                fontSize: '11px',
                lineHeight: '18px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
            }}
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            title={`${frame.name} (${shortFile}${frame.line !== undefined ? `:${frame.line}` : ''})`}
        >
            <span
                className="codicon"
                style={{ fontSize: 12, flexShrink: 0, color: isCurrent ? '#ffc66d' : 'var(--theia-symbolIcon-foreground, #b5b6e3)' }}
            >
                {isCurrent ? 'codicon-chevron-right' : 'codicon-stackframe'}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {frame.name}
            </span>
            {frame.line !== undefined && (
                <span style={{ fontSize: '10px', opacity: 0.6, flexShrink: 0 }}>
                    {shortFile}:{frame.line}
                </span>
            )}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Frames Panel                                                        */
/* ------------------------------------------------------------------ */

export const IDEAFramesPanel: React.FC<IDEAFramesPanelProps> = ({ sessionService, onSelectFrame, onNavigate }) => {
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
            if (frameNodes.length > 0) {
                setCurrentFrameId(frameNodes[0].id);
            }
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    }, [sessionService]);

    const handleSelectFrame = React.useCallback((frame: FrameNode) => {
        setCurrentFrameId(frame.id);
        if (onSelectFrame) {
            onSelectFrame(frame.frame);
        }
        if (frame.source?.path && frame.line !== undefined && onNavigate) {
            onNavigate(frame.source.path, frame.line);
        }
    }, [onSelectFrame, onNavigate]);

    React.useEffect(() => {
        if (sessionService.isSuspended) {
            loadFrames();
        } else {
            setFrames([]);
        }
        const disposable = sessionService.onDidChangeState(state => {
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
            <div style={{ padding: '8px 12px', color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                Loading frames...
            </div>
        );
    }

    if (frames.length === 0) {
        return (
            <div style={{ padding: '8px 12px', color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                {sessionService.isSuspended ? 'No frames available' : 'Session not paused'}
            </div>
        );
    }

    return (
        <div className="kairo-debug-frames-idea" style={{ overflow: 'auto', flex: 1 }}>
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
