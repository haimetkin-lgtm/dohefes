import { describe, expect, it } from "vitest";
import { createPaymentOrder, generateIdempotencyKey, getProductAccess, isTrustedCheckoutUrl, purchaseProduct, resumePendingCheckout } from "./payment-client";
import type { FunctionsInvoker } from "./payment-client";
import type { StorageLike } from "./payment-storage";
import { addPending, resolveActiveAccess, resolvePendingByContext } from "./payment-storage";

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

type InvokerOutcome =
  | { data: unknown }
  | { httpErrorStatus: number; httpErrorBody: unknown }
  | { httpErrorStatus: number; jsonThrows: true } // גוף שאינו JSON תקין (Response.json() זורק)
  | { networkError: true }; // FunctionsFetchError/FunctionsRelayError - אין status בכלל

/** invoker מזוייף - שולט בתשובת ה-success (data) או בשגיאת HTTP (status+body) בנפרד, בדיוק כמו
 *  supabase.functions.invoke האמיתי (error.context הוא Response-like עם status/json()). */
function fakeInvoker(outcome: InvokerOutcome): FunctionsInvoker & { calls: Array<{ functionName: string; headers?: Record<string, string>; body?: unknown }> } {
  const calls: Array<{ functionName: string; headers?: Record<string, string>; body?: unknown }> = [];
  return {
    calls,
    async invoke(functionName, options) {
      calls.push({ functionName, headers: options?.headers, body: options?.body });
      if ("data" in outcome) return { data: outcome.data, error: null };
      if ("networkError" in outcome) return { data: null, error: { context: undefined } };
      if ("jsonThrows" in outcome) {
        return {
          data: null,
          error: {
            context: {
              status: outcome.httpErrorStatus,
              json: async () => {
                throw new SyntaxError("Unexpected token in JSON");
              },
            },
          },
        };
      }
      return {
        data: null,
        error: { context: { status: outcome.httpErrorStatus, json: async () => outcome.httpErrorBody } },
      };
    },
  };
}

/** invoker מזוייף שמחזיר תוצאות שונות **בסדר** קריאות - נדרש ל-resumePendingCheckout, שקוראת
 *  ליותר מ-Function אחת ברצף (get-product-access, ואז לפעמים create-payment-order לחידוש). */
function sequencedInvoker(outcomes: InvokerOutcome[]): FunctionsInvoker & { calls: Array<{ functionName: string; headers?: Record<string, string>; body?: unknown }> } {
  const calls: Array<{ functionName: string; headers?: Record<string, string>; body?: unknown }> = [];
  let callIndex = 0;
  return {
    calls,
    async invoke(functionName, options) {
      calls.push({ functionName, headers: options?.headers, body: options?.body });
      const outcome = outcomes[callIndex] ?? outcomes[outcomes.length - 1];
      callIndex += 1;
      if ("data" in outcome) return { data: outcome.data, error: null };
      if ("networkError" in outcome) return { data: null, error: { context: undefined } };
      if ("jsonThrows" in outcome) {
        return {
          data: null,
          error: {
            context: {
              status: outcome.httpErrorStatus,
              json: async () => {
                throw new SyntaxError("Unexpected token in JSON");
              },
            },
          },
        };
      }
      return { data: null, error: { context: { status: outcome.httpErrorStatus, json: async () => outcome.httpErrorBody } } };
    },
  };
}

