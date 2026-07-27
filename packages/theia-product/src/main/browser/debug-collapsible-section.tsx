import * as React from 'react';

/* ------------------------------------------------------------------ */
/*  Collapsible Section (IDEA-style accordion panel)                    */
/* ------------------------------------------------------------------ */

interface CollapsibleSectionProps {
    title: string;
    icon?: string;
    count?: number;
    defaultExpanded?: boolean;
    children: React.ReactNode;
    toolbar?: React.ReactNode;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
    title,
    icon,
    count,
    defaultExpanded = true,
    children,
    toolbar,
}) => {
    const [expanded, setExpanded] = React.useState(defaultExpanded);

    return (
        <div className="kairo-debug-section" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div
                className="kairo-debug-section-header"
                onClick={() => setExpanded(!expanded)}
                style={{
                    padding: '3px 8px',
                    fontWeight: 600,
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    color: 'var(--theia-sideBarSectionHeader-foreground)',
                    background: 'var(--theia-sideBarSectionHeader-background)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    borderBottom: expanded ? '1px solid var(--theia-panel-border)' : 'none',
                    flexShrink: 0,
                    lineHeight: '18px',
                }}
            >
                <span
                    className="codicon"
                    style={{
                        fontSize: '10px',
                        width: 14,
                        textAlign: 'center',
                        transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                        transition: 'transform 0.1s',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    ▾
                </span>
                {icon && <span className={`codicon ${icon}`} style={{ fontSize: 12 }} />}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                </span>
                {count !== undefined && (
                    <span style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7 }}>
                        {count}
                    </span>
                )}
                {toolbar && (
                    <span onClick={e => e.stopPropagation()}>
                        {toolbar}
                    </span>
                )}
            </div>
            {expanded && (
                <div className="kairo-debug-section-body" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                    {children}
                </div>
            )}
        </div>
    );
};
