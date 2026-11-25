import type { FastifyInstance } from 'fastify';
import type { LegacyQuery, LegacyTransactionData } from './legacy-contract.ts';
import { transactionKey } from './legacy-contract.ts';

export const DEFAULT_UPC = '000123456789';
export const SINGLE_UPC = '000999888777';
export const LIMIT_UPC = '000000000250';

function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}

function record(
  number: string,
  date: string,
  store: string,
  upc: string,
  unitCents: number,
  quantity = 1,
  division = '71',
): LegacyTransactionData {
  const subtotal = unitCents * quantity;
  const tax = Math.round((subtotal * 8) / 100);
  const data: LegacyTransactionData = {
    summary: {
      divNum: division,
      gregDate: date,
      storeNumber: store,
      registerNumber: '20',
      transactionNumber: number,
      associateNumber: '9000123',
      transactionType: quantity < 0 ? 2 : 1,
      transactionCode: 1,
      transVoidTypeCode: 0,
      transOriginCode: 1,
      transTotal: money(subtotal + tax),
    },
    transactionDetails: [
      {
        upcNumber: upc,
        itemDescription:
          upc === DEFAULT_UPC
            ? 'Cotton crewneck · synthetic item'
            : 'Seasonal essential · synthetic item',
        unitCount: quantity,
        unitRetail: money(unitCents),
        extendedRetail: money(subtotal),
      },
    ],
    feeTotals: { merchandiseAmount: money(subtotal), taxAmount: money(tax) },
    receiptOutput: {
      DCR: [
        `Store: ${store}`,
        'Register: 20',
        `Transaction: ${number}`,
        `Date: ${date}`,
        'Data: Synthetic transaction',
      ],
      ERCPT: [
        `Channel: Electronic journal`,
        `Store: ${store}`,
        `Transaction: ${number}`,
        'Data: Synthetic transaction',
      ],
    },
    transactionHistory: [
      {
        tranDate: date,
        tranTime: '142300',
        tranCodeStr: quantity < 0 ? 'RETURN' : 'SALE',
        description: 'Synthetic transaction completed at register 20.',
      },
      {
        tranDate: date,
        tranTime: '142301',
        tranCodeStr: 'RECEIPT',
        description: 'Synthetic receipt recorded in the electronic journal.',
      },
    ],
  };
  return data;
}

/** Fixed related fixtures; queries retrieve these records rather than inventing matches. */
export const legacyTransactions: readonly LegacyTransactionData[] = [
  record('70001', '11/12/2026', '1001', DEFAULT_UPC, 2450, 2),
  record('70002', '11/10/2026', '1002', DEFAULT_UPC, 6999),
  record('70003', '11/08/2026', '1001', DEFAULT_UPC, 2450, -1),
  record('70004', '11/01/2026', '1002', DEFAULT_UPC, 1500, 3),
  record('71001', '11/11/2026', '1001', SINGLE_UPC, 3999),
  record('79999', '11/12/2026', '1001', DEFAULT_UPC, 9999, 1, '72'),
  ...Array.from({ length: 251 }, (_, index) =>
    record(
      String(72000 + index),
      '11/10/2026',
      index % 2 ? '1002' : '1001',
      LIMIT_UPC,
      1000 + index,
    ),
  ),
];

function sortableDate(date: string) {
  const [month, day, year] = date.split('/');
  return `${year}-${month}-${day}`;
}

export function registerMockTransactionRoutes(app: FastifyInstance) {
  app.post<{ Body: LegacyQuery }>('/legacy/transactions/query', async (request) => {
    const criteria = request.body;
    const from = sortableDate(criteria.week);
    const to = sortableDate(criteria.endingWeek);
    const rows = legacyTransactions.filter(
      (data) =>
        data.summary.divNum === criteria.divNumber &&
        data.transactionDetails.some((item) => item.upcNumber === criteria.upc) &&
        (criteria.opt !== 'upcwkstr' || data.summary.storeNumber === criteria.storeNumber) &&
        sortableDate(data.summary.gregDate) >= from &&
        sortableDate(data.summary.gregDate) <= to,
    );
    return {
      ok: true,
      service: 'mock-upstream',
      synthetic: true,
      rows: rows.map((data) => data.summary),
    };
  });
  app.get<{ Params: { id: string } }>('/legacy/transactions/:id', async (request) => ({
    ok: true,
    service: 'mock-upstream',
    synthetic: true,
    transactionData:
      legacyTransactions.find((data) => transactionKey(data.summary) === request.params.id) ?? null,
  }));
}
