/**
 * shiharai kotoba — registry.
 *
 * Plaintext path (biller): sdk.write / sdk.read — public payee catalog.
 * E2E paths (bill / payment / recurring / job / jobResult): sdk.encryptedWrite /
 * sdk.encryptedRead — PII + ledger + automation-run records sealed in the kotoba
 * envelope (ADR-2605181100), read-cap = owner DID. The substrate never sees the
 * sensitive body in plaintext.
 *
 * Money is carried as a decimal STRING (no float). The fiat settlement CALL,
 * credential custody, Playwright submit ACTION and LLM extraction INFERENCE stay
 * etzhayyim, consumed via consent-capability — only their resulting DATA lives here.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  BILLER_COLLECTION,
  BILL_INNER_TYPE,
  PAYMENT_INNER_TYPE,
  RECURRING_INNER_TYPE,
  JOB_INNER_TYPE,
  JOB_RESULT_INNER_TYPE,
  billerDidFor,
  billerRkey,
  billRkey,
  paymentRkey,
  recurringRkey,
  jobRkey,
  jobResultRkey,
  isDecimalString,
  type BillerRecord,
  type BillerView,
  type RegisterBillerInput,
  type RegisterBillerOutput,
  type GetBillerInput,
  type GetBillerOutput,
  type ListBillersInput,
  type ListBillersOutput,
  type BillBody,
  type BillView,
  type RecordBillInput,
  type RecordBillOutput,
  type ListBillsInput,
  type ListBillsOutput,
  type GetBillInput,
  type GetBillOutput,
  type PaymentBody,
  type PaymentView,
  type RecordPaymentInput,
  type RecordPaymentOutput,
  type ListPaymentsInput,
  type ListPaymentsOutput,
  type RecurringBody,
  type RecurringView,
  type RecordRecurringInput,
  type RecordRecurringOutput,
  type ListRecurringInput,
  type ListRecurringOutput,
  type JobBody,
  type JobView,
  type RecordJobInput,
  type RecordJobOutput,
  type ListJobsInput,
  type ListJobsOutput,
  type JobResultBody,
  type JobResultView,
  type RecordJobResultInput,
  type RecordJobResultOutput,
  type ListJobResultsInput,
  type ListJobResultsOutput,
  type CoverageInput,
  type CoverageOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Biller (PLAINTEXT) ─────────────────────────────────────────────

export async function registerBiller(e: Etzhayyim, input: RegisterBillerInput): Promise<RegisterBillerOutput> {
  if (!input.billerHandle || !input.displayName) return { status: "rejected", error: "missingRequiredFields" };
  const rkey = billerRkey(input.billerHandle);
  const existing = await e.read<BillerRecord>({ collection: BILLER_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", billerUri: existing.records[0].uri, did: existing.records[0].value.did, billerHandle: input.billerHandle };
  }
  const now = new Date().toISOString();
  const did = billerDidFor(input.billerHandle);
  const record: BillerRecord = {
    did,
    billerHandle: input.billerHandle,
    displayName: input.displayName,
    country: input.country ?? "",
    siteUrl: input.siteUrl ?? "",
    payUrl: input.payUrl ?? "",
    recurringUrl: input.recurringUrl ?? "",
    adapter: input.adapter ?? "",
    authKind: input.authKind ?? "",
    keychainService: input.keychainService ?? "",
    capabilities: input.capabilities ?? [],
    notes: input.notes ?? "",
    createdAt: now,
  };
  const receipt = await e.write({ collection: BILLER_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "registered", billerUri: receipt.uri, did, billerHandle: input.billerHandle };
}

export async function getBiller(e: Etzhayyim, input: GetBillerInput): Promise<GetBillerOutput> {
  if (!input.billerHandle) return { error: "invalidBillerHandle" };
  const rkey = billerRkey(input.billerHandle);
  const resp = await e.read<BillerRecord>({ collection: BILLER_COLLECTION, rkey });
  const r = resp.records[0];
  if (!r?.value) return { error: "notFound" };
  return { biller: { ...r.value, billerUri: r.uri } };
}

/** FK helper — does this biller exist in the plaintext catalog? */
export async function billerExists(e: Etzhayyim, billerHandle: string): Promise<boolean> {
  const resp = await e.read<BillerRecord>({ collection: BILLER_COLLECTION, rkey: billerRkey(billerHandle) }).catch(() => ({ records: [] }));
  return Boolean(resp.records[0]?.value);
}

