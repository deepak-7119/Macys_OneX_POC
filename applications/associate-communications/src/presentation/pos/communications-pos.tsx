import React from 'react';
import type { BinderMenuItem } from '../../../../../platform/binder/contracts/menu.ts';
import { Button, Feedback } from '../../../../../platform/thread/src/index.tsx';

export type PosCommunicationsScreen = 'menu' | 'communications' | 'exit';
export type PosDocumentView = 'list' | 'detail' | 'viewer';
export type PosCommunicationsAction =
  'training-alerts' | 'view-pages' | 'document-details' | 'communication-menu' | 'exit';

export interface PosCommunicationsCommand {
  key: number;
  label: string;
  hint?: string;
  action?: PosCommunicationsAction;
  disabled: boolean;
}

/** Presentation commands only: these never introduce an API or device operation. */
export function getCommunicationsPosCommands(
  screen: PosCommunicationsScreen,
  view: PosDocumentView,
  hasDocument = false,
  menuItems: readonly BinderMenuItem[] = [],
): PosCommunicationsCommand[] {
  const inDocument = screen === 'communications' && view !== 'list';
  const commands: PosCommunicationsCommand[] = menuItems
    .slice()
    .sort((left, right) => left.key - right.key)
    .map((item) => ({ ...item }));
  if (!inDocument) return commands;
  return commands.map((command) => {
    if (command.key === 1)
      return {
        key: 1,
        label: 'Print Barcode',
        hint: 'Device integration not connected',
        disabled: true,
      };
    if (command.key === 2)
      return {
        key: 2,
        label: view === 'viewer' ? 'Document Details' : 'View Document Pages',
        action: view === 'viewer' ? 'document-details' : 'view-pages',
        disabled: !hasDocument,
      };
    if (command.key === 6)
      return { key: 6, label: 'Training Alerts', action: 'training-alerts', disabled: false };
    return command;
  });
}

/** Browser-safe Alt+number shortcuts; raw F keys belong to the browser/POS host. */
export function posKeyboardCommand(
  event: {
    key: string;
    altKey: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    repeat?: boolean;
    defaultPrevented?: boolean;
  },
  commands: readonly PosCommunicationsCommand[],
  editable = false,
): PosCommunicationsAction | undefined {
  if (
    editable ||
    event.defaultPrevented ||
    event.repeat ||
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    !/^[1-8]$/.test(event.key)
  )
    return undefined;
  const command = commands.find((item) => item.key === Number(event.key));
  return command && !command.disabled ? command.action : undefined;
}

export function PosFunctionRail({
  commands,
  onCommand,
}: {
  commands: readonly PosCommunicationsCommand[];
  onCommand: (action: PosCommunicationsAction) => void;
}) {
  return (
    <nav className="pos-function-rail" aria-label="POS function keys">
      {commands.map((command) => (
        <button
          key={command.key}
          type="button"
          className="pos-function-key"
          disabled={command.disabled}
          aria-keyshortcuts={command.disabled ? undefined : `Alt+${command.key}`}
          onClick={() => {
            if (!command.disabled && command.action) onCommand(command.action);
          }}
        >
          <span className="pos-function-key__code">T{command.key}</span>
          <span className="pos-function-key__label">{command.label}</span>
          <small className="pos-function-key__hint">
            {command.hint ?? (command.disabled ? 'Unavailable' : `Alt+${command.key}`)}
          </small>
        </button>
      ))}
    </nav>
  );
}

export function PosCommunicationMenu({
  commands,
  loading,
  error,
  onRetry,
  onCommand,
}: {
  commands: readonly PosCommunicationsCommand[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onCommand: (action: PosCommunicationsAction) => void;
}) {
  const categories = commands.slice(0, 4);
  return (
    <>
      <div className="pos-menu-heading">
        <span className="eyebrow">ASSOCIATE COMMUNICATIONS</span>
        <h1 tabIndex={-1}>Communication Menu</h1>
        <p>Select a communication category. Use the touch keys or Alt + the T-key number.</p>
      </div>
      {loading && (
        <Feedback
          kind="loading"
          title="Loading communication menu"
          message="Binder is loading the menu for this store context…"
        />
      )}
      {!loading && error && (
        <Feedback kind="error" title="Menu unavailable" message={error} onRetry={onRetry} />
      )}
      {!loading && !error && (
        <div className="pos-menu-grid">
          {categories.map((category) => (
            <button
              type="button"
              key={category.key}
              className={`pos-menu-card${category.disabled ? ' pos-menu-card--unavailable' : ''}`}
              disabled={category.disabled}
              onClick={
                category.disabled || !category.action
                  ? undefined
                  : () => onCommand(category.action!)
              }
            >
              <span className="pos-menu-card__number">T{category.key}</span>
              <strong>{category.label}</strong>
              <small>{category.hint ?? 'View current store alerts'}</small>
            </button>
          ))}
        </div>
      )}
      <p className="pos-menu-note">
        POS-style presentation of the same web application and synthetic backend. Only Training
        Alerts is implemented; register hardware and live offers are not connected.
      </p>
    </>
  );
}

export function PosExitScreen({ onReturn }: { onReturn: () => void }) {
  return (
    <div className="pos-exit-screen">
      <span className="eyebrow">HOST HANDOFF PREVIEW</span>
      <h1 tabIndex={-1}>POS main menu · simulated</h1>
      <p>
        In a real register this action returns control to the POS host. This local preview has no
        register connection and has not opened or closed another application.
      </p>
      <Button onClick={onReturn}>Return to Associate Communications</Button>
    </div>
  );
}

export function PosCommunicationsFrame({
  pos = true,
  commands,
  onCommand,
  division,
  store,
  children,
}: {
  pos?: boolean;
  commands: readonly PosCommunicationsCommand[];
  onCommand: (action: PosCommunicationsAction) => void;
  division: string;
  store: string;
  children: React.ReactNode;
}) {
  return (
    <div className={pos ? 'pos-comm-shell' : undefined}>
      {pos && <PosFunctionRail commands={commands} onCommand={onCommand} />}
      <div className={pos ? 'pos-comm-main' : undefined}>
        {pos && (
          <header className="pos-comm-header">
            <strong>Associate Communications</strong>
            <span>
              Division {division} · Store {store} · Synthetic POS context
            </span>
          </header>
        )}
        <section
          className={pos ? 'pos-comm-body' : undefined}
          aria-label={pos ? 'Associate Communications POS workspace' : undefined}
        >
          {children}
        </section>
      </div>
    </div>
  );
}
