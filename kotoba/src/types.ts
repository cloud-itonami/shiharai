/**
 * shiharai kotoba — payment Web-automation, maximal migration (Consensys
 * c-split, ADR-2606011400 + ADR-2605172400 3-axis + ADR-2605181100 kotoba E2E).
 *
 * shiharai drives biller payment pages and (with human-in-the-loop confirm)
 * submits the final payment. Founder directive 2026-06-03: front everything
 * that can move; only the irreducible regulated EXECUTION stays etzhayyim.
 *
 * SPLIT:
 *   PLAINTEXT (public catalog) — biller: the payee directory (display name,
 *   country, site/pay URLs, adapter, capabilities). Open reference metadata,
 *   no PII. `keychain_service` is a naming-convention pointer, not a secret.
 *
 *   E2E (kotoba envelope, read-cap = owner DID) — per-person + ledger + run
 *   records: bill (PII: issuer/amount/customerNumber/invoiceNumber/sourceEmail),
 *   payment (LEDGER entry: amount/method/resultTxId/approver),
 *   recurring (PII: customerNumber/payMethod binding),
 *   job + jobResult (per-person automation-run records: state/timestamps/
 *   page-snapshot CID/result tx id/error). CIDs, tx-ids and approval hashes are
 *   references/hashes, not secrets — safe inside an E2E body.
 *
 *   STAYS etzhayyim (consumed via consent-capability) — the irreducible regulated
 *   EXECUTION ONLY: the fiat merchant-of-record settlement rail (the final
 *   payment CALL through biller pay pages + bank/credit clearing; etzhayyim is
 *   never the fiat MoR/counterparty per ADR-2605172100), credential/secret raw
 *   custody (Keychain → vault ephemeral-wrap), the Playwright dequeue/submit
 *   enforcement ACTION, and the LLM bill-extraction INFERENCE. The DATA of every
 *   one of those (ledger, run state, extracted bill) migrates here; only the
 *   regulated act stays etzhayyim.
 *
 * AT-Lexicon: no float — money is a decimal STRING (amount + currency code),
 * counts are integers, no percentages in this app.
 */

// ── Plaintext public collection ──────────────────────────────────────
export const BILLER_COLLECTION = "com.etzhayyim.apps.shiharai.biller";

// ── E2E inner-type NSIDs (body shape inside the kotoba envelope) ──────
export const BILL_INNER_TYPE = "com.etzhayyim.apps.shiharai.bill";
export const PAYMENT_INNER_TYPE = "com.etzhayyim.apps.shiharai.payment";
export const RECURRING_INNER_TYPE = "com.etzhayyim.apps.shiharai.recurring";
export const JOB_INNER_TYPE = "com.etzhayyim.apps.shiharai.job";
export const JOB_RESULT_INNER_TYPE = "com.etzhayyim.apps.shiharai.jobResult";

export const SHIHARAI_DID_PREFIX = "did:web:shiharai.etzhayyim.com:" as const;

// ─── Biller (PLAINTEXT, public payee catalog) ───────────────────────

export interface BillerRecord {
  did: string;
  billerHandle: string;
  displayName: string;
  country: string;
  siteUrl: string;
  payUrl: string;
  recurringUrl: string;
  adapter: string;
  authKind: string;
  /** Naming-convention pointer (e.g. "etzhayyim.shiharai.tokyo-waterworks"), NOT a secret. */
  keychainService: string;
  capabilities: string[];
  notes: string;
  createdAt: string;
}
export interface BillerView extends BillerRecord {
  billerUri: string;
}
export interface RegisterBillerInput {
  billerHandle: string;
  displayName: string;
  country?: string;
  siteUrl?: string;
  payUrl?: string;
  recurringUrl?: string;
  adapter?: string;
  authKind?: string;
  keychainService?: string;
  capabilities?: string[];
  notes?: string;
}
export interface RegisterBillerOutput {
  status: "registered" | "alreadyExists" | "rejected";
  billerUri?: string;
  did?: string;
  billerHandle?: string;
  error?: string;
}
export interface GetBillerInput {
  billerHandle: string;
}
export interface GetBillerOutput {
  biller?: BillerView;
  error?: string;
}
export interface ListBillersInput {
  country?: string;
  limit?: number;
  cursor?: string;
}
export interface ListBillersOutput {
  items: BillerView[];
  cursor?: string;
  total: number;
}

// ─── Bill (E2E, PII) ────────────────────────────────────────────────

export interface BillBody {
  billId: string;
  billerHandle: string;
  issuer: string;
  /** Decimal string (no float). e.g. "12000". */
  amount: string;
  currency: string;
  dueDate: string;
  customerNumber: string;
  invoiceNumber: string;
  payUrl: string;
  method: string;
  sourceEmailId: string;
  state: string;
  extractedAt: string;
}
export interface BillView extends BillBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordBillInput {
  billId: string;
  billerHandle: string;
  issuer: string;
  amount: string;
  currency?: string;
  dueDate?: string;
  customerNumber?: string;
  invoiceNumber?: string;
  payUrl?: string;
  method?: string;
  sourceEmailId?: string;
  state?: string;
  extractedAt?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface RecordBillOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  billId?: string;
  error?: string;
}
export interface ListBillsInput {
  billerHandle?: string;
  state?: string;
  limit?: number;
  cursor?: string;
}
export interface ListBillsOutput {
  items: BillView[];
  cursor?: string;
  total: number;
}
export interface GetBillInput {
  billId: string;
}
export interface GetBillOutput {
  bill?: BillView;
  error?: string;
}

