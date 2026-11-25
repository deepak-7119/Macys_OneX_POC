import React, { useEffect, useId, useRef, useState } from 'react';
import type {
  AppProps,
  DocumentDetail,
  DocumentResults,
  DocumentSummary,
} from '../../../platform/contracts/index.ts';
import type { BinderMenuItem } from '../../../platform/binder/contracts/menu.ts';
import { loadCommunicationsMenu } from '../../../platform/binder/client/index.ts';
import { api, ApiError, operationPath } from '../../../platform/spool/src/client.ts';
import { usePresentationMode } from '../../../platform/spool/src/presentation.ts';
import {
  getCommunicationsPosCommands,
  posKeyboardCommand,
  PosCommunicationMenu,
  PosCommunicationsFrame,
  PosExitScreen,
  type PosCommunicationsAction,
  type PosCommunicationsScreen,
} from './presentation/pos/communications-pos.tsx';
import {
  BackButton,
  Badge,
  Button,
  ContextBar,
  DataTable,
  Feedback,
  PageHeader,
  Panel,
  RequestError,
  ResultsSummary,
} from '../../../platform/thread/src/index.tsx';

const FIXTURE_DATE = '2026-11-14';
const fobOptions = ['Apparel', 'Home', 'Beauty'];
type View = 'list' | 'detail' | 'viewer';
export interface DocumentUiError {
  message: string;
  code?: string;
  requestId?: string;
}

export function documentDate(value: string, empty = 'Not specified'): string {
  if (!value) return empty;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
}

export function documentUiError(error: unknown): DocumentUiError {
  return error instanceof ApiError
    ? { message: error.detail.message, code: error.detail.code, requestId: error.detail.requestId }
    : { message: 'The local document service could not complete this request. Please try again.' };
}

export function DocumentError({
  error,
  onRetry,
}: {
  error: DocumentUiError;
  onRetry?: () => void;
}) {
  return (
    <RequestError
      title="Documents are temporarily unavailable"
      message={error.message}
      code={error.code}
      requestId={error.requestId}
      onRetry={onRetry}
    />
  );
}

export function DocumentMetadata({ document }: { document: DocumentDetail }) {
  return (
    <dl className="metadata-grid document-metadata">
      <div>
        <dt>Document ID</dt>
        <dd>{document.id}</dd>
      </div>
      <div>
        <dt>FOB</dt>
        <dd>{document.groups.join(', ') || 'Not specified'}</dd>
      </div>
      <div>
        <dt>Start date</dt>
        <dd>{documentDate(document.validFrom)}</dd>
      </div>
      <div>
        <dt>End date</dt>
        <dd>{documentDate(document.validTo, 'No end date')}</dd>
      </div>
      <div>
        <dt>Category</dt>
        <dd>Training alerts</dd>
      </div>
      <div>
        <dt>Pages</dt>
        <dd>
          {document.pageCount} {document.pageCount === 1 ? 'page' : 'pages'}
        </dd>
      </div>
    </dl>
  );
}

