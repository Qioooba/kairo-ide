/**
 * Kairo ToolWindowFrame — shared header/body/footer skeleton for tool
 * windows (REPORT §5.5). Fixes scroll ownership in one place: header and
 * footer are flex-none, only the body scrolls, so footers can never be
 * pushed off-screen or become a sideways column.
 */

import * as React from 'react';

export interface ToolWindowFrameProps {
    title: React.ReactNode;
    actions?: React.ReactNode;
    footer?: React.ReactNode;
    children: React.ReactNode;
    testId: string;
    bodyTestId?: string;
    footerTestId?: string;
}

export const ToolWindowFrame: React.FC<ToolWindowFrameProps> = ({
    title,
    actions,
    footer,
    children,
    testId,
    bodyTestId,
    footerTestId,
}) => (
    <div className="kairo-tool-window-frame" data-testid={testId}>
        <div className="kairo-tool-window-header">
            <span className="kairo-tool-window-title">{title}</span>
            {actions && <div className="kairo-tool-window-actions">{actions}</div>}
        </div>
        <div
            className="kairo-tool-window-body"
            data-testid={bodyTestId ?? `${testId}-body`}
        >
            {children}
        </div>
        {footer && (
            <div
                className="kairo-tool-window-footer"
                data-testid={footerTestId ?? `${testId}-footer`}
            >
                {footer}
            </div>
        )}
    </div>
);