// ─── Payment (E2E, LEDGER entry) ────────────────────────────────────

export interface PaymentBody {
  paymentId: string;
  billId: string;
  billerHandle: string;
  /** Decimal string (no float). */
  amount: string;
  currency: string;
  method: string;
  /** Reference from the (etzhayyim-side) settlement rail — not a secret. */
  resultTxId: string;
  pageSnapshotCid: string;
  approvedByDid: string;
  committedAt: string;
}
export interface PaymentView extends PaymentBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordPaymentInput {
  paymentId: string;
  billId: string;
  billerHandle?: string;
  amount: string;
  currency?: string;
  method?: string;
  resultTxId?: string;
  pageSnapshotCid?: string;
  approvedByDid?: string;
  committedAt?: string;
  recipients?: string[];
}
export interface RecordPaymentOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  paymentId?: string;
  error?: string;
}
export interface ListPaymentsInput {
  billId?: string;
  billerHandle?: string;
  limit?: number;
  cursor?: string;
}
export interface ListPaymentsOutput {
  items: PaymentView[];
  cursor?: string;
  total: number;
}

// ─── Recurring binding (E2E, PII) ───────────────────────────────────

export interface RecurringBody {
  recurringId: string;
  billerHandle: string;
  customerNumber: string;
  payMethod: string;
  state: string;
  registeredAt: string;
}
export interface RecurringView extends RecurringBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordRecurringInput {
  recurringId: string;
  billerHandle: string;
  customerNumber?: string;
  payMethod?: string;
  state?: string;
  registeredAt?: string;
  recipients?: string[];
}
export interface RecordRecurringOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  recurringId?: string;
  error?: string;
}
export interface ListRecurringInput {
  billerHandle?: string;
  limit?: number;
  cursor?: string;
}
export interface ListRecurringOutput {
  items: RecurringView[];
  cursor?: string;
  total: number;
}

// ─── Job (E2E, per-person automation-run record) ────────────────────

export interface JobBody {
  jobId: string;
  billId: string;
  billerHandle: string;
  method: string;
  payUrl: string;
  state: string;
  requireConfirm: boolean;
  daemonId: string;
  enqueuedAt: string;
  pageSnapshotCid: string;
  resultTxId: string;
  lastError: string;
}
export interface JobView extends JobBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordJobInput {
  jobId: string;
  billId: string;
  billerHandle?: string;
  method?: string;
  payUrl?: string;
  state?: string;
  requireConfirm?: boolean;
  daemonId?: string;
  enqueuedAt?: string;
  pageSnapshotCid?: string;
  resultTxId?: string;
  lastError?: string;
  recipients?: string[];
}
export interface RecordJobOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  jobId?: string;
  error?: string;
}
export interface ListJobsInput {
  billId?: string;
  state?: string;
  limit?: number;
  cursor?: string;
}
export interface ListJobsOutput {
  items: JobView[];
  cursor?: string;
  total: number;
}

// ─── Job result (E2E, per-person automation-run record) ─────────────

export interface JobResultBody {
  jobId: string;
  outcome: string;
  pageSnapshotCid: string;
  resultTxId: string;
  errorMessage: string;
  reportedAt: string;
}
export interface JobResultView extends JobResultBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordJobResultInput {
  jobId: string;
  outcome: string;
  pageSnapshotCid?: string;
  resultTxId?: string;
  errorMessage?: string;
  reportedAt?: string;
  recipients?: string[];
}
export interface RecordJobResultOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  jobId?: string;
  error?: string;
}
export interface ListJobResultsInput {
  jobId?: string;
  outcome?: string;
  limit?: number;
  cursor?: string;
}
export interface ListJobResultsOutput {
  items: JobResultView[];
  cursor?: string;
  total: number;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  billerCount?: number;
  billCount?: number;
  paymentCount?: number;
  recurringCount?: number;
  jobCount?: number;
  jobResultCount?: number;
  billersByCountry?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
/** Money is a decimal STRING (no float). Accepts "0", "12000", "1234.56". */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
}
export function billerDidFor(handle: string): string {
  return `${SHIHARAI_DID_PREFIX}biller:${handle.toLowerCase()}`;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
export function billerRkey(handle: string): string {
  return `biller-${slug(handle)}`;
}
export function billRkey(id: string): string {
  return `bill-${slug(id)}`;
}
export function paymentRkey(id: string): string {
  return `pay-${slug(id)}`;
}
export function recurringRkey(id: string): string {
  return `rec-${slug(id)}`;
}
export function jobRkey(id: string): string {
  return `job-${slug(id)}`;
}
export function jobResultRkey(id: string): string {
  return `jobres-${slug(id)}`;
}
