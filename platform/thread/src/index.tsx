import React, { useId, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import type { FieldSpec } from '../../contracts/index.ts';

type Children = { children?: ReactNode };
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
};

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`thread-button thread-button--${variant} ${className}`.trim()}
      {...props}
    />
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: Children & {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__main">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 tabIndex={-1}>{title}</h1>
        {description && <p className="page-description">{description}</p>}
        {children}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  children,
  className = '',
}: Children & { title?: string; className?: string }) {
  const id = useId();
  return (
    <section
      className={`thread-panel ${className}`.trim()}
      aria-labelledby={title ? id : undefined}
    >
      {title && (
        <div className="thread-panel__header">
          <h2 id={id}>{title}</h2>
        </div>
      )}
      <div className="thread-panel__body">{children}</div>
    </section>
  );
}

export function Feedback({
  kind,
  title,
  message,
  onRetry,
}: {
  kind: 'loading' | 'empty' | 'error' | 'info';
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className={`thread-feedback thread-feedback--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <span
        className={`thread-feedback__icon ${kind === 'loading' ? 'thread-spinner' : ''}`}
        aria-hidden="true"
      >
        {kind === 'loading' ? '' : kind === 'error' ? '!' : kind === 'empty' ? '—' : 'i'}
      </span>
      <div>
        <p className="thread-feedback__title">{title}</p>
        {message && <p>{message}</p>}
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

export function ContextBar({
  children,
  trailing,
}: Children & {
  trailing?: ReactNode;
}) {
  return (
    <div className="thread-context-bar">
      <span className="status-dot" aria-hidden="true" />
      <span>{children}</span>
      {trailing && <span className="thread-context-bar__trailing">{trailing}</span>}
    </div>
  );
}

export function BackButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button {...props} variant="ghost" className={`thread-back-button ${className}`.trim()} />;
}

export function ResultsSummary({ start, end }: { start: ReactNode; end?: ReactNode }) {
  return (
    <div className="thread-results-summary" aria-label="Results summary">
      <span>{start}</span>
      {end && <span>{end}</span>}
    </div>
  );
}

export function RequestError({
  title,
  message,
  code,
  requestId,
  onRetry,
}: {
  title: string;
  message: string;
  code?: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="thread-request-error">
      <Feedback kind="error" title={title} message={message} onRetry={onRetry} />
      {(code || requestId) && (
        <p className="thread-error-reference">
          {code && <span>{code}</span>}
          {requestId && (
            <span>
              Request ID: <code>{requestId}</code>
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: Children & { tone?: 'neutral' | 'success' | 'warning' | 'accent' }) {
  return <span className={`thread-badge thread-badge--${tone}`}>{children}</span>;
}

export interface TableColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

function displayValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '')
    return <span className="muted">—</span>;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  onRowClick,
  emptyMessage = 'No results to display.',
  selectedId,
}: {
  rows: T[];
  columns: Array<TableColumn<T>>;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  selectedId?: string;
}) {
  if (!rows.length) return <Feedback kind="empty" title={emptyMessage} />;
  return (
    <div className="thread-table-scroll" role="region" aria-label="Results table" tabIndex={0}>
      <table className="thread-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={selectedId === row.id ? 'is-selected' : undefined}>
              {columns.map((column, index) => {
                const content = column.render
                  ? column.render(row)
                  : displayValue((row as Record<string, unknown>)[column.key]);
                return (
                  <td key={column.key}>
                    {index === 0 && onRowClick ? (
                      <button
                        type="button"
                        className="thread-row-action"
                        onClick={() => onRowClick(row)}
                        aria-current={selectedId === row.id ? 'true' : undefined}
                      >
                        {content}
                        <span className="sr-only"> — view details</span>
                      </button>
                    ) : (
                      content
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QueryForm({
  fields,
  values,
  onChange,
  onSubmit,
  busy = false,
  submitLabel = 'Search',
}: {
  fields: FieldSpec[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  submitLabel?: string;
}) {
  const prefix = useId();
  return (
    <form
      className="thread-query-form"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSubmit();
      }}
    >
      <div className="thread-form-fields">
        {fields.map((field) => {
          const id = `${prefix}-${field.name}`;
          const common = {
            id,
            name: field.name,
            required: field.required,
            disabled: busy,
            value: values[field.name] ?? '',
            onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
              onChange(field.name, event.target.value),
          };
          return (
            <div className="thread-field" key={field.name}>
              <label htmlFor={id}>
                {field.label}
                {field.required && (
                  <span aria-hidden="true" className="required-mark">
                    {' '}
                    *
                  </span>
                )}
              </label>
              {field.type === 'select' ? (
                <select {...common}>
                  {!field.required && <option value="">All</option>}
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  {...common}
                  type={field.type}
                  placeholder={field.placeholder}
                  autoComplete="off"
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="thread-form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? 'Searching…' : submitLabel}
          <span aria-hidden="true"> →</span>
        </Button>
      </div>
    </form>
  );
}

export function Tabs({
  items,
  active,
  onChange,
  idPrefix,
  label = 'View options',
}: {
  items: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
  idPrefix?: string;
  label?: string;
}) {
  const generatedPrefix = useId();
  const prefix = idPrefix ?? generatedPrefix;
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next].id);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  }
  return (
    <div className="thread-tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.id}
          id={`${prefix}-tab-${item.id}`}
          aria-controls={`${prefix}-panel-${item.id}`}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          tabIndex={active === item.id ? 0 : -1}
          onKeyDown={(event) => keyboard(event, index)}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function money(value: string, currency = 'USD'): string {
  if (value.trim() === '' || !Number.isFinite(Number(value))) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
  } catch {
    return `${Number(value).toFixed(2)} ${currency}`;
  }
}