describe("createPaymentOrder - תגובת pending", () => {
  it("baseReport שולח dealType בלי reportId ודורש reportId מהשרת", async () => {
    const invoker = fakeInvoker({
      data: { status: "pending", reportId: REPORT_ID, orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-1", paymentContextId: "po_base" },
    });
    const result = await createPaymentOrder(invoker, { productType: "baseReport", dealType: "basic", idempotencyKey: IDEMPOTENCY_KEY });
    expect(invoker.calls[0].body).toEqual({ productType: "baseReport", dealType: "basic" });
    expect(result).toMatchObject({ kind: "pending", reportId: REPORT_ID });
  });

  it("baseReport נכשל סגור אם השרת לא מחזיר reportId", async () => {
    const invoker = fakeInvoker({
      data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-1", paymentContextId: "po_base" },
    });
    await expect(createPaymentOrder(invoker, { productType: "baseReport", dealType: "basic", idempotencyKey: IDEMPOTENCY_KEY }))
      .resolves.toEqual({ kind: "error", reason: "invalid_response_shape" });
  });

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
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "paid" });
  });

  it.each(["failed", "cancelled", "refunded"])("%s -> error עם הסיבה המדויקת", async (status) => {
    const invoker = fakeInvoker({ data: { status } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: status });
  });

  it("503 checkout_creation_in_progress -> retryable", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 503, httpErrorBody: { error: "checkout_creation_in_progress" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("500 internal_error -> retryable", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 500, httpErrorBody: { error: "internal_error" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("403 report_not_eligible -> error עם הסיבה מהגוף", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 403, httpErrorBody: { error: "report_not_eligible" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "report_not_eligible" });
  });

  it("409 idempotency_key_conflict -> error", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 409, httpErrorBody: { error: "idempotency_key_conflict" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "idempotency_key_conflict" });
  });

  it("502 payment_provider_error - כשל ודאי, לא retryable עם אותם פרטים", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 502, httpErrorBody: { error: "payment_provider_error" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "payment_provider_error" });
  });

  it("שגיאת רשת (אין status בכלל) -> retryable", async () => {
    const invoker = fakeInvoker({ networkError: true });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("סטטוס לא מוכר בתשובה תקינה - error, לא זורק", async () => {
    const invoker = fakeInvoker({ data: { status: "something_new" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
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
    expect(resolvePendingByContext(storage, "po_abc", NOW)).toEqual({
      reportId: REPORT_ID,
      productType: "cashFlowAnalysis",
      accessToken: "tok-1",
      checkoutUrl: TRUSTED_CHECKOUT_URL,
      idempotencyKey: IDEMPOTENCY_KEY,
      createdAt: NOW.toISOString(),
    });
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
    const result = await purchaseProduct(invoker, storage, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    expect(result).toEqual({ kind: "already_paid" });
  });

  it("retryable מהשרת עובר כמו שהוא", async () => {
    const storage = new FakeStorage();
    const invoker = fakeInvoker({ httpErrorStatus: 503, httpErrorBody: { error: "checkout_creation_in_progress" } });
    const result = await purchaseProduct(invoker, storage, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY }, NOW);
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
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(Object.keys(result).sort()).toEqual(["kind", "reason"]);
  });
});

describe("resumePendingCheckout - audit: משתמש שיצא מ-Cardcom וחוזר ל-/cashflow", () => {
  it("pending עדיין קיים אצל השרת -> מפנה לאותו checkoutUrl השמור, בלי לקרוא create-payment-order מחדש (אין חידוש מיותר)", async () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-1", checkoutUrl: TRUSTED_CHECKOUT_URL, idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    const invoker = sequencedInvoker([{ data: { status: "pending" } }]);

    const result = await resumePendingCheckout(invoker, storage, "po_abc", NOW);

    expect(result).toEqual({ kind: "redirect", checkoutUrl: TRUSTED_CHECKOUT_URL });
    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0].functionName).toBe("dohefes-get-product-access");
  });

  it("active שהתגלה לפני resume - מקדם ל-productAccess, לא פותח Cardcom בכלל (אין קריאה שנייה)", async () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-1", checkoutUrl: TRUSTED_CHECKOUT_URL, idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    const invoker = sequencedInvoker([{ data: { status: "active" } }]);

    const result = await resumePendingCheckout(invoker, storage, "po_abc", NOW);

    expect(result).toEqual({ kind: "already_active" });
    expect(invoker.calls).toHaveLength(1); // רק get-product-access - אף פעם לא create-payment-order
    expect(resolveActiveAccess(storage, REPORT_ID, "cashFlowAnalysis")?.accessToken).toBe("tok-1");
    expect(resolvePendingByContext(storage, "po_abc", NOW)).toBeNull(); // pending נמחק אחרי promote
  });

  it("pending שפג לפי TTL - not_found, ואף פעם לא קוראת ל-Function כלשהי (לא יוצרת הזמנה חדשה אוטומטית)", async () => {
    const storage = new FakeStorage();
    // לא נוספה שום רשומה - מדמה TTL שפג/pending שמעולם לא נמצא
    const invoker = sequencedInvoker([{ data: { status: "active" } }]);

    const result = await resumePendingCheckout(invoker, storage, "po_missing", NOW);

    expect(result).toEqual({ kind: "not_found" });
    expect(invoker.calls).toHaveLength(0);
  });

  it("unavailable מהשרת -> ספק אמיתי -> חידוש עם **אותו** idempotencyKey (לעולם לא מפתח חדש)", async () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-old", checkoutUrl: TRUSTED_CHECKOUT_URL, idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    const renewedCheckoutUrl = "https://secure.cardcom.solutions/EA/EA5/renewed/PaymentSP";
    const invoker = sequencedInvoker([
      { data: { status: "unavailable" } }, // get-product-access
      { data: { status: "pending", orderId: "order-1", checkoutUrl: renewedCheckoutUrl, accessToken: "tok-renewed", paymentContextId: "po_abc" } }, // create-payment-order (חידוש)
    ]);

    const result = await resumePendingCheckout(invoker, storage, "po_abc", NOW);

    expect(result).toEqual({ kind: "redirect", checkoutUrl: renewedCheckoutUrl });
    expect(invoker.calls).toHaveLength(2);
    expect(invoker.calls[1].functionName).toBe("dohefes-create-payment-order");
    expect(invoker.calls[1].headers?.["Idempotency-Key"]).toBe(IDEMPOTENCY_KEY); // אותו מפתח בדיוק
  });

  it("טוקן שסובב בחידוש מתעדכן ב-storage לפני שהתוצאה מוחזרת (לא אחרי)", async () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-old", checkoutUrl: TRUSTED_CHECKOUT_URL, idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    const invoker = sequencedInvoker([
      { data: { status: "unavailable" } },
      { data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-renewed", paymentContextId: "po_abc" } },
    ]);

    await resumePendingCheckout(invoker, storage, "po_abc", NOW);

    expect(resolvePendingByContext(storage, "po_abc", NOW)?.accessToken).toBe("tok-renewed");
  });

  it("כשל שמירה של החידוש (quota) - storage_failed, אין checkoutUrl בתוצאה, אין redirect", async () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-old", checkoutUrl: TRUSTED_CHECKOUT_URL, idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    storage.failSetItemKeys.add("dohefes.pendingPurchases");
    const invoker = sequencedInvoker([
      { data: { status: "unavailable" } },
      { data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-renewed", paymentContextId: "po_abc" } },
    ]);

    const result = await resumePendingCheckout(invoker, storage, "po_abc", NOW);

    expect(result).toEqual({ kind: "storage_failed" });
    expect("checkoutUrl" in result).toBe(false);
  });

  it("retryable מה-get-product-access הראשוני - מוחזר כמו שהוא, **בלי** ניסיון חידוש (אין קריאה שנייה)", async () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-1", checkoutUrl: TRUSTED_CHECKOUT_URL, idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    const invoker = sequencedInvoker([{ httpErrorStatus: 500, httpErrorBody: { error: "internal_error" } }]);

    const result = await resumePendingCheckout(invoker, storage, "po_abc", NOW);

    expect(result).toEqual({ kind: "retryable" });
    expect(invoker.calls).toHaveLength(1); // לא ניסה לחדש על תקלה חולפת
  });

  it("checkout URL פגום/host שגוי נדחה - גם אם השרת עדיין אומר pending, לא פותחים כתובת לא-מאומתת (מחדשים במקום)", async () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-old", checkoutUrl: "https://evil.example/PaymentSP", idempotencyKey: IDEMPOTENCY_KEY }, NOW);
    const invoker = sequencedInvoker([
      { data: { status: "pending" } }, // get-product-access - עדיין pending לפי השרת
      { data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-renewed", paymentContextId: "po_abc" } }, // חידוש
    ]);

    const result = await resumePendingCheckout(invoker, storage, "po_abc", NOW);

    expect(result).toEqual({ kind: "redirect", checkoutUrl: TRUSTED_CHECKOUT_URL }); // הכתובת המאומתת החדשה, לא הישנה הפגומה
    expect(invoker.calls).toHaveLength(2); // כן חידש, כי הכתובת השמורה נכשלה באימות
  });

  it("שתי לשוניות מנסות לחדש את אותו pending ברצף - הלשונית השנייה קוראת עם ה-token המעודכן (לא הישן), storage תמיד נקרא מחדש", async () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-original", checkoutUrl: TRUSTED_CHECKOUT_URL, idempotencyKey: IDEMPOTENCY_KEY }, NOW);

    const firstTabInvoker = sequencedInvoker([
      { data: { status: "unavailable" } },
      { data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-after-tab1", paymentContextId: "po_abc" } },
    ]);
    await resumePendingCheckout(firstTabInvoker, storage, "po_abc", NOW);

    // "לשונית שנייה" - storage משותף (localStorage אמיתי משותף ל-origin) - resume נוסף קורא
    // מחדש מה-storage, לא מ-state ישן בזיכרון.
    const secondTabInvoker = sequencedInvoker([{ data: { status: "active" } }]);
    await resumePendingCheckout(secondTabInvoker, storage, "po_abc", NOW);

    expect(secondTabInvoker.calls[0].headers?.["X-Access-Token"]).toBe("tok-after-tab1"); // לא tok-original
  });

  it("migration: pending שנשמר לפני הסבב הזה (schemaVersion 1, בלי checkoutUrl/idempotencyKey) לא נמצא - not_found, לא קורא לשום Function", async () => {
    const storage = new FakeStorage();
    storage.setItem("dohefes.pendingPurchases", JSON.stringify({ schemaVersion: 1, entries: { po_old: { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok-old", createdAt: NOW.toISOString() } } }));
    const invoker = sequencedInvoker([{ data: { status: "active" } }]);

    const result = await resumePendingCheckout(invoker, storage, "po_old", NOW);

    expect(result).toEqual({ kind: "not_found" });
    expect(invoker.calls).toHaveLength(0);
  });
});

describe("isTrustedCheckoutUrl (מיוצא)", () => {
  it("host מורשה + HTTPS - true", () => {
    expect(isTrustedCheckoutUrl(TRUSTED_CHECKOUT_URL)).toBe(true);
  });
  it("host לא מורשה - false", () => {
    expect(isTrustedCheckoutUrl("https://evil.example/PaymentSP")).toBe(false);
  });
  it("HTTP (לא HTTPS) - false", () => {
    expect(isTrustedCheckoutUrl("http://secure.cardcom.solutions/PaymentSP")).toBe(false);
  });
  it("URL לא-תקין - false, לא זורק", () => {
    expect(() => isTrustedCheckoutUrl("not a url")).not.toThrow();
    expect(isTrustedCheckoutUrl("not a url")).toBe(false);
  });
});

describe("תגובות Functions - מקרי קצה (401/404/409/429/502, גוף לא-JSON, שדות עודפים)", () => {
  it("401 מה-gateway (Authorization חסר/שגוי) - error, לא retryable (לא ייפתר בניסיון זהה חוזר)", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 401, httpErrorBody: { message: "Invalid JWT" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result.kind).toBe("error");
  });

  it("404 (ה-Function טרם נפרסה) - retryable: ברגע שתיפרס, אותה בקשה תצליח", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 404, httpErrorBody: null });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("429 (rate limit) - retryable", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 429, httpErrorBody: { error: "rate_limited" } });
    const result = await getProductAccess(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", accessToken: "tok" });
    expect(result).toEqual({ kind: "retryable" });
  });

  it("502 (payment_provider_error) - error ודאי, לא retryable", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 502, httpErrorBody: { error: "payment_provider_error" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "payment_provider_error" });
  });

  it("גוף תגובה שאינו JSON תקין (Response.json() זורק SyntaxError) - לא מפילה, נופלת ל-fallback גנרי", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 403, jsonThrows: true });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "http_403" });
  });

  it("response תקין עם שדות עודפים לא-צפויים - עדיין נקרא כתקין, השדות העודפים פשוט מתעלמים", async () => {
    const invoker = fakeInvoker({
      data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-1", paymentContextId: "po_abc", futureField: "כלשהו", debug: { extra: true } },
    });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-1", paymentContextId: "po_abc" });
  });

  it("response חסר paymentContextId (אחרת תקין לגמרי) - invalid_response_shape, לא מתרסק ולא מתעלם מהחוסר", async () => {
    const invoker = fakeInvoker({ data: { status: "pending", orderId: "order-1", checkoutUrl: TRUSTED_CHECKOUT_URL, accessToken: "tok-1" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "invalid_response_shape" });
  });

  it("אין גוף תגובה (data:null, error:null) - error מבני, לא חריגה לא-מטופלת", async () => {
    const invoker: FunctionsInvoker = {
      async invoke() {
        return { data: null, error: null };
      },
    };
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "error", reason: "invalid_response_shape" });
  });

  it("אין stack trace/מבנה טכני חשוף בתוצאה כלשהי - 500 מסווג retryable, אין reason טקסטואלי בכלל וקל וחומר לא stack", async () => {
    const invoker = fakeInvoker({ httpErrorStatus: 500, httpErrorBody: { error: "internal_error", stack: "at foo.ts:123\n at bar.ts:45" } });
    const result = await createPaymentOrder(invoker, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ kind: "retryable" });
    expect(JSON.stringify(result)).not.toContain("foo.ts");
  });
});
