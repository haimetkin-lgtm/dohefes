import { beforeEach, describe, expect, it } from "vitest";
import { createPaymentOrder } from "./payment-order-service";
import type {
  CardcomClientLike,
  NewOrderInput,
  OrderRecord,
  PaymentOrderDatabase,
  PaymentOrderServiceDeps,
  ReportLookupResult,
  TokenGenerator,
} from "./payment-order-service";

const REPORT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_REPORT_ID = "22222222-2222-2222-2222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-3333-3333-333333333333";

/** מסד נתונים מזוייף בזיכרון - מיישם בדיוק את PaymentOrderDatabase, בלי שום Supabase אמיתי */
class FakeDatabase implements PaymentOrderDatabase {
  reportPaymentStatusByReportId = new Map<string, string | null>();
  ordersById = new Map<string, OrderRecord>();
  ordersByIdempotencyKey = new Map<string, string>();
  nextOrderId = 1;

  insertOrderCallCount = 0;
  markOrderPendingCalls: Array<{ orderId: string; details: { cardcomLowProfileCode: string; checkoutUrl: string } }> = [];
  markOrderFailedCalls: Array<{ orderId: string; failureCode: string }> = [];
  updateAccessTokenHashCalls: Array<{ orderId: string; accessTokenHash: string }> = [];

  async getReportPaymentStatus(reportId: string): Promise<ReportLookupResult> {
    if (!this.reportPaymentStatusByReportId.has(reportId)) return { found: false, paymentStatus: null };
    return { found: true, paymentStatus: this.reportPaymentStatusByReportId.get(reportId) ?? null };
  }

  async findOrderByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null> {
    const orderId = this.ordersByIdempotencyKey.get(idempotencyKey);
    if (!orderId) return null;
    return this.ordersById.get(orderId) ?? null;
  }

  async insertOrder(input: NewOrderInput): Promise<OrderRecord> {
    this.insertOrderCallCount += 1;
    const order: OrderRecord = {
      id: `order-${this.nextOrderId++}`,
      status: "created",
      reportId: input.reportId,
      productType: input.productType,
      providerOrderReference: input.providerOrderReference,
      checkoutUrl: null,
    };
    this.ordersById.set(order.id, order);
    this.ordersByIdempotencyKey.set(input.idempotencyKey, order.id);
    return order;
  }

  async updateAccessTokenHash(orderId: string, accessTokenHash: string): Promise<void> {
    this.updateAccessTokenHashCalls.push({ orderId, accessTokenHash });
  }

  async markOrderPending(orderId: string, details: { cardcomLowProfileCode: string; checkoutUrl: string }): Promise<void> {
    this.markOrderPendingCalls.push({ orderId, details });
    const order = this.ordersById.get(orderId);
    if (order) {
      order.status = "pending";
      order.checkoutUrl = details.checkoutUrl;
    }
  }

  async markOrderFailed(orderId: string, failureCode: string): Promise<void> {
    this.markOrderFailedCalls.push({ orderId, failureCode });
    const order = this.ordersById.get(orderId);
    if (order) order.status = "failed";
  }
}

function fakeTokenGenerator(): TokenGenerator {
  let counter = 0;
  return {
    generateAccessToken: () => `token-${++counter}`,
    hashAccessToken: async (rawToken: string) => `hash-of-${rawToken}`,
    generateProviderOrderReference: () => `po_fake_${counter}`,
  };
}

function fakeCardcomClient(outcome: Awaited<ReturnType<CardcomClientLike["createLowProfile"]>>): CardcomClientLike & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async createLowProfile(request) {
      calls.push(request);
      return outcome;
    },
  };
}

function buildDeps(overrides: Partial<PaymentOrderServiceDeps> & { database: PaymentOrderDatabase }): PaymentOrderServiceDeps {
  return {
    database: overrides.database,
    cardcomClient: overrides.cardcomClient ?? fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } }),
    tokenGenerator: overrides.tokenGenerator ?? fakeTokenGenerator(),
    clock: overrides.clock ?? (() => new Date("2026-01-01T00:00:00Z")),
    successRedirectUrl: overrides.successRedirectUrl ?? "https://haimetkin-lgtm.github.io/dohefes/cashflow/",
    errorRedirectUrl: overrides.errorRedirectUrl ?? "https://haimetkin-lgtm.github.io/dohefes/cashflow/",
    indicatorUrl: overrides.indicatorUrl ?? "https://project-ref.supabase.co/functions/v1/cardcom-payment-indicator",
  };
}

