import type { ThreadActorRole, ThreadComponentReference } from '../thread/inventory/contracts.ts';

export type AppId = 'transaction-history' | 'associate-communications';
export type ProfileId = 'associate' | 'restricted';
export type RuntimeProfile = 'combined' | 'hub' | AppId;
export type NavigationMode = 'embedded' | 'gateway';
export interface Session {
  id: string;
  displayName: string;
  division: string;
  store: string;
  capabilities: string[];
  threadActor?: ThreadActorRole;
  synthetic: true;
}
export interface FieldSpec {
  name: string;
  label: string;
  type: 'text' | 'date' | 'select';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}
export interface QueryMode {
  id: string;
  label: string;
  fields: FieldSpec[];
}
export interface AppManifest {
  id: AppId;
  name: string;
  eyebrow: string;
  description: string;
  icon: 'receipt' | 'book';
  path: string;
  entry: string;
  launchMode: 'session' | 'standalone';
  version: string;
  capability: string;
  operations: Record<string, string>;
  searchModes?: QueryMode[];
  componentRefs: ThreadComponentReference[];
  localComponents: readonly string[];
}
export interface Bootstrap {
  synthetic: true;
  session: Session;
  apps: AppManifest[];
  profiles: Array<{ id: ProfileId; label: string }>;
  runtime: {
    name: string;
    upstream: string;
    contractVersion: string;
    profile: RuntimeProfile;
    navigationMode: NavigationMode;
    orchestration: 'single-spa-root-config';
    hostingMode: 'bobbin-fallback';
    assetDelivery: 'bobbin-bundled' | 'gcp-storage-simulation';
  };
  binder: { name: string; mode: 'mock'; basePath: string; contractVersion: string };
}
export interface AppProps {
  manifest: AppManifest;
  session: Session;
}
export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; fields?: Record<string, string> };
}
export interface TransactionSummary {
  id: string;
  division: string;
  date: string;
  store: string;
  register: string;
  number: string;
  associate: string;
  kind: string;
  total: string;
  currency: string;
}
export interface TransactionItem {
  upc: string;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}
export interface TransactionDetail extends TransactionSummary {
  items: TransactionItem[];
  subtotal: string;
  tax: string;
  receiptVariants: string[];
  history: Array<{ at: string; event: string; description: string }>;
}
export interface TransactionQuery {
  mode: string;
  criteria: { upc: string; fromDate: string; toDate: string; store?: string };
}
export interface TransactionResults {
  items: TransactionSummary[];
  queryId: string;
  totalMatches: number;
  limit: number;
  truncated: boolean;
  warnings: string[];
}
export interface Receipt {
  transactionId: string;
  variant: string;
  title: string;
  lines: Array<{ label: string; value: string }>;
  items: TransactionItem[];
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  synthetic: true;
}
export interface DocumentSummary {
  id: string;
  title: string;
  groups: string[];
  validFrom: string;
  validTo: string;
  isNew: boolean;
  pageCount: number;
  category: string;
}
export interface DocumentDetail extends DocumentSummary {
  description: string;
  pages: Array<{ number: number; url: string }>;
}
export interface DocumentResults {
  items: DocumentSummary[];
  totalMatches: number;
  limit: number;
  truncated: boolean;
}
