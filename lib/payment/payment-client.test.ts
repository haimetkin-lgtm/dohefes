import { describe, expect, it } from "vitest";
import { createPaymentOrder, generateIdempotencyKey, getProductAccess, purchaseProduct } from "./payment-client";
import type { FunctionsInvoker } from "./payment-client";
import type { StorageLike } from "./payment-storage";
import { resolvePendingByContext } from "./payment-storage";

const REPORT_ID = "11111111-1111-1111-1111-111111111111";
const IDEMPOTENCY_KEY = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-01-01T00:00:00Z");
const TRUSTED_CHECKOUT_URL = "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP";

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  failSetItemKeys = new Set<string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failSetItemKeys.has(key)) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** invoker מזוייף - שולט בתשובת ה-success (data) או בשגיאת HTTP (status+body) בנפרד, בדיוק כמו
 *  supabase.functions.invoke האמיתי (error.context הוא Response-like עם status/json()). */
function fakeInvoker(
  outcome: { data: unknown } | { httpErrorStatus: number; httpErrorBody: unknown } | { networkError: true }
): FunctionsInvoker & { calls: Array<{ functionName: string; headers?: Record<string, string>; body?: unknown }> } {
  const calls: Array<{ functionName: string; headers?: Record<string, string>; body?: unknown }> = [];
  return {
    calls,
    async invoke(functionName, options) {
      calls.push({ functionName, headers: options?.headers, body: options?.body });
      if ("data" in outcome) return { data: outcome.data, error: null };
      if ("networkError" in outcome) return { data: null, error: { context: undefined } };
      return {
        data: null,
        error: { context: { status: outcome.httpErrorStatus, json: async () => outcome.httpErrorBody } },
      };
    },
  };
}

describe("createPaymentOrder - תגובת pending", () => {
  it("תגובה תקינה עם checkoutUrl מהימן - כל השדות מוחזרים כפי שהתקבלו", async () => {
    const invoker = fakeInvoker({
      data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-1", paymentContextId: "po_abc" },
    });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-1", paymentContextId: "po_abc" });
  });

  it("שולח את ה-Idempotency-Key וה-body המדויקים, בלי שדות נוספים", async () => {
    const invoker = fakeInvoker({ data: { status: "pending", orderId: "o", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "t", paymentContextId: "po_x" } });
    await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(invoker.calls).toEqual([
      { functionName: "dohefes-create-payment-order", headers: { "Idempotency-Key": IDEMPOTENCY_KEY }, body: { reportId: REPORT_ID, productType: "cashFlowAnalysis" } },
    ]);
  });

  it("checkoutUrl ב-host לא מורשה (לא secure.cardcom.solutions) - נדחה כתשובה לא-תקינה, לא מוחזר kind:pending", async () => {
    const invoker = fakeInvoker({
      data: { status: "pending", orderId: "order-1", checkoutUrl: "https://evil.example/PaymentSP", accessToken: "tok-1", paymentContextId: "po_abc" },
    });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "invalid_response_shape" });
  });

  it("checkoutUrl לא-HTTPS (http) - נדחה", async () => {
    const invoker = fakeInvoker({
      data: { status: "pending", orderId: "order-1", checkoutUrl: "http://secure.cardcom.solutions/PaymentSP", accessToken: "tok-1", paymentContextId: "po_abc" },
    });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "invalid_response_shape" });
  });

  it("שדה חסר (accessToken ריק) - נדחה כתשובה לא-תקינה", async () => {
    const invoker = fakeInvoker({ data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "", paymentContextId: "po_abc" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "invalid_response_shape" });
  });
});

