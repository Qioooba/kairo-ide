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
        <div className="kairo-debug-section">
            <div
                className={`kairo-debug-section-header ${expanded ? 'expanded' : 'collapsed'}`}
                onClick={() => setExpanded(!expanded)}
            >
                <span
                    className={`codicon kairo-debug-section-chevron ${expanded ? '' : 'collapsed'}`}
                >
                    ▾
                </span>
                {icon && <span className={`codicon ${icon}`} />}
                <span className="kairo-debug-section-header-title">
                    {title}
                </span>
                {count !== undefined && (
                    <span className="kairo-debug-section-header-count">
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
                <div className="kairo-debug-section-body">
                    {children}
                </div>
            )}
        </div>
    );
};
