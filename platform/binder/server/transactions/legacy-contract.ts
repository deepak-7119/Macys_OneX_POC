/** Synthetic service DTOs shaped around the supplied Java receipt-builder models.
 * These are not claimed to be an existing Macy's HTTP API or Oracle schema. */
export interface LegacySummary {
  divNum: string;
  gregDate: string;
  storeNumber: string;
  registerNumber: string;
  transactionNumber: string;
  associateNumber: string;
  transactionType: number;
  transactionCode: number;
  transVoidTypeCode: number;
  transOriginCode: number;
  transTotal: string;
}
export interface LegacyTransactionData {
  summary: LegacySummary;
  transactionDetails: Array<{
    upcNumber: string;
    itemDescription: string;
    unitCount: number;
    unitRetail: string;
    extendedRetail: string;
  }>;
  feeTotals: { merchandiseAmount: string; taxAmount: string };
  receiptOutput: { DCR: string[]; ERCPT: string[] };
  transactionHistory: Array<{
    tranDate: string;
    tranTime: string;
    tranCodeStr: string;
    description: string;
  }>;
}

interface LegacyQueryCriteria {
  divNumber: string;
  upc: string;
  week: string;
  endingWeek: string;
}

export type LegacyQuery = LegacyQueryCriteria &
  (
    | { opt: 'upcwk'; storeNumber?: never }
    // upcwkstr is the supplied Java action; storeNumber is already resolved from its storeDns input.
    | { opt: 'upcwkstr'; storeNumber: string }
  );

export function transactionKey(row: LegacySummary): string {
  const [month, day, year] = row.gregDate.split('/');
  return [
    row.divNum,
    `${year}${month}${day}`,
    row.storeNumber,
    row.registerNumber,
    row.transactionNumber,
  ].join('-');
}
