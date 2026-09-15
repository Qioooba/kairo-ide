/**
 * Kairo shared form primitives (REPORT UI-09 / §5.5).
 *
 * FormField owns the label/error/help association contract so every
 * widget gets it right the same way: stable id, label htmlFor,
 * aria-invalid + aria-describedby on the control. Controls are passed
 * as a render function receiving the control props to spread.
 */

import * as React from 'react';

export interface FormFieldControlProps {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
}

export interface FormFieldProps {
    /** Stable id prefix; control gets `${id}-input`, error `${id}-error`, help `${id}-help`. */
    id: string;
    label: React.ReactNode;
    error?: string;
    help?: React.ReactNode;
    readOnly?: boolean;
    required?: boolean;
    children: (controlProps: FormFieldControlProps) => React.ReactNode;
}

let formFieldCounter = 0;

export function useFormFieldId(prefix: string): string {
    const ref = React.useRef<string | null>(null);
    if (!ref.current) {
        formFieldCounter += 1;
        ref.current = `${prefix}-${formFieldCounter}`;
    }
    return ref.current;
}

export const FormField: React.FC<FormFieldProps> = ({
    id,
    label,
    error,
    help,
    readOnly,
    required,
    children,
}) => {
    const inputId = `${id}-input`;
    const errorId = `${id}-error`;
    const helpId = `${id}-help`;
    const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(' ') || undefined;
    return (
        <div className={`kairo-form-field${error ? ' kairo-form-field-error' : ''}${readOnly ? ' kairo-form-field-readonly' : ''}`}>
            <label className="kairo-form-field-label" htmlFor={inputId}>
                {label}
                {required && <span className="kairo-form-field-required" aria-hidden="true"> *</span>}
            </label>
            <div className="kairo-form-field-control">
                {children({ id: inputId, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
            </div>
            {error && (
                <div id={errorId} className="kairo-form-field-error-text" role="alert">
                    {error}
                </div>
            )}
            {help && !error && (
                <div id={helpId} className="kairo-form-field-help">
                    {help}
                </div>
            )}
        </div>
    );
};

/**
 * Validate a TCP/HTTP port string in its raw (uncommitted) form.
 * Returns the parsed port or an error key for the caller to localize.
 */
export function validatePortText(raw: string): { port?: number; error?: 'empty' | 'notInteger' | 'outOfRange' } {
    const text = raw.trim();
    if (text.length === 0) return { error: 'empty' };
    if (!/^\d+$/.test(text)) return { error: 'notInteger' };
    const port = Number(text);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return { error: 'outOfRange' };
    return { port };
}
