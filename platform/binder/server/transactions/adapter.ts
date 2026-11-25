import { randomUUID } from 'node:crypto';
import type {
  Receipt,
  Session,
  TransactionDetail,
  TransactionQuery,
  TransactionResults,
  TransactionSummary,
} from '../../../contracts/index.ts';
import { requireDivision } from '../../../bobbin/server/authorization.ts';
import { RuntimeError } from '../../../bobbin/server/errors.ts';
import type { UpstreamTransport } from '../adapters/upstream.ts';
import type { LegacySummary, LegacyTransactionData } from './legacy-contract.ts';
import { transactionKey } from './legacy-contract.ts';

function invalidUpstream(): never {
  throw new RuntimeError(
    502,
    'UPSTREAM_INVALID_RESPONSE',
    'Transaction History received an invalid synthetic legacy response.',
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function identifier(value: unknown, maxDigits = 20): value is string {
  return typeof value === 'string' && /^\d+$/.test(value) && value.length <= maxDigits;
}
function decimal(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d{1,12}\.\d{2}$/.test(value);
}
function cents(value: string) {
  return BigInt(value.replace('.', ''));
}

export function actualDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 2000 &&
    year <= 2099 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
function fromLegacyDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return invalidUpstream();
  const [month, day, year] = value.split('/');
  const result = `${year}-${month}-${day}`;
  if (!actualDate(result)) return invalidUpstream();
  return result;
}
function toLegacyDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${month}/${day}/${year}`;
}

function summary(value: unknown): TransactionSummary {
  if (
    !object(value) ||
    !identifier(value.divNum, 2) ||
    value.divNum.length !== 2 ||
    !identifier(value.storeNumber, 10) ||
    !identifier(value.registerNumber, 5) ||
    !identifier(value.transactionNumber, 5) ||
    !identifier(value.associateNumber) ||
    !decimal(value.transTotal) ||
    !Number.isInteger(value.transactionType) ||
    !Number.isInteger(value.transactionCode) ||
    !Number.isInteger(value.transVoidTypeCode) ||
    !Number.isInteger(value.transOriginCode)
  )
    return invalidUpstream();
  const date = fromLegacyDate(value.gregDate);
  const row = value as unknown as LegacySummary;
  return {
    id: transactionKey(row),
    division: row.divNum,
    date,
    store: row.storeNumber,
    register: row.registerNumber,
    number: row.transactionNumber,
    associate: row.associateNumber,
    kind: row.transactionType === 2 ? 'Return' : row.transactionType === 1 ? 'Sale' : 'Transaction',
    total: row.transTotal,
    currency: 'USD',
  };
}

function authorizeIdentity(session: Session, id: string) {
  const match = /^(\d{2})-(\d{8})-(\d{1,10})-(\d{1,5})-(\d{1,5})$/.exec(id);
  if (!match)
    throw new RuntimeError(
      404,
      'TRANSACTION_NOT_FOUND',
      'That synthetic transaction was not found.',
    );
  requireDivision(session, match[1]);
}

function detail(
  value: unknown,
  session: Session,
  id: string,
): { model: TransactionDetail; raw: LegacyTransactionData } {
  if (
    !object(value) ||
    !object(value.summary) ||
    !Array.isArray(value.transactionDetails) ||
    !object(value.feeTotals) ||
    !object(value.receiptOutput) ||
    !Array.isArray(value.transactionHistory)
  )
    return invalidUpstream();
  const base = summary(value.summary);
  if (base.id !== id || base.division !== session.division) return invalidUpstream();
  if (!decimal(value.feeTotals.merchandiseAmount) || !decimal(value.feeTotals.taxAmount))
    return invalidUpstream();
  const items = value.transactionDetails.map((item) => {
    if (
      !object(item) ||
      !identifier(item.upcNumber) ||
      !text(item.itemDescription) ||
      !Number.isInteger(item.unitCount) ||
      !decimal(item.unitRetail) ||
      !decimal(item.extendedRetail)
    )
      return invalidUpstream();
    const quantity = item.unitCount as number;
    if (cents(item.unitRetail) * BigInt(quantity) !== cents(item.extendedRetail))
      return invalidUpstream();
    return {
      upc: item.upcNumber,
      description: item.itemDescription,
      quantity,
      unitPrice: item.unitRetail,
      lineTotal: item.extendedRetail,
    };
  });
  const subtotal = value.feeTotals.merchandiseAmount;
  const tax = value.feeTotals.taxAmount;
  if (
    items.reduce((sum, item) => sum + cents(item.lineTotal), 0n) !== cents(subtotal) ||
    cents(subtotal) + cents(tax) !== cents(base.total)
  )
    return invalidUpstream();
  const receiptOutput = value.receiptOutput;
  if (
    !['DCR', 'ERCPT'].every(
      (key) =>
        Array.isArray(receiptOutput[key]) &&
        (receiptOutput[key] as unknown[]).every((line) => typeof line === 'string'),
    )
  )
    return invalidUpstream();
  const history = value.transactionHistory.map((event) => {
    if (
      !object(event) ||
      !text(event.tranCodeStr) ||
      !text(event.description) ||
      typeof event.tranTime !== 'string' ||
      !/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(event.tranTime)
    )
      return invalidUpstream();
    const at = `${fromLegacyDate(event.tranDate)}T${event.tranTime.slice(0, 2)}:${event.tranTime.slice(2, 4)}:${event.tranTime.slice(4)}Z`;
    return { at, event: event.tranCodeStr, description: event.description };
  });
  return {
    model: { ...base, items, subtotal, tax, history, receiptVariants: ['dcr', 'electronic'] },
    raw: value as unknown as LegacyTransactionData,
  };
}

export function createTransactionAdapter(upstream: UpstreamTransport) {
  async function retrieve(session: Session, id: string, requestId: string) {
    authorizeIdentity(session, id);
    const response = await upstream.call('transactions.detail', { requestId, params: { id } });
    if (!object(response) || !('transactionData' in response)) return invalidUpstream();
    if (response.transactionData === null)
      throw new RuntimeError(
        404,
        'TRANSACTION_NOT_FOUND',
        'That synthetic transaction was not found.',
      );
    return detail(response.transactionData, session, id);
  }
  return {
    async query(
      session: Session,
      input: TransactionQuery,
      requestId: string,
    ): Promise<TransactionResults> {
      const fields: Record<string, string> = {};
      if (input.mode !== 'upc-date' && input.mode !== 'upc-store-date')
        fields.mode = 'Choose a supported search mode.';
      if (input.mode === 'upc-date' && Object.hasOwn(input.criteria, 'store')) {
        throw new RuntimeError(
          400,
          'INVALID_REQUEST',
          'Store is only supported by the UPC, store and date search mode.',
        );
      }
      if (input.mode === 'upc-store-date' && input.criteria.store === undefined)
        fields.store = 'Choose a store for this search mode.';
      if (!actualDate(input.criteria.fromDate))
        fields.fromDate = 'Enter a real date between 2000 and 2099.';
      if (!actualDate(input.criteria.toDate))
        fields.toDate = 'Enter a real date between 2000 and 2099.';
      if (!fields.fromDate && !fields.toDate && input.criteria.fromDate > input.criteria.toDate)
        fields.toDate = 'The end date must be on or after the start date.';
      if (Object.keys(fields).length)
        throw new RuntimeError(
          422,
          'VALIDATION_ERROR',
          'Check the transaction search fields.',
          fields,
        );
      const response = await upstream.call('transactions.query', {
        requestId,
        body: {
          opt: input.mode === 'upc-store-date' ? 'upcwkstr' : 'upcwk',
          ...(input.mode === 'upc-store-date' ? { storeNumber: input.criteria.store } : {}),
          divNumber: session.division,
          upc: input.criteria.upc,
          week: toLegacyDate(input.criteria.fromDate),
          endingWeek: toLegacyDate(input.criteria.toDate),
        },
      });
      if (!object(response) || !Array.isArray(response.rows)) return invalidUpstream();
      const rows = response.rows.map(summary);
      if (
        rows.some(
          (row) =>
            row.division !== session.division ||
            row.date < input.criteria.fromDate ||
            row.date > input.criteria.toDate ||
            (input.mode === 'upc-store-date' && row.store !== input.criteria.store),
        )
      )
        return invalidUpstream();
      const unique = [...new Map(rows.map((row) => [row.id, row])).values()].sort(
        (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
      );
      const truncated = unique.length > 250;
      return {
        items: unique.slice(0, 250),
        queryId: `query-${randomUUID()}`,
        totalMatches: unique.length,
        limit: 250,
        truncated,
        warnings: truncated
          ? [
              'More than 250 transactions match. Narrow the date range to see a complete result set.',
            ]
          : [],
      };
    },
    async detail(session: Session, id: string, requestId: string): Promise<TransactionDetail> {
      return (await retrieve(session, id, requestId)).model;
    },
    async receipt(
      session: Session,
      id: string,
      variant: string,
      requestId: string,
    ): Promise<Receipt> {
      authorizeIdentity(session, id);
      if (variant !== 'dcr' && variant !== 'electronic')
        throw new RuntimeError(
          404,
          'RECEIPT_NOT_FOUND',
          'That synthetic receipt variant is not available.',
        );
      const { model, raw } = await retrieve(session, id, requestId);
      return {
        transactionId: id,
        variant,
        title: variant === 'dcr' ? 'Transaction receipt' : 'Electronic journal receipt',
        lines: raw.receiptOutput[variant === 'dcr' ? 'DCR' : 'ERCPT'].map((line) => {
          const separator = line.indexOf(':');
          return {
            label: separator < 0 ? 'Receipt' : line.slice(0, separator).trim(),
            value: line.slice(separator + 1).trim(),
          };
        }),
        items: model.items,
        subtotal: model.subtotal,
        tax: model.tax,
        total: model.total,
        currency: model.currency,
        synthetic: true,
      };
    },
  };
}