describe("createPaymentOrder - שאר הסטטוסים", () => {
  it("paid", async () => {
    const invoker = fakeInvoker({ data: { status: "paid" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "paid" });
  });

  it.each(["failed", "cancelled", "refunded"])("%s -> error עם הסיבה המדויקת", async (status) => {
    const invoker = fakeInvoker({ data: { status } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: status });
  });

  it("503 checkout_creation_in_progress -> retryable", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 503, httpErrorBody: { error: "checkout_creation_in_progress" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("500 internal_error -> retryable", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 500, httpErrorBody: { error: "internal_error" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("403 report_not_eligible -> error עם הסיבה מהגוף", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 403, httpErrorBody: { error: "report_not_eligible" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "report_not_eligible" });
  });

  it("409 idempotency_key_conflict -> error", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 409, httpErrorBody: { error: "idempotency_key_conflict" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "idempotency_key_conflict" });
  });

  it("502 payment_provider_error - כשל ודאי, לא retryable עם אותם פרטים", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 502, httpErrorBody: { error: "payment_provider_error" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "payment_provider_error" });
  });

  it("שגיאת רשת (אין status בכלל) -> retryable", async () => {
    const invoker = fakeInvoker({ networkError: true });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("סטטוס לא מוכר בתשובה תקינה - error, לא זורק", async () => {
    const invoker = fakeInvoker({ data: { status: "something_new" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "invalid_response_shape" });
  });
});

describe("getProductAccess", () => {
  it("שולח X-Access-Token ואת ה-body המדויק", async () => {
    const invoker = fakeInvoker({ data: { status: "active" } });
    await getProductAccess(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-1" });
    expect(invoker.calls).toEqual([
      { functionName: "dohefes-get-product-access", headers: { "X-Access-Token": "tok-1" }, body: { reportId: REPORT_ID, productType: "cashFlowAnalysis" } },
    ]);
  });

  it.each(["active", "pending", "unavailable"] as const)("%s מוחזר כפי שהתקבל", async (status) => {
    const invoker = fakeInvoker({ data: { status } });
    const result = await getProductAccess(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-1" });
    expect(result).toEqual({ kind: status });
  });

  it("500 -> retryable", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 500, httpErrorBody: { error: "internal_error" } });
    const result = await getProductAccess(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-1" });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("שגיאת רשת -> retryable", async () => {
    const invoker = fakeInvoker({ networkError: true });
    const result = await getProductAccess(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-1" });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("403 origin_not_allowed -> error", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 403, httpErrorBody: { error: "origin_not_allowed" } });
    const result = await getProductAccess(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-1" });
    expect(result).toEqual({ kind: "error", reason: "origin_not_allowed" });
  });
});

describe("purchaseProduct - שמירת pending לפני redirect, לא אחרי", () => {
  it("pending תקין + שמירה מוצלחת -> redirect עם checkoutUrl, והרשומה נשמרה בפועל ב-storage", async () => {
    const storage = new FakeStorage();
    const invoker = fakeInvoker({ data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-1", paymentContextId: "po_abc" } });

    const result = await purchaseProduct(invoker, storage, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY }, NOW);

    expect(result).toEqual({ kind: "redirect", checkoutUrl: TRUSTED_CHECKOUT_URL });
    expect(resolvePendingByContext(storage, "po_abc", NOW)).toEqual({ reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-1", createdAt: NOW.toISOString() });
  });

  it("pending תקין אך כשל שמירה (quota) - storage_failed, **אין checkoutUrl בתוצאה**, אין redirect אפשרי", async () => {
    const storage = new FakeStorage();
    storage.failSetItemKeys.add("dohefes.pendingPurchases");
    const invoker = fakeInvoker({ data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-1", paymentContextId: "po_abc" } });

    const result = await purchaseProduct(invoker, storage, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY }, NOW);

    expect(result).toEqual({ kind: "storage_failed" });
    expect("checkoutUrl" in result).toBe(false);
  });

  it("paid -> already_paid, לא נוגע ב-storage בכלל", async () => {
    const storage = new FakeStorage();
    const invoker = fakeInvoker({ data: { status: "paid" } });
    const result = await purchaseProduct(invoker, storage, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    expect(result).toEqual({ kind: "already_paid" });
  });

  it("retryable מהשרת עובר כמו שהוא", async () => {
    const storage = new FakeStorage();
    const invoker = fakeInvoker({ httpErrorStatus: 503, httpErrorBody: { error: "checkout_creation_in_progress" } });
    const result = await purchaseProduct(invoker, storage, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    expect(result).toEqual({ kind: "retryable" });
  });

  it("error מהשרת עובר כמו שהוא, עם הסיבה", async () => {
    const storage = new FakeStorage();
    const invoker = fakeInvoker({ httpErrorStatus: 403, httpErrorBody: { error: "report_not_eligible" } });
    const result = await purchaseProduct(invoker, storage, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    expect(result).toEqual({ kind: "error", reason: "report_not_eligible" });
  });
});

describe("generateIdempotencyKey", () => {
  it("מחזירה UUID תקין (תבנית 8-4-4-4-12)", () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("שתי קריאות מחזירות ערכים שונים", () => {
    expect(generateIdempotencyKey()).not.toBe(generateIdempotencyKey());
  });
});

describe("אין access token בשום פלט שגיאה", () => {
  it("תוצאת storage_failed אינה כוללת את הטוקן שהתקבל מהשרת", async () => {
    const storage = new FakeStorage();
    storage.failSetItemKeys.add("dohefes.pendingPurchases");
    const secretToken = "super-secret-access-token-xyz";
    const invoker = fakeInvoker({ data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: secretToken, paymentContextId: "po_abc" } });

    const result = await purchaseProduct(invoker, storage, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY }, NOW);

    expect(JSON.stringify(result)).not.toContain(secretToken);
  });

  it("תוצאת error מ-createPaymentOrder לעולם לא כוללת accessToken כלשהו (רק reason טקסטואלי)", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 403, httpErrorBody: { error: "report_not_eligible" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(Object.keys(result).sort()).toEqual(["kind", "reason"]);
  });
});