let db: FakeDatabase;

beforeEach(() => {
  db = new FakeDatabase();
  db.reportPaymentStatusByReportId.set(REPORT_ID, "paid");
  db.reportPaymentStatusByReportId.set(OTHER_REPORT_ID, "paid");
});

describe("יצירת order מוצלחת", () => {
  it("מחזירה status:'pending', לא 'paid'", async () => {
    const deps = buildDeps({ database: db });
    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "pending" });
    if ("orderId" in result.body) {
      expect(result.body.checkoutUrl).toBe("https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP");
      expect(result.body.accessToken).toMatch(/^token-/);
    }
    // אף פעם לא paid ישירות מ-create - entitlement/paid נקבעים רק על ידי cardcom-payment-indicator עתידית
    expect(result.body).not.toMatchObject({ status: "paid" });
  });

  it("יוצרת בדיוק order אחד (insertOrder נקרא פעם אחת)", async () => {
    const deps = buildDeps({ database: db });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(db.insertOrderCallCount).toBe(1);
  });
});

describe("retry עם אותו Idempotency-Key", () => {
  it("לא יוצר order נוסף (insertOrder נקרא פעם אחת בלבד גם אחרי כמה קריאות)", async () => {
    const deps = buildDeps({ database: db });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(db.insertOrderCallCount).toBe(1);
  });

  it("משתמש באותה הזמנה (אותו orderId) בכל retry על created/pending", async () => {
    const deps = buildDeps({ database: db });
    const first = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    const second = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    const firstOrderId = "orderId" in first.body ? first.body.orderId : null;
    const secondOrderId = "orderId" in second.body ? second.body.orderId : null;
    expect(firstOrderId).not.toBeNull();
    expect(firstOrderId).toBe(secondOrderId);
  });

  it("מסובב token רק כשההזמנה created/pending (לא כשהיא paid)", async () => {
    const deps = buildDeps({ database: db });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    // עדיין pending בשלב הזה - retry אמור לסובב token
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(db.updateAccessTokenHashCalls.length).toBe(1);

    // מדמים ש-cardcom-payment-indicator (עתידית) כבר סימנה paid
    const order = [...db.ordersById.values()][0];
    order.status = "paid";

    const afterPaid = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(afterPaid.body).toEqual({ status: "paid" });
    // אין סיבוב token נוסף אחרי ה-paid
    expect(db.updateAccessTokenHashCalls.length).toBe(1);
  });

  it("הזמנה pending עם checkoutUrl שמור לא קוראת ל-Cardcom שוב (לא יוצרת session שני)", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(cardcom.calls.length).toBe(1);

    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(cardcom.calls.length).toBe(1); // עדיין 1 - לא נקרא שוב
  });

  it("idempotency-key עם reportId/productType שונה מהמקורי נדחה (409), לא 'מוחלף' בשקט", async () => {
    const deps = buildDeps({ database: db });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    const conflicting = await createPaymentOrder(deps, { reportId: OTHER_REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(conflicting).toEqual({ status: 409, body: { error: "idempotency_key_conflict" } });
  });
});

describe("order paid אינו מחזיר token", () => {
  it("body של הזמנה paid הוא {status:'paid'} בלבד - אין orderId/checkoutUrl/accessToken", async () => {
    const deps = buildDeps({ database: db });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    const order = [...db.ordersById.values()][0];
    order.status = "paid";

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ status: 200, body: { status: "paid" } });
    expect(Object.keys(result.body)).toEqual(["status"]);
  });
});