export function DocumentPageImage({
  page,
  title,
  pageCount,
}: {
  page: DocumentDetail['pages'][number];
  title: string;
  pageCount: number;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const currentAttempt = useRef(attempt);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  currentAttempt.current = attempt;
  const requestAttempt = attempt;
  function retry() {
    setStatus('loading');
    setAttempt((value) => value + 1);
  }
  return (
    <div className="document-image-state" aria-busy={status === 'loading'}>
      {status === 'loading' && (
        <Feedback
          kind="loading"
          title={`Loading page ${page.number}`}
          message="Retrieving a synthetic document image from the local service…"
        />
      )}
      {status === 'error' && (
        <Feedback
          kind="error"
          title={`Page ${page.number} could not be loaded`}
          message="The page service did not return an available image. Retry this page or return to the document details."
          onRetry={retry}
        />
      )}
      <img
        key={`${page.url}-${attempt}`}
        src={page.url}
        alt={`Synthetic document page ${page.number} of ${pageCount}: ${title}`}
        hidden={status !== 'ready'}
        onLoad={() => {
          if (mounted.current && currentAttempt.current === requestAttempt) setStatus('ready');
        }}
        onError={() => {
          if (mounted.current && currentAttempt.current === requestAttempt) setStatus('error');
        }}
      />
    </div>
  );
}

export function DocumentViewer({ document }: { document: DocumentDetail }) {
  const presentation = usePresentationMode();
  const [index, setIndex] = useState(0);
  const [actualSize, setActualSize] = useState(false);
  const page = document.pages[index];
  if (!page) return <Feedback kind="empty" title="No document pages are available." />;
  return (
    <div className="document-viewer">
      <div className="document-toolbar">
        <Button
          variant="secondary"
          disabled={index === 0}
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
        >
          ← Previous page
        </Button>
        <span role="status" aria-live="polite">
          Page <strong>{index + 1}</strong> of <strong>{document.pages.length}</strong>
        </span>
        <Button
          variant="secondary"
          disabled={index === document.pages.length - 1}
          onClick={() => setIndex((value) => Math.min(document.pages.length - 1, value + 1))}
        >
          Next page →
        </Button>
      </div>
      <div className="document-display-controls">
        <span>Page display</span>
        <div role="group" aria-label="Document page display">
          <Button
            variant="secondary"
            aria-pressed={!actualSize}
            onClick={() => setActualSize(false)}
          >
            Fit width
          </Button>
          <Button variant="secondary" aria-pressed={actualSize} onClick={() => setActualSize(true)}>
            Actual size
          </Button>
        </div>
      </div>
      <div
        className={`document-stage${actualSize ? ' document-stage--actual' : ''}`}
        role="region"
        aria-label="Document page viewing area"
        tabIndex={actualSize || presentation === 'pos' ? 0 : -1}
      >
        <DocumentPageImage
          key={`${document.id}-${page.number}`}
          page={page}
          title={document.title}
          pageCount={document.pages.length}
        />
      </div>
      {actualSize && (
        <p className="document-scroll-help">
          Scroll within the page to read at actual size. Keyboard: focus the viewing area, then use
          the arrow keys.
        </p>
      )}
      <p className="document-image-note">
        Synthetic page image · Local fixture content · Not a production PDF or operational guidance
      </p>
    </div>
  );
}

export default function Application({ manifest, session }: AppProps) {
  const presentation = usePresentationMode();
  const [posScreen, setPosScreen] = useState<PosCommunicationsScreen>(
    presentation === 'pos' ? 'menu' : 'communications',
  );
  const previousPresentation = useRef(presentation);
  const [view, setView] = useState<View>('list');
  const [fob, setFob] = useState('');
  const [results, setResults] = useState<DocumentResults | null>(null);
  const [listBusy, setListBusy] = useState(true);
  const [listError, setListError] = useState<DocumentUiError>();
  const [selected, setSelected] = useState<DocumentSummary | null>(null);
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<DocumentUiError>();
  const [menuItems, setMenuItems] = useState<BinderMenuItem[]>([]);
  const [menuBusy, setMenuBusy] = useState(presentation === 'pos');
  const [menuError, setMenuError] = useState<string>();
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const filterId = useId();

  async function loadMenu() {
    setMenuBusy(true);
    setMenuError(undefined);
    try {
      const menu = await loadCommunicationsMenu(manifest);
      setMenuItems(menu.items);
    } catch {
      setMenuItems([]);
      setMenuError('Binder could not load the mock POS menu. Retry this data load.');
    } finally {
      setMenuBusy(false);
    }
  }

  async function loadList(group: string) {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setListBusy(true);
    setListError(undefined);
    const query = new URLSearchParams({ category: 'training-alerts' });
    if (group) query.set('fob', group);
    try {
      const data = await api<DocumentResults>(`${operationPath(manifest, 'list')}?${query}`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setResults(data);
    } catch (error) {
      if (!controller.signal.aborted) setListError(documentUiError(error));
    } finally {
      if (!controller.signal.aborted) setListBusy(false);
    }
  }

  useEffect(() => {
    void loadList('');
    return () => {
      listRequest.current?.abort();
      detailRequest.current?.abort();
    };
  }, [manifest]);
  useEffect(() => {
    if (presentation === 'pos' && menuItems.length === 0 && !menuError) void loadMenu();
  }, [presentation, manifest]);
  useEffect(() => {
    if (previousPresentation.current !== presentation) {
      previousPresentation.current = presentation;
      if (presentation === 'pos') setPosScreen('communications');
    }
  }, [presentation]);
  useEffect(() => {
    const showingDocuments = presentation !== 'pos' || posScreen === 'communications';
    const selectedRow =
      showingDocuments && view === 'list'
        ? region.current?.querySelector<HTMLButtonElement>(
            '.thread-row-action[aria-current="true"]',
          )
        : null;
    (selectedRow ?? region.current?.querySelector<HTMLHeadingElement>('h1'))?.focus({
      preventScroll: true,
    });
  }, [view, posScreen, presentation]);

  async function openDocument(row: DocumentSummary) {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setSelected(row);
    setDocument(null);
    setDetailError(undefined);
    setDetailBusy(true);
    setView('detail');
    try {
      const data = await api<DocumentDetail>(operationPath(manifest, 'detail', { id: row.id }), {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setDocument(data);
    } catch (error) {
      if (!controller.signal.aborted) setDetailError(documentUiError(error));
    } finally {
      if (!controller.signal.aborted) setDetailBusy(false);
    }
  }

  function backToList() {
    detailRequest.current?.abort();
    setView('list');
  }

  function handlePosCommand(action: PosCommunicationsAction) {
    if (action === 'training-alerts') {
      backToList();
      setPosScreen('communications');
    } else if (action === 'view-pages' && document?.pages.length) {
      setView('viewer');
    } else if (action === 'document-details' && document) {
      setView('detail');
    } else if (action === 'communication-menu' || action === 'exit') {
      setPosScreen(action === 'exit' ? 'exit' : 'menu');
    }
  }

  const posCommands = getCommunicationsPosCommands(
    posScreen,
    view,
    Boolean(document?.pages.length),
    menuItems,
  );

  useEffect(() => {
    if (presentation !== 'pos') return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          Boolean(target.closest('input, textarea, select, [contenteditable], [role="textbox"]')));
      const action = posKeyboardCommand(event, posCommands, editable);
      if (!action) return;
      event.preventDefault();
      handlePosCommand(action);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [presentation, posScreen, view, document]);

  const documentContent = (
    <>
      {view === 'list' ? (
        <>
          <PageHeader
            eyebrow={manifest.eyebrow}
            title={manifest.name}
            description="Keep up with training alerts and the information relevant to your store."
            actions={<Badge tone="accent">Knowledge & training</Badge>}
          />
          <ContextBar
            trailing={
              <>
                Division {session.division} · Store {session.store}
              </>
            }
          >
            Invented documents · Eligibility as of fixture date {documentDate(FIXTURE_DATE)}
          </ContextBar>
          <Panel>
            <div className="document-list-header">
              <div>
                <span className="eyebrow">STORE COMMUNICATIONS</span>
                <h2>
                  Training alerts{' '}
                  {results && !listBusy && !listError && <Badge>{results.items.length}</Badge>}
                </h2>
                <p>View current alerts available to this synthetic store profile.</p>
              </div>
              <div className="document-filter">
                <label htmlFor={filterId}>FOB</label>
                <select
                  id={filterId}
                  value={fob}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFob(value);
                    void loadList(value);
                  }}
                >
                  <option value="">All FOBs</option>
                  {fobOptions.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {listBusy && (
              <Feedback
                kind="loading"
                title="Loading training alerts"
                message="Retrieving eligible synthetic documents…"
              />
            )}
            {!listBusy && listError && (
              <DocumentError error={listError} onRetry={() => void loadList(fob)} />
            )}
            {!listBusy && !listError && results && (
              <>
                {results.truncated && (
                  <Feedback
                    kind="info"
                    title={`Showing the first ${results.limit} of ${results.totalMatches} alerts`}
                    message="Only the bounded result set is displayed."
                  />
                )}
                <DataTable
                  rows={results.items}
                  selectedId={selected?.id}
                  onRowClick={(row) => void openDocument(row)}
                  emptyMessage="No training alerts match this FOB."
                  columns={[
                    {
                      key: 'title',
                      label: 'Document',
                      render: (row) => (
                        <span className="document-title-cell">
                          <span>{row.title}</span>
                          {row.isNew && <Badge tone="accent">New</Badge>}
                        </span>
                      ),
                    },
                    { key: 'groups', label: 'FOB', render: (row) => row.groups.join(', ') || '—' },
                    {
                      key: 'validFrom',
                      label: 'Start date',
                      render: (row) => documentDate(row.validFrom),
                    },
                    {
                      key: 'validTo',
                      label: 'End date',
                      render: (row) => documentDate(row.validTo, 'No end date'),
                    },
                    { key: 'pageCount', label: 'Pages' },
                  ]}
                />
                <ResultsSummary
                  start={
                    <>
                      {results.items.length} displayed · {results.totalMatches} eligible matches
                    </>
                  }
                  end={<>Fixture date: {FIXTURE_DATE}</>}
                />
              </>
            )}
          </Panel>
          <div className="document-context-note">
            <span aria-hidden="true">ⓘ</span>
            <p>
              Availability is resolved by the local backend using division, store and effective
              dates. Content here is synthetic and should not be used as store guidance.
            </p>
          </div>
        </>
      ) : (
        <>
          <BackButton onClick={view === 'viewer' ? () => setView('detail') : backToList}>
            ← {view === 'viewer' ? 'Back to document details' : 'Back to training alerts'}
          </BackButton>
          <PageHeader
            eyebrow={view === 'viewer' ? 'DOCUMENT VIEWER' : 'TRAINING ALERT'}
            title={document?.title ?? selected?.title ?? 'Document details'}
            description={
              view === 'viewer'
                ? 'Read the synthetic document one page at a time.'
                : 'Review this alert before opening its synthetic document pages.'
            }
            actions={<Badge tone="warning">Synthetic content</Badge>}
          />
          {detailBusy && <Feedback kind="loading" title="Loading document details" />}
          {detailError && (
            <DocumentError
              error={detailError}
              onRetry={selected ? () => void openDocument(selected) : undefined}
            />
          )}
          {document && view === 'detail' && (
            <Panel title="Document details">
              <div className="document-description">
                <div className="document-detail-icon" aria-hidden="true">
                  ▤
                </div>
                <div>
                  <Badge>
                    {document.category === 'training-alerts' ? 'Training alert' : document.category}
                  </Badge>
                  {document.isNew && <Badge tone="accent">New</Badge>}
                  <p>{document.description}</p>
                </div>
              </div>
              <DocumentMetadata document={document} />
              <div className="document-detail-footer">
                <Button disabled={!document.pages.length} onClick={() => setView('viewer')}>
                  View document pages <span aria-hidden="true">↗</span>
                </Button>
                <span>
                  {document.pageCount} {document.pageCount === 1 ? 'page' : 'pages'} · Synthetic
                  page images
                </span>
              </div>
            </Panel>
          )}
          {document && view === 'viewer' && (
            <Panel>
              <DocumentViewer key={document.id} document={document} />
            </Panel>
          )}
        </>
      )}
      <p className="app-footnote">
        Local proof of concept · Original workflow uses page images · Synthetic backend and
        documents
      </p>
    </>
  );

  return (
    <div
      className={`communications-app${presentation === 'pos' ? ' communications-app--pos' : ''}`}
      ref={region}
    >
      <PosCommunicationsFrame
        pos={presentation === 'pos'}
        commands={posCommands}
        onCommand={handlePosCommand}
        division={session.division}
        store={session.store}
      >
        {presentation === 'pos' && posScreen === 'menu' && (
          <PosCommunicationMenu
            commands={posCommands}
            loading={menuBusy}
            error={menuError}
            onRetry={() => void loadMenu()}
            onCommand={handlePosCommand}
          />
        )}
        {presentation === 'pos' && posScreen === 'exit' && (
          <PosExitScreen onReturn={() => handlePosCommand('communication-menu')} />
        )}
        <div
          key="communications-journey"
          className="communications-journey"
          hidden={presentation === 'pos' && posScreen !== 'communications'}
        >
          {documentContent}
        </div>
      </PosCommunicationsFrame>
    </div>
  );
}
