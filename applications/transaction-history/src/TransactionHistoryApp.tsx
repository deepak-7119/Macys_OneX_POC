import React, { useEffect, useId, useRef, useState } from 'react';
import type {
  AppProps,
  FieldSpec,
  QueryMode,
  Receipt,
  TransactionDetail,
  TransactionQuery,
  TransactionResults,
  TransactionSummary,
} from '../../../platform/contracts/index.ts';
import { api, ApiError, operationPath } from '../../../platform/spool/src/client.ts';
import {
  BackButton,
  Badge,
  Button,
  ContextBar,
  DataTable,
  Feedback,
  PageHeader,
  Panel,
  QueryForm,
  RequestError,
  ResultsSummary,
  Tabs,
  money,
} from '../../../platform/thread/src/index.tsx';

export interface TransactionUiError {
  message: string;
  code?: string;
  requestId?: string;
  fields?: Record<string, string>;
}
interface SearchState {
  values: Record<string, string>;
  results?: TransactionResults;
  error?: TransactionUiError;
  busy: boolean;
  submitted?: Record<string, string>;
}
type View = 'search' | 'detail' | 'receipt';

const defaults: Record<string, string> = {
  upc: '000123456789',
  fromDate: '2026-11-01',
  toDate: '2026-11-14',
};

export function initialQueryValues(fields: FieldSpec[]): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      defaults[field.name] ??
        (field.type === 'select' && field.required ? (field.options?.[0]?.value ?? '') : ''),
    ]),
  );
}

export function toTransactionUiError(error: unknown): TransactionUiError {
  return error instanceof ApiError
    ? {
        message: error.detail.message,
        code: error.detail.code,
        requestId: error.detail.requestId,
        fields: error.detail.fields,
      }
    : { message: 'The local service could not complete this request. Please try again.' };
}

export function TransactionError({
  error,
  fields = [],
  onRetry,
}: {
  error: TransactionUiError;
  fields?: FieldSpec[];
  onRetry?: () => void;
}) {
  const labelFor = (name: string) => fields.find((field) => field.name === name)?.label ?? name;
  const details = Object.entries(error.fields ?? {})
    .map(([name, message]) => `${labelFor(name)}: ${message}`)
    .join(' ');
  return (
    <RequestError
      title="Request could not be completed"
      message={`${error.message}${details ? ` ${details}` : ''}`}
      code={error.code}
      requestId={error.requestId}
      onRetry={onRetry}
    />
  );
}

export function TransactionItems({
  detail,
}: {
  detail: Pick<TransactionDetail, 'items' | 'currency'>;
}) {
  return (
    <DataTable
      rows={detail.items.map((item, index) => ({ ...item, id: `${item.upc}-${index}` }))}
      columns={[
        { key: 'description', label: 'Item' },
        { key: 'upc', label: 'UPC' },
        { key: 'quantity', label: 'Qty' },
        {
          key: 'unitPrice',
          label: 'Unit price',
          render: (item) => money(item.unitPrice, detail.currency),
        },
        {
          key: 'lineTotal',
          label: 'Amount',
          render: (item) => money(item.lineTotal, detail.currency),
        },
      ]}
      emptyMessage="No item lines were returned for this transaction."
    />
  );
}

