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
    const toggle = () => setExpanded(v => !v);

    return (
        <div className="kairo-debug-section">
            <div
                className={`kairo-debug-section-header ${expanded ? 'expanded' : 'collapsed'}`}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                aria-label={title}
                onClick={toggle}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle();
                    }
                }}
            >
                <span
                    className={`codicon kairo-debug-section-chevron ${expanded ? '' : 'collapsed'}`}
                    aria-hidden="true"
                >
                    ▾
                </span>
                {icon && <span className={`codicon ${icon}`} aria-hidden="true" />}
                <span className="kairo-debug-section-header-title">
                    {title}
                </span>
                {count !== undefined && (
                    <span className="kairo-debug-section-header-count">
                        {count}
                    </span>
                )}
                {toolbar && (
                    <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                        {toolbar}
                    </span>
                )}
            </div>
            {expanded && (
                <div className="kairo-debug-section-body" role="region" aria-label={title}>
                    {children}
                </div>
            )}
        </div>
    );
};
