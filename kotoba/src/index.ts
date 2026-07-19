/**
 * shiharai kotoba — barrel. Maximal migration (Consensys c-split): public payee
 * catalog plaintext + per-person/ledger/automation-run records via kotoba E2E
 * (ADR-2605181100). Fiat MoR settlement rail, credential custody, Playwright
 * submit ACTION and LLM extraction INFERENCE stay etzhayyim via consent-capability —
 * only their resulting DATA migrates here.
 */
export * from "./types.js";
export {
  registerBiller,
  getBiller,
  billerExists,
  listBillers,
  recordBill,
  listBills,
  getBill,
  recordPayment,
  listPayments,
  recordRecurring,
  listRecurring,
  recordJob,
  listJobs,
  recordJobResult,
  listJobResults,
  coverage,
} from "./registry.js";