export function ReceiptView({ receipt }: { receipt: Receipt }) {
  return (
    <article className="receipt" aria-label="Synthetic receipt">
      <div className="receipt-heading">
        <span className="receipt-star" aria-hidden="true">
          ✦
        </span>
        <h2>{receipt.title}</h2>
        <p className="receipt-subtitle">SYNTHETIC RECEIPT · LOCAL DEMONSTRATION</p>
      </div>
      <hr className="receipt-divider" />
      {receipt.lines.map((line, index) => (
        <div className="receipt-row" key={`${line.label}-${index}`}>
          <span>{line.label}</span>
          <span>{line.value}</span>
        </div>
      ))}
      <hr className="receipt-divider" />
      <table className="receipt-table">
        <caption className="sr-only">Receipt item lines</caption>
        <thead>
          <tr>
            <th scope="col">Item / UPC</th>
            <th scope="col">Qty</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((item, index) => (
            <tr key={`${item.upc}-${index}`}>
              <td>
                {item.description}
                <br />
                <span className="muted">{item.upc}</span>
              </td>
              <td>{item.quantity}</td>
              <td>{money(item.lineTotal, receipt.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr className="receipt-divider" />
      <div className="receipt-row">
        <span>Subtotal</span>
        <span>{money(receipt.subtotal, receipt.currency)}</span>
      </div>
      <div className="receipt-row">
        <span>Tax</span>
        <span>{money(receipt.tax, receipt.currency)}</span>
      </div>
      <div className="receipt-row receipt-total">
        <span>Total</span>
        <span>{money(receipt.total, receipt.currency)}</span>
      </div>
      <p className="receipt-bottom">
        Invented transaction data. Not proof of purchase.
        <br />
        No payment or receipt delivery is performed.
      </p>
    </article>
  );
}

export default function Application({ manifest, session }: AppProps) {
  const modes = manifest.searchModes ?? [];
  const [modeId, setModeId] = useState(modes[0]?.id ?? '');
  const activeMode = modes.find((mode) => mode.id === modeId) ?? modes[0];
  const [searches, setSearches] = useState<Record<string, SearchState>>(() =>
    Object.fromEntries(
      modes.map((mode) => [mode.id, { values: initialQueryValues(mode.fields), busy: false }]),
    ),
  );
  const [view, setView] = useState<View>('search');
  const [selected, setSelected] = useState<TransactionSummary | null>(null);
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<TransactionUiError>();
  const [detailTab, setDetailTab] = useState('summary');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState<TransactionUiError>();
  const [receiptVariant, setReceiptVariant] = useState('');
  const region = useRef<HTMLDivElement>(null);
  const componentId = useId();
  const queryTabsId = `${componentId}-query`;
  const detailTabsId = `${componentId}-detail`;
  const receiptTabsId = `${componentId}-receipt`;
  const activeModeRef = useRef(modeId);
  const queries = useRef(new Map<string, AbortController>());
  const detailRequest = useRef<AbortController | null>(null);
  const receiptRequest = useRef<AbortController | null>(null);
  activeModeRef.current = modeId;

  useEffect(
    () => () => {
      for (const controller of queries.current.values()) controller.abort();
      detailRequest.current?.abort();
      receiptRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const selectedRow =
      view === 'search'
        ? region.current?.querySelector<HTMLButtonElement>(
            '.thread-row-action[aria-current="true"]',
          )
        : null;
    (selectedRow ?? region.current?.querySelector<HTMLHeadingElement>('h1'))?.focus({
      preventScroll: true,
    });
  }, [view]);

  function updateSearch(id: string, changes: Partial<SearchState>) {
    setSearches((current) => ({ ...current, [id]: { ...current[id], ...changes } }));
  }

  async function openTransaction(row: TransactionSummary) {
    detailRequest.current?.abort();
    receiptRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setSelected(row);
    setDetail(null);
    setDetailBusy(true);
    setDetailError(undefined);
    setDetailTab('summary');
    setReceipt(null);
    setReceiptError(undefined);
    setReceiptBusy(false);
    setReceiptVariant('');
    setView('detail');
    try {
      const data = await api<TransactionDetail>(operationPath(manifest, 'detail', { id: row.id }), {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setDetail(data);
        setReceiptVariant(data.receiptVariants[0] ?? '');
      }
    } catch (error) {
      if (!controller.signal.aborted) setDetailError(toTransactionUiError(error));
    } finally {
      if (!controller.signal.aborted) setDetailBusy(false);
    }
  }

  async function search(mode: QueryMode | undefined = activeMode) {
    if (!mode) return;
    queries.current.get(mode.id)?.abort();
    const controller = new AbortController();
    queries.current.set(mode.id, controller);
    const values = { ...searches[mode.id]?.values };
    const criteria: TransactionQuery['criteria'] = {
      upc: values.upc ?? '',
      fromDate: values.fromDate ?? '',
      toDate: values.toDate ?? '',
    };
    if (mode.fields.some((field) => field.name === 'store') && values.store)
      criteria.store = values.store;
    updateSearch(mode.id, { busy: true, error: undefined, results: undefined, submitted: values });
    try {
      const result = await api<TransactionResults>(operationPath(manifest, 'query'), {
        method: 'POST',
        body: JSON.stringify({ mode: mode.id, criteria } satisfies TransactionQuery),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      updateSearch(mode.id, { results: result });
      if (result.items.length === 1 && !result.truncated && activeModeRef.current === mode.id)
        await openTransaction(result.items[0]);
    } catch (error) {
      if (!controller.signal.aborted) updateSearch(mode.id, { error: toTransactionUiError(error) });
    } finally {
      if (!controller.signal.aborted) updateSearch(mode.id, { busy: false });
    }
  }

  async function openReceipt(variant: string) {
    if (!detail || !variant) return;
    receiptRequest.current?.abort();
    const controller = new AbortController();
    receiptRequest.current = controller;
    setReceiptVariant(variant);
    setReceipt(null);
    setReceiptError(undefined);
    setReceiptBusy(true);
    setView('receipt');
    try {
      const data = await api<Receipt>(
        operationPath(manifest, 'receipt', { id: detail.id, variant }),
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setReceipt(data);
    } catch (error) {
      if (!controller.signal.aborted) setReceiptError(toTransactionUiError(error));
    } finally {
      if (!controller.signal.aborted) setReceiptBusy(false);
    }
  }

  function backToResults() {
    detailRequest.current?.abort();
    receiptRequest.current?.abort();
    setView('search');
  }

  if (!activeMode)
    return (
      <Feedback
        kind="error"
        title="Search configuration unavailable"
        message="This application has no configured search modes."
      />
    );
  const state = searches[activeMode.id] ?? {
    values: initialQueryValues(activeMode.fields),
    busy: false,
  };
  const transactionColumns = [
    { key: 'number', label: 'Transaction' },
    { key: 'date', label: 'Date' },
    { key: 'store', label: 'Store' },
    { key: 'register', label: 'Register' },
    { key: 'kind', label: 'Type' },
    {
      key: 'total',
      label: 'Total',
      render: (row: TransactionSummary) => money(row.total, row.currency),
    },
  ];
  const variantLabel = (variant: string) =>
    variant === 'dcr' ? 'DCR receipt' : variant === 'electronic' ? 'Electronic receipt' : variant;

  return (
    <div className="transaction-app" ref={region}>
      {view === 'search' ? (
        <>
          <PageHeader
            eyebrow={manifest.eyebrow}
            title={manifest.name}
            description="Find a transaction, review its details, and view a synthetic receipt."
            actions={<Badge tone="accent">Sales & service</Badge>}
          />
          <ContextBar
            trailing={
              <>
                Division {session.division} · Store {session.store}
              </>
            }
          >
            All transactions are invented for this local demonstration.
          </ContextBar>
          <Panel title="Find a transaction">
            <Tabs
              idPrefix={queryTabsId}
              label="Transaction search modes"
              items={modes.map((mode) => ({ id: mode.id, label: mode.label }))}
              active={activeMode.id}
              onChange={(id) => {
                activeModeRef.current = id;
                setModeId(id);
              }}
            />
            {modes.map((mode) => (
              <div
                key={mode.id}
                id={`${queryTabsId}-panel-${mode.id}`}
                role="tabpanel"
                aria-labelledby={`${queryTabsId}-tab-${mode.id}`}
                hidden={activeMode.id !== mode.id}
              >
                {activeMode.id === mode.id && (
                  <>
                    <QueryForm
                      fields={mode.fields}
                      values={state.values}
                      onChange={(name, value) =>
                        updateSearch(mode.id, { values: { ...state.values, [name]: value } })
                      }
                      onSubmit={() => void search(mode)}
                      busy={state.busy}
                      submitLabel="Find transactions"
                    />
                    <p className="form-help">
                      Enter a UPC and date range. Results use the division and access of your local
                      profile.
                    </p>
                  </>
                )}
              </div>
            ))}
          </Panel>
          {state.error && (
            <TransactionError
              error={state.error}
              fields={activeMode.fields}
              onRetry={() => void search()}
            />
          )}
          {state.busy && (
            <Feedback
              kind="loading"
              title="Finding transactions"
              message="Searching the synthetic transaction service…"
            />
          )}
          {!state.busy && state.results && (
            <Panel>
              <div className="table-toolbar">
                <div>
                  <h2>
                    Search results <Badge>{state.results.items.length}</Badge>
                  </h2>
                  <p className="results-caption">
                    {state.submitted?.upc} · {state.submitted?.fromDate} to{' '}
                    {state.submitted?.toDate}
                  </p>
                </div>
                <span className="results-caption">Select a transaction to view details</span>
              </div>
              {state.results.truncated && (
                <Feedback
                  kind="info"
                  title={`Showing the first ${state.results.limit} of ${state.results.totalMatches} matches`}
                  message="Narrow the date range or refine your search to see a smaller result set."
                />
              )}
              {state.results.warnings.map((warning, index) => (
                <p className="result-warning" role="status" key={index}>
                  {warning}
                </p>
              ))}
              <DataTable
                rows={state.results.items}
                columns={transactionColumns}
                onRowClick={(row) => void openTransaction(row)}
                selectedId={selected?.id}
                emptyMessage="No transactions matched this search."
              />
              {state.results.items.length > 0 && (
                <ResultsSummary
                  start={
                    <>
                      {state.results.items.length} displayed · {state.results.totalMatches} total
                      matches
                    </>
                  }
                  end={<>All amounts in {state.results.items[0].currency}</>}
                />
              )}
            </Panel>
          )}
          {!state.busy && !state.results && !state.error && (
            <div className="search-introduction">
              <span className="search-introduction__icon" aria-hidden="true">
                ⌕
              </span>
              <h2>A transaction starts with a search.</h2>
              <p>
                Use the example UPC above to explore matching transactions.
                <br />
                The date range is ready for the local fixture.
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <BackButton
            onClick={
              view === 'receipt'
                ? () => {
                    receiptRequest.current?.abort();
                    setView('detail');
                  }
                : backToResults
            }
          >
            ← {view === 'receipt' ? 'Back to transaction' : 'Back to results'}
          </BackButton>
          <PageHeader
            eyebrow={view === 'receipt' ? 'SYNTHETIC RECEIPT' : 'TRANSACTION DETAILS'}
            title={
              view === 'receipt'
                ? 'View receipt'
                : `Transaction ${detail?.number ?? selected?.number ?? ''}`
            }
            description={
              detail
                ? `${detail.date} · Division ${detail.division} · Store ${detail.store} · Register ${detail.register}`
                : 'Loading the selected synthetic transaction.'
            }
            actions={<Badge tone="warning">Synthetic data</Badge>}
          />
          {view === 'detail' && (
            <>
              {detailBusy && <Feedback kind="loading" title="Loading transaction details" />}
              {detailError && (
                <TransactionError
                  error={detailError}
                  onRetry={selected ? () => void openTransaction(selected) : undefined}
                />
              )}
              {detail && (
                <>
                  <div className="transaction-summary-strip">
                    <div>
                      <span className="summary-caption">Transaction total</span>
                      <strong>{money(detail.total, detail.currency)}</strong>
                    </div>
                    <div>
                      <span className="summary-caption">Transaction type</span>
                      <Badge tone="success">{detail.kind}</Badge>
                    </div>
                    <div>
                      <span className="summary-caption">Associate</span>
                      <span>{detail.associate}</span>
                    </div>
                    <Button
                      variant="primary"
                      disabled={!detail.receiptVariants.length}
                      onClick={() => void openReceipt(receiptVariant || detail.receiptVariants[0])}
                    >
                      View synthetic receipt <span aria-hidden="true">↗</span>
                    </Button>
                  </div>
                  <Panel>
                    <Tabs
                      idPrefix={detailTabsId}
                      label="Transaction detail views"
                      items={[
                        { id: 'summary', label: 'Transaction summary' },
                        { id: 'history', label: 'History' },
                      ]}
                      active={detailTab}
                      onChange={setDetailTab}
                    />
                    <div
                      id={`${detailTabsId}-panel-summary`}
                      role="tabpanel"
                      aria-labelledby={`${detailTabsId}-tab-summary`}
                      hidden={detailTab !== 'summary'}
                    >
                      <TransactionItems detail={detail} />
                      <dl className="transaction-totals">
                        <div>
                          <dt>Subtotal</dt>
                          <dd>{money(detail.subtotal, detail.currency)}</dd>
                        </div>
                        <div>
                          <dt>Tax</dt>
                          <dd>{money(detail.tax, detail.currency)}</dd>
                        </div>
                        <div className="is-total">
                          <dt>Total</dt>
                          <dd>{money(detail.total, detail.currency)}</dd>
                        </div>
                      </dl>
                    </div>
                    <div
                      id={`${detailTabsId}-panel-history`}
                      role="tabpanel"
                      aria-labelledby={`${detailTabsId}-tab-history`}
                      hidden={detailTab !== 'history'}
                    >
                      {detail.history.length ? (
                        <ol className="history-list">
                          {detail.history.map((event, index) => (
                            <li key={`${event.at}-${index}`}>
                              <time dateTime={event.at}>{event.at}</time>
                              <h3>{event.event}</h3>
                              <p>{event.description}</p>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <Feedback
                          kind="empty"
                          title="No history was returned for this transaction."
                        />
                      )}
                    </div>
                  </Panel>
                </>
              )}
            </>
          )}
          {view === 'receipt' && detail && (
            <>
              <Panel>
                <div className="receipt-options">
                  <div>
                    <h2>Receipt view</h2>
                    <p>
                      Fetched from the local synthetic receipt service. No delivery or payment
                      actions.
                    </p>
                  </div>
                  <Badge>Read only</Badge>
                </div>
                <Tabs
                  idPrefix={receiptTabsId}
                  label="Receipt format"
                  items={detail.receiptVariants.map((variant) => ({
                    id: variant,
                    label: variantLabel(variant),
                  }))}
                  active={receiptVariant}
                  onChange={(variant) => void openReceipt(variant)}
                />
                {detail.receiptVariants.map((variant) => (
                  <div
                    key={variant}
                    id={`${receiptTabsId}-panel-${variant}`}
                    role="tabpanel"
                    aria-labelledby={`${receiptTabsId}-tab-${variant}`}
                    hidden={receiptVariant !== variant}
                  >
                    {receiptVariant === variant && (
                      <>
                        {receiptBusy && (
                          <Feedback kind="loading" title="Loading synthetic receipt" />
                        )}
                        {receiptError && (
                          <TransactionError
                            error={receiptError}
                            onRetry={() => void openReceipt(receiptVariant)}
                          />
                        )}
                        {receipt && (
                          <div className="receipt-stage">
                            <ReceiptView receipt={receipt} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </Panel>
            </>
          )}
        </>
      )}
      <p className="app-footnote">
        Local proof of concept · Source-informed workflow · Synthetic backend and data
      </p>
    </div>
  );
}
