import type {
  DocumentDetail,
  DocumentResults,
  DocumentSummary,
  Session,
} from '../../../contracts/index.ts';
import { RuntimeError } from '../../../bobbin/server/errors.ts';
import type { UpstreamTransport } from '../adapters/upstream.ts';
import type { LegacyDocumentData, SyntheticDocImage } from './legacy-contract.ts';
import { DOCUMENT_FIXTURE_DATE } from './policy.ts';
import { renderDocumentPage } from './page.ts';

function invalid(): never {
  throw new RuntimeError(
    502,
    'UPSTREAM_INVALID_RESPONSE',
    'Associate Communications received an invalid synthetic legacy response.',
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function plain(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value)
  );
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,10}$/.test(value);
}
function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)
  )
    return invalid();
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  const timestamp = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day ||
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString().slice(0, 10) !== day
  )
    return invalid();
  return day;
}

function metadata(value: unknown): LegacyDocumentData {
  if (
    !object(value) ||
    !identifier(value.documentId) ||
    !identifier(value.divisionNbr) ||
    !plain(value.documentName, 120) ||
    !Number.isInteger(value.docType) ||
    !Number.isInteger(value.pageCount) ||
    (value.pageCount as number) < 1 ||
    (value.pageCount as number) > 200 ||
    !Array.isArray(value.fobArray) ||
    value.fobArray.some((group) => !plain(group, 60)) ||
    !Array.isArray(value.storeArray) ||
    value.storeArray.some((store) => !identifier(store)) ||
    !Array.isArray(value.metaDataArray)
  )
    return invalid();
  const effectiveDate = date(value.effectiveDate);
  const endDate = value.endDate === null ? null : date(value.endDate);
  if (endDate !== null && endDate < effectiveDate) return invalid();
  const createDate = date(value.createDate);
  const id = value.documentId;
  for (const field of value.metaDataArray) {
    if (
      !object(field) ||
      field.docId !== id ||
      !plain(field.fieldName, 60) ||
      !plain(field.value, 1000)
    )
      return invalid();
  }
  return { ...value, createDate, effectiveDate, endDate } as unknown as LegacyDocumentData;
}
function eligible(record: LegacyDocumentData, session: Session): boolean {
  return (
    record.docType === 1 &&
    record.divisionNbr === session.division &&
    (record.storeArray.includes(session.store) || record.storeArray.includes('9999')) &&
    record.effectiveDate <= DOCUMENT_FIXTURE_DATE &&
    (record.endDate === null || record.endDate >= DOCUMENT_FIXTURE_DATE)
  );
}
function publicId(record: LegacyDocumentData) {
  return `ac-${record.documentId}`;
}
function legacyId(id: string) {
  const match = /^ac-(\d{1,10})$/.exec(id);
  if (!match)
    throw new RuntimeError(404, 'DOCUMENT_NOT_FOUND', 'That synthetic document was not found.');
  return match[1];
}
function summary(record: LegacyDocumentData): DocumentSummary {
  const age =
    (Date.parse(`${DOCUMENT_FIXTURE_DATE}T00:00:00Z`) -
      Date.parse(`${record.effectiveDate}T00:00:00Z`)) /
    86400000;
  return {
    id: publicId(record),
    title: record.documentName,
    groups: record.fobArray,
    validFrom: record.effectiveDate,
    validTo: record.endDate ?? '',
    isNew: age >= 0 && age <= 2,
    pageCount: record.pageCount,
    category: 'training-alerts',
  };
}
function pageModel(value: unknown, record: LegacyDocumentData, page: number): SyntheticDocImage {
  const keys = ['format', 'documentId', 'pageNumber', 'pageCount', 'title', 'paragraphs'];
  if (
    !object(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.format !== 'synthetic-page-v1' ||
    value.documentId !== record.documentId ||
    value.pageNumber !== page ||
    value.pageCount !== record.pageCount ||
    !plain(value.title, 120) ||
    !Array.isArray(value.paragraphs) ||
    value.paragraphs.length < 1 ||
    value.paragraphs.length > 6 ||
    value.paragraphs.some((paragraph) => !plain(paragraph, 350)) ||
    value.paragraphs.reduce((length, paragraph) => length + String(paragraph).length, 0) > 1800
  )
    return invalid();
  return value as unknown as SyntheticDocImage;
}

export function createDocumentAdapter(upstream: UpstreamTransport) {
  async function retrieve(session: Session, id: string, requestId: string) {
    const sourceId = legacyId(id);
    const response = await upstream.call('documents.detail', {
      requestId,
      params: { id: sourceId },
    });
    if (!object(response) || !('documentData' in response)) return invalid();
    if (response.documentData === null)
      throw new RuntimeError(404, 'DOCUMENT_NOT_FOUND', 'That synthetic document was not found.');
    const record = metadata(response.documentData);
    if (record.documentId !== sourceId) return invalid();
    if (!eligible(record, session))
      throw new RuntimeError(
        403,
        'DOCUMENT_FORBIDDEN',
        'This synthetic document is not eligible for your division, store or fixture date.',
      );
    return record;
  }
  return {
    async list(
      session: Session,
      fob: string | undefined,
      requestId: string,
    ): Promise<DocumentResults> {
      const response = await upstream.call('documents.list', {
        requestId,
        body: {
          checkEffectiveDate: true,
          divisionNbr: session.division,
          docType: 1,
          storeNbr: session.store,
          checkFOB: true,
        },
      });
      if (!object(response) || !Array.isArray(response.documentData)) return invalid();
      const records = response.documentData
        .map(metadata)
        .filter((record) => eligible(record, session))
        .filter((record) => !fob || record.fobArray.includes(fob));
      const rows = [...new Map(records.map((record) => [record.documentId, record])).values()].sort(
        (a, b) =>
          b.effectiveDate.localeCompare(a.effectiveDate) ||
          a.documentName.localeCompare(b.documentName),
      );
      return {
        items: rows.slice(0, 50).map(summary),
        totalMatches: rows.length,
        limit: 50,
        truncated: rows.length > 50,
      };
    },
    async detail(session: Session, id: string, requestId: string): Promise<DocumentDetail> {
      const record = await retrieve(session, id, requestId);
      const description =
        record.metaDataArray.find((field) => field.fieldName === 'Description')?.value ??
        'Synthetic training alert for the Overlock demonstration.';
      return {
        ...summary(record),
        description,
        pages: Array.from({ length: record.pageCount }, (_, index) => ({
          number: index + 1,
          url: `/api/apps/associate-communications/documents/${publicId(record)}/pages/${index + 1}`,
        })),
      };
    },
    async page(session: Session, id: string, page: number, requestId: string): Promise<string> {
      const record = await retrieve(session, id, requestId);
      if (!Number.isInteger(page) || page < 1 || page > record.pageCount)
        throw new RuntimeError(
          404,
          'PAGE_NOT_FOUND',
          'That synthetic document page was not found.',
        );
      const response = await upstream.call('documents.page', {
        requestId,
        params: { id: record.documentId, page: String(page) },
      });
      if (!object(response) || !('docImage' in response)) return invalid();
      if (response.docImage === null)
        throw new RuntimeError(
          404,
          'PAGE_NOT_FOUND',
          'That synthetic document page was not found.',
        );
      return renderDocumentPage(pageModel(response.docImage, record, page), record.documentName);
    },
  };
}