export async function listBillers(e: Etzhayyim, input: ListBillersInput = {}): Promise<ListBillersOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<BillerRecord>({ collection: BILLER_COLLECTION, cursor: input.cursor, limit });
  const items: BillerView[] = resp.records
    .filter((r) => !input.country || r.value.country === input.country)
    .map((r) => ({ ...r.value, billerUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Bill (E2E, PII) ────────────────────────────────────────────────

export async function recordBill(e: Etzhayyim, input: RecordBillInput): Promise<RecordBillOutput> {
  if (!input.billId || !input.billerHandle || !input.issuer) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.amount)) return { status: "rejected", error: "invalidAmount" };
  const now = new Date().toISOString();
  const body: BillBody = {
    billId: input.billId,
    billerHandle: input.billerHandle,
    issuer: input.issuer,
    amount: input.amount,
    currency: input.currency ?? "JPY",
    dueDate: input.dueDate ?? "",
    customerNumber: input.customerNumber ?? "",
    invoiceNumber: input.invoiceNumber ?? "",
    payUrl: input.payUrl ?? "",
    method: input.method ?? "",
    sourceEmailId: input.sourceEmailId ?? "",
    state: input.state ?? "due",
    extractedAt: input.extractedAt ?? now,
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: BILL_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: billRkey(input.billId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, billId: input.billId };
}

async function scanBills(e: Etzhayyim, maxScan: number): Promise<BillView[]> {
  const out: BillView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<BillBody>({ innerType: BILL_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listBills(e: Etzhayyim, input: ListBillsInput = {}): Promise<ListBillsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanBills(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (b) => (!input.billerHandle || b.billerHandle === input.billerHandle) && (!input.state || b.state === input.state),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getBill(e: Etzhayyim, input: GetBillInput): Promise<GetBillOutput> {
  if (!input.billId) return { error: "invalidBillId" };
  const found = (await scanBills(e, DEFAULT_MAX_SCAN)).find((b) => b.billId === input.billId);
  return found ? { bill: found } : { error: "notFound" };
}

// ─── Payment (E2E, LEDGER) ──────────────────────────────────────────

export async function recordPayment(e: Etzhayyim, input: RecordPaymentInput): Promise<RecordPaymentOutput> {
  if (!input.paymentId || !input.billId) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.amount)) return { status: "rejected", error: "invalidAmount" };
  const now = new Date().toISOString();
  const body: PaymentBody = {
    paymentId: input.paymentId,
    billId: input.billId,
    billerHandle: input.billerHandle ?? "",
    amount: input.amount,
    currency: input.currency ?? "JPY",
    method: input.method ?? "",
    resultTxId: input.resultTxId ?? "",
    pageSnapshotCid: input.pageSnapshotCid ?? "",
    approvedByDid: input.approvedByDid ?? "",
    committedAt: input.committedAt ?? now,
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: PAYMENT_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: paymentRkey(input.paymentId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, paymentId: input.paymentId };
}

async function scanPayments(e: Etzhayyim, maxScan: number): Promise<PaymentView[]> {
  const out: PaymentView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<PaymentBody>({ innerType: PAYMENT_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listPayments(e: Etzhayyim, input: ListPaymentsInput = {}): Promise<ListPaymentsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanPayments(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (p) => (!input.billId || p.billId === input.billId) && (!input.billerHandle || p.billerHandle === input.billerHandle),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Recurring (E2E, PII) ───────────────────────────────────────────

export async function recordRecurring(e: Etzhayyim, input: RecordRecurringInput): Promise<RecordRecurringOutput> {
  if (!input.recurringId || !input.billerHandle) return { status: "rejected", error: "missingRequiredFields" };
  const now = new Date().toISOString();
  const body: RecurringBody = {
    recurringId: input.recurringId,
    billerHandle: input.billerHandle,
    customerNumber: input.customerNumber ?? "",
    payMethod: input.payMethod ?? "",
    state: input.state ?? "active",
    registeredAt: input.registeredAt ?? now,
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: RECURRING_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: recurringRkey(input.recurringId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, recurringId: input.recurringId };
}

async function scanRecurring(e: Etzhayyim, maxScan: number): Promise<RecurringView[]> {
  const out: RecurringView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<RecurringBody>({ innerType: RECURRING_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listRecurring(e: Etzhayyim, input: ListRecurringInput = {}): Promise<ListRecurringOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanRecurring(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((r) => !input.billerHandle || r.billerHandle === input.billerHandle);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Job (E2E, automation-run record) ───────────────────────────────

export async function recordJob(e: Etzhayyim, input: RecordJobInput): Promise<RecordJobOutput> {
  if (!input.jobId || !input.billId) return { status: "rejected", error: "missingRequiredFields" };
  const now = new Date().toISOString();
  const body: JobBody = {
    jobId: input.jobId,
    billId: input.billId,
    billerHandle: input.billerHandle ?? "",
    method: input.method ?? "",
    payUrl: input.payUrl ?? "",
    state: input.state ?? "pending",
    requireConfirm: input.requireConfirm ?? true,
    daemonId: input.daemonId ?? "",
    enqueuedAt: input.enqueuedAt ?? now,
    pageSnapshotCid: input.pageSnapshotCid ?? "",
    resultTxId: input.resultTxId ?? "",
    lastError: input.lastError ?? "",
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: JOB_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: jobRkey(input.jobId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, jobId: input.jobId };
}

async function scanJobs(e: Etzhayyim, maxScan: number): Promise<JobView[]> {
  const out: JobView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<JobBody>({ innerType: JOB_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listJobs(e: Etzhayyim, input: ListJobsInput = {}): Promise<ListJobsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanJobs(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (j) => (!input.billId || j.billId === input.billId) && (!input.state || j.state === input.state),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Job result (E2E, automation-run record) ────────────────────────

export async function recordJobResult(e: Etzhayyim, input: RecordJobResultInput): Promise<RecordJobResultOutput> {
  if (!input.jobId || !input.outcome) return { status: "rejected", error: "missingRequiredFields" };
  const now = new Date().toISOString();
  const body: JobResultBody = {
    jobId: input.jobId,
    outcome: input.outcome,
    pageSnapshotCid: input.pageSnapshotCid ?? "",
    resultTxId: input.resultTxId ?? "",
    errorMessage: input.errorMessage ?? "",
    reportedAt: input.reportedAt ?? now,
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: JOB_RESULT_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: jobResultRkey(input.jobId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, jobId: input.jobId };
}

async function scanJobResults(e: Etzhayyim, maxScan: number): Promise<JobResultView[]> {
  const out: JobResultView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<JobResultBody>({ innerType: JOB_RESULT_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listJobResults(e: Etzhayyim, input: ListJobResultsInput = {}): Promise<ListJobResultsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanJobResults(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (r) => (!input.jobId || r.jobId === input.jobId) && (!input.outcome || r.outcome === input.outcome),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Coverage rollup ────────────────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const billersByCountry: Record<string, number> = {};
  let billerCount = 0;
  let cursor: string | undefined;
  while (billerCount < maxScan) {
    const page = await e.read<BillerRecord>({ collection: BILLER_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      const c = r.value.country || "unknown";
      billersByCountry[c] = (billersByCountry[c] ?? 0) + 1;
      billerCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  const billCount = (await scanBills(e, maxScan)).length;
  const paymentCount = (await scanPayments(e, maxScan)).length;
  const recurringCount = (await scanRecurring(e, maxScan)).length;
  const jobCount = (await scanJobs(e, maxScan)).length;
  const jobResultCount = (await scanJobResults(e, maxScan)).length;
  return {
    billerCount,
    billCount,
    paymentCount,
    recurringCount,
    jobCount,
    jobResultCount,
    billersByCountry,
    truncated:
      billerCount >= maxScan ||
      billCount >= maxScan ||
      paymentCount >= maxScan ||
      recurringCount >= maxScan ||
      jobCount >= maxScan ||
      jobResultCount >= maxScan,
  };
}
