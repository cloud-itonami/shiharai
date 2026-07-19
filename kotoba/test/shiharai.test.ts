import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
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
} from "../src/index.js";

const OWNER = "did:web:shiharai.etzhayyim.com";

describe("shiharai kotoba (maximal migration)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("biller (PLAINTEXT public catalog)", () => {
    it("registers, dedups, gets, FK-exists, lists/filters", async () => {
      expect((await registerBiller(e, { billerHandle: "tokyo-waterworks", displayName: "東京都水道局", country: "JP", payUrl: "https://suidoapp", capabilities: ["card", "payeasy"] })).status).toBe("registered");
      expect((await registerBiller(e, { billerHandle: "tokyo-waterworks", displayName: "dup" })).status).toBe("alreadyExists");
      expect((await registerBiller(e, { billerHandle: "", displayName: "x" })).status).toBe("rejected");
      await registerBiller(e, { billerHandle: "flyio", displayName: "Fly.io", country: "US" });

      const got = await getBiller(e, { billerHandle: "tokyo-waterworks" });
      expect(got.biller?.displayName).toBe("東京都水道局");
      expect(got.biller?.capabilities).toEqual(["card", "payeasy"]);
      expect(await billerExists(e, "flyio")).toBe(true);
      expect(await billerExists(e, "nope")).toBe(false);

      expect((await listBillers(e)).total).toBe(2);
      expect((await listBillers(e, { country: "JP" })).total).toBe(1);
    });
  });

  describe("bill (E2E PII)", () => {
    it("seals via encryptedWrite, round-trips, validates amount (decimal string)", async () => {
      const ok = await recordBill(e, { billId: "b1", billerHandle: "tokyo-waterworks", issuer: "東京都水道局", amount: "12000", customerNumber: "C-9981", sourceEmailId: "gmail:abc" });
      expect(ok.status).toBe("recorded");
      expect(ok.keyId).toBeTruthy();
      // float / non-decimal amounts rejected
      expect((await recordBill(e, { billId: "bX", billerHandle: "h", issuer: "i", amount: "12,000" })).status).toBe("rejected");
      expect((await recordBill(e, { billId: "bY", billerHandle: "h", issuer: "i", amount: "abc" })).status).toBe("rejected");

      const got = await getBill(e, { billId: "b1" });
      expect(got.bill?.customerNumber).toBe("C-9981");
      expect(got.bill?.amount).toBe("12000");
      expect(got.bill?.currency).toBe("JPY");

      await recordBill(e, { billId: "b2", billerHandle: "flyio", issuer: "Fly.io", amount: "500", state: "overdue" });
      expect((await listBills(e)).total).toBe(2);
      expect((await listBills(e, { billerHandle: "tokyo-waterworks" })).total).toBe(1);
      expect((await listBills(e, { state: "overdue" })).total).toBe(1);
    });

    it("enforces read-cap: a non-recipient DID sees zero bills", async () => {
      await recordBill(e, { billId: "b1", billerHandle: "h", issuer: "i", amount: "100" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listBills(outsider)).total).toBe(0);
    });

    it("grants read-cap to an explicit recipient", async () => {
      const partner = "did:web:partner.example";
      const r = await recordBill(e, { billId: "b1", billerHandle: "h", issuer: "i", amount: "100", recipients: [partner] });
      expect(r.status).toBe("recorded");
      expect((await listBills(e)).total).toBe(1);
    });
  });

  describe("payment (E2E ledger entry)", () => {
    it("records ledger entries, validates amount, lists/filters", async () => {
      expect((await recordPayment(e, { paymentId: "p1", billId: "b1", billerHandle: "tokyo-waterworks", amount: "12000", resultTxId: "tx-abc", approvedByDid: OWNER })).status).toBe("recorded");
      expect((await recordPayment(e, { paymentId: "pX", billId: "b1", amount: "1.2.3" })).status).toBe("rejected");
      await recordPayment(e, { paymentId: "p2", billId: "b2", billerHandle: "flyio", amount: "500" });
      expect((await listPayments(e)).total).toBe(2);
      expect((await listPayments(e, { billId: "b1" })).total).toBe(1);
      expect((await listPayments(e, { billerHandle: "flyio" })).total).toBe(1);
    });
  });

  describe("recurring (E2E PII binding)", () => {
    it("records bindings, lists/filters", async () => {
      expect((await recordRecurring(e, { recurringId: "r1", billerHandle: "suidocard", customerNumber: "C-1", payMethod: "card" })).status).toBe("recorded");
      expect((await recordRecurring(e, { recurringId: "rX", billerHandle: "" })).status).toBe("rejected");
      await recordRecurring(e, { recurringId: "r2", billerHandle: "nuro" });
      expect((await listRecurring(e)).total).toBe(2);
      expect((await listRecurring(e, { billerHandle: "nuro" })).total).toBe(1);
    });
  });

  describe("job + jobResult (E2E automation-run records)", () => {
    it("records run state + result, lists/filters", async () => {
      expect((await recordJob(e, { jobId: "j1", billId: "b1", billerHandle: "tokyo-waterworks", state: "running", daemonId: "mac-01" })).status).toBe("recorded");
      expect((await recordJob(e, { jobId: "", billId: "b1" })).status).toBe("rejected");
      await recordJob(e, { jobId: "j2", billId: "b2", state: "pending" });
      expect((await listJobs(e)).total).toBe(2);
      expect((await listJobs(e, { state: "running" })).total).toBe(1);
      expect((await listJobs(e, { billId: "b2" })).total).toBe(1);

      expect((await recordJobResult(e, { jobId: "j1", outcome: "success", resultTxId: "tx-abc", pageSnapshotCid: "bafy123" })).status).toBe("recorded");
      expect((await recordJobResult(e, { jobId: "jX", outcome: "" })).status).toBe("rejected");
      await recordJobResult(e, { jobId: "j2", outcome: "failed", errorMessage: "timeout" });
      expect((await listJobResults(e)).total).toBe(2);
      expect((await listJobResults(e, { outcome: "success" })).total).toBe(1);
      expect((await listJobResults(e, { jobId: "j2" })).total).toBe(1);
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext billers + all E2E collections", async () => {
      await registerBiller(e, { billerHandle: "tokyo-waterworks", displayName: "東京都水道局", country: "JP" });
      await registerBiller(e, { billerHandle: "flyio", displayName: "Fly.io", country: "US" });
      await recordBill(e, { billId: "b1", billerHandle: "tokyo-waterworks", issuer: "i", amount: "12000" });
      await recordPayment(e, { paymentId: "p1", billId: "b1", amount: "12000" });
      await recordRecurring(e, { recurringId: "r1", billerHandle: "suidocard" });
      await recordJob(e, { jobId: "j1", billId: "b1" });
      await recordJobResult(e, { jobId: "j1", outcome: "success" });

      const cov = await coverage(e);
      expect(cov.billerCount).toBe(2);
      expect(cov.billCount).toBe(1);
      expect(cov.paymentCount).toBe(1);
      expect(cov.recurringCount).toBe(1);
      expect(cov.jobCount).toBe(1);
      expect(cov.jobResultCount).toBe(1);
      expect(cov.billersByCountry?.JP).toBe(1);
      expect(cov.billersByCountry?.US).toBe(1);
    });
  });
});
