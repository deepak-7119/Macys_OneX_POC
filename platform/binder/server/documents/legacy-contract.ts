/** Synthetic DTOs follow DocumentData/DocumentListInput in the supplied SmartComm source.
 * Calendar values are serialized as ISO dates. These are not existing enterprise HTTP APIs. */
export interface LegacyDocumentData {
  createDate: string;
  divisionNbr: string;
  docType: number;
  documentId: string;
  documentName: string;
  effectiveDate: string;
  endDate: string | null;
  fobArray: string[];
  metaDataArray: Array<{ docId: string; fieldName: string; value: string }>;
  pageCount: number;
  storeArray: string[];
}
export interface LegacyDocumentListInput {
  checkEffectiveDate: true;
  divisionNbr: string;
  docType: 1;
  storeNbr: string;
  checkFOB: true;
}
/** Deliberately plain text, not an executable SVG or a remotely chosen URL. */
export interface SyntheticDocImage {
  format: 'synthetic-page-v1';
  documentId: string;
  pageNumber: number;
  pageCount: number;
  title: string;
  paragraphs: string[];
}