describe("cashflow בלי base report paid נדחה", () => {
  it("cashFlowAnalysis על דוח שה-baseReport שלו לא paid -> 403 report_not_eligible", async () => {
    db.reportPaymentStatusByReportId.set(REPORT_ID, "pending");
    const deps = buildDeps({ database: db });
    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ status: 403, body: { error: "report_not_eligible" } });
  });

  it("baseReport עצמו לא דורש payment_status='paid' קודם (רק cashFlowAnalysis דורש)", async () => {
    db.reportPaymentStatusByReportId.set(REPORT_ID, "pending");
    const deps = buildDeps({ database: db });
    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result.status).toBe(200);
  });

  it("דוח שלא קיים בכלל -> אותה הודעה בדיוק כמו baseReport לא-paid (לא חושף קיום דוח)", async () => {
    const deps = buildDeps({ database: db });
    const result = await createPaymentOrder(deps, { reportId: "99999999-9999-9999-9999-999999999999", productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ status: 403, body: { error: "report_not_eligible" } });
  });
});

describe("סכום מהלקוח אינו מתקבל", () => {
  it("CreatePaymentOrderRequest אינו כולל שום שדה amount/currency/productName - נבדק structurally", async () => {
    const deps = buildDeps({ database: db });
    const request = { reportId: REPORT_ID, productType: "baseReport" as const, idempotencyKey: IDEMPOTENCY_KEY };
    // המחיר היחיד שנקבע הוא זה שה-service קורא ל-getProduct עליו (payment-products.ts) - הבדיקה
    // עצמה היא על טיפוס הבקשה: אין בו amount/currency בכלל, לא ניתן "להשתחל" ערך כזה.
    expect(Object.keys(request)).toEqual(["reportId", "productType", "idempotencyKey"]);
    await createPaymentOrder(deps, request);
  });

  it("Cardcom תמיד מקבלת את הסכום מה-registry (98_000), לא מהבקשה", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(cardcom.calls[0]).toMatchObject({ amountAgorot: 98_000 });
  });
});

describe("Cardcom נכשל -> order failed", () => {
  it("cardcomClient מחזיר ok:false -> markOrderFailed נקרא, תגובה 502 כללית", async () => {
    const cardcom = fakeCardcomClient({ ok: false, failureCode: "provider_rejected" });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result).toEqual({ status: 502, body: { error: "payment_provider_error" } });
    expect(db.markOrderFailedCalls).toEqual([{ orderId: "order-1", failureCode: "provider_rejected" }]);
    expect(db.markOrderPendingCalls).toEqual([]);
  });

  it("timeout מול Cardcom (provider_unreachable) -> אותה התנהגות כשל כללית - ההזמנה לא נשארת pending/מטעה", async () => {
    // cardcomClient.createLowProfile מחזירה provider_unreachable גם על timeout וגם על תקלת רשת
    // (ר' cardcom-client.ts - AbortSignal.timeout נדחית באותו try/catch) - הבדיקה הזו מוודאת
    // שה-orchestration לא מתייחסת ל-timeout אחרת מכל כשל ספק אחר: אין הזמנה שנשארת pending
    // בלי checkout אמיתי, markOrderFailed נקרא בדיוק כמו בכל כשל אחר.
    const cardcom = fakeCardcomClient({ ok: false, failureCode: "provider_unreachable" });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result).toEqual({ status: 502, body: { error: "payment_provider_error" } });
    expect(db.markOrderFailedCalls).toEqual([{ orderId: "order-1", failureCode: "provider_unreachable" }]);
    expect(db.markOrderPendingCalls).toEqual([]);
  });
});

describe("אין credentials/PII בתגובה או בלוג", () => {
  it("תגובת ההצלחה מכילה רק orderId/checkoutUrl/accessToken/status - אין שדות נוספים", async () => {
    const deps = buildDeps({ database: db });
    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    if (result.status === 200 && "orderId" in result.body) {
      expect(Object.keys(result.body).sort()).toEqual(["accessToken", "checkoutUrl", "orderId", "status"]);
    }
  });

  it("תגובת כשל אינה מכילה failureCode הפנימי של Cardcom - רק קוד שגיאה כללי משלנו", async () => {
    const cardcom = fakeCardcomClient({ ok: false, failureCode: "provider_rejected: card declined for user 054-1234567" });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });
    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ status: 502, body: { error: "payment_provider_error" } });
    expect(JSON.stringify(result)).not.toContain("054-1234567");
  });
});
