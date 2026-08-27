import { beforeEach, describe, expect, it } from "vitest";
import { createPaymentOrder } from "./payment-order-service";
import type {
  CardcomClientLike,
  InsertOrderResult,
  NewOrderInput,
  OrderEntitlementLookup,
  OrderRecord,
  PaymentOrderAnomalyLogger,
  PaymentOrderDatabase,
  PaymentOrderServiceDeps,
  ReportLookupResult,
  TokenGenerator,
} from "./payment-order-service";

const REPORT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_REPORT_ID = "22222222-2222-2222-2222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-3333-3333-333333333333";
const OTHER_IDEMPOTENCY_KEY = "44444444-4444-4444-4444-444444444444";

const BLOCKING_STATUSES = new Set(["created", "pending", "paid"]);

/** מסד נתונים מזוייף בזיכרון - מיישם בדיוק את PaymentOrderDatabase, בלי שום Supabase אמיתי.
 *  findBlockingOrderForProduct כאן מיישמת בפועל את אותו פרדיקט כמו ה-partial unique index
 *  (idx_dohefes_payment_orders_one_active_per_report_product, ר' payment-schema.sql) - created/
 *  pending/paid בלבד - כדי שהבדיקות כאן ישקפו נכון את מה שה-DB האמיתי היה עושה. */
class FakeDatabase implements PaymentOrderDatabase {
  reportPaymentStatusByReportId = new Map<string, string | null>();
  ordersById = new Map<string, OrderRecord>();
  ordersByIdempotencyKey = new Map<string, string>();
  entitlementsByKey = new Map<string, OrderEntitlementLookup>();
  nextOrderId = 1;

  insertOrderCallCount = 0;
  /** כשמופעל, ה-insertOrder **הבאה** תדמה race: "בקשה מקבילה" כבר יוצרת ומכניסה שורה משלה
   *  (winner), ומחזירה {ok:false} לקריאה הנוכחית - בדיוק כמו unique_violation אמיתי על ה-index. */
  simulateRaceOnNextInsert = false;
  raceWinnerOverrides: Partial<OrderRecord> = {};

  findBlockingOrderCalls: Array<{ reportId: string; productType: string }> = [];
  getEntitlementCalls: Array<{ reportId: string; productType: string }> = [];
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

  async findBlockingOrderForProduct(reportId: string, productType: string): Promise<OrderRecord | null> {
    this.findBlockingOrderCalls.push({ reportId, productType });
    for (const order of this.ordersById.values()) {
      if (order.reportId === reportId && order.productType === productType && BLOCKING_STATUSES.has(order.status)) {
        return order;
      }
    }
    return null;
  }

  async insertOrder(input: NewOrderInput): Promise<InsertOrderResult> {
    this.insertOrderCallCount += 1;

    if (this.simulateRaceOnNextInsert) {
      this.simulateRaceOnNextInsert = false;
      const winner: OrderRecord = {
        id: "order-race-winner",
        status: "pending",
        reportId: input.reportId,
        productType: input.productType,
        providerOrderReference: "po_race_winner",
        checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/race-winner",
        ...this.raceWinnerOverrides,
      };
      this.ordersById.set(winner.id, winner);
      return { ok: false };
    }

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
    return { ok: true, order };
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

  async getEntitlement(reportId: string, productType: string): Promise<OrderEntitlementLookup | null> {
    this.getEntitlementCalls.push({ reportId, productType });
    return this.entitlementsByKey.get(`${reportId}:${productType}`) ?? null;
  }

  setEntitlement(reportId: string, productType: string, entitlementStatus: OrderEntitlementLookup["entitlementStatus"]): void {
    this.entitlementsByKey.set(`${reportId}:${productType}`, { entitlementStatus });
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

function fakeAnomalyLogger(): PaymentOrderAnomalyLogger & { calls: Array<{ reason: string; reportId: string; productType: string }> } {
  const calls: Array<{ reason: string; reportId: string; productType: string }> = [];
  return {
    calls,
    logAnomaly(event) {
      calls.push(event);
    },
  };
}

function buildDeps(overrides: Partial<PaymentOrderServiceDeps> & { database: PaymentOrderDatabase }): PaymentOrderServiceDeps {
  return {
    database: overrides.database,
    cardcomClient: overrides.cardcomClient ?? fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } }),
    tokenGenerator: overrides.tokenGenerator ?? fakeTokenGenerator(),
    clock: overrides.clock ?? (() => new Date("2026-01-01T00:00:00Z")),
    anomalyLogger: overrides.anomalyLogger ?? fakeAnomalyLogger(),
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
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(db.updateAccessTokenHashCalls.length).toBe(1);

    // מדמים ש-cardcom-payment-indicator (עתידית) כבר סימנה paid + יצרה entitlement פעילה
    const order = [...db.ordersById.values()][0];
    order.status = "paid";
    db.setEntitlement(REPORT_ID, "baseReport", "active");

    const afterPaid = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(afterPaid.body).toEqual({ status: "paid" });
    expect(db.updateAccessTokenHashCalls.length).toBe(1);
  });

  it("הזמנה pending עם checkoutUrl שמור לא קוראת ל-Cardcom שוב (לא יוצרת session שני)", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(cardcom.calls.length).toBe(1);

    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(cardcom.calls.length).toBe(1);
  });

  it("idempotency-key עם reportId/productType שונה מהמקורי נדחה (409), לא 'מוחלף' בשקט", async () => {
    const deps = buildDeps({ database: db });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    const conflicting = await createPaymentOrder(deps, { reportId: OTHER_REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(conflicting).toEqual({ status: 409, body: { error: "idempotency_key_conflict" } });
  });
});

describe("order paid אינו מחזיר token", () => {
  it("body של הזמנה paid (עם entitlement פעילה) הוא {status:'paid'} בלבד - אין orderId/checkoutUrl/accessToken", async () => {
    const deps = buildDeps({ database: db });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    const order = [...db.ordersById.values()][0];
    order.status = "paid";
    db.setEntitlement(REPORT_ID, "baseReport", "active");

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

// --- מניעת הזמנות בלתי-מוגבלות (ממצא ביקורת "חובה לפני ניסיון אמיתי") ---

describe("שתי בקשות סדרתיות עם Idempotency-Key שונים לאותו report+product", () => {
  it("רק הזמנה אחת נוצרת - הבקשה השנייה מאתרת אותה ומסובבת token, לא יוצרת session שני", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    const first = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    const second = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: OTHER_IDEMPOTENCY_KEY });

    expect(db.insertOrderCallCount).toBe(1);
    expect(cardcom.calls.length).toBe(1);
    // findBlockingOrderForProduct נקראת בשתי הבקשות (גם בראשונה, לפני שמחליטה ליצור - שם היא
    // לא מוצאת כלום ולכן ממשיכה ל-insert; בשנייה היא מוצאת את ההזמנה שהראשונה יצרה).
    expect(db.findBlockingOrderCalls.length).toBe(2);

    const firstOrderId = "orderId" in first.body ? first.body.orderId : null;
    const secondOrderId = "orderId" in second.body ? second.body.orderId : null;
    expect(secondOrderId).toBe(firstOrderId);
    expect(second.status).toBe(200);
  });
});

describe("מרוץ מדומה: שתי בקשות כמעט-בו-זמניות עם Idempotency-Key שונים", () => {
  it("insertOrder נכשל (race על ה-partial unique index) -> מאתרים את המנצח, אין שגיאת unique גולמית, אין session כפול", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });
    db.simulateRaceOnNextInsert = true; // "המנצח" (order-race-winner, pending+checkoutUrl) נוצר בתוך insertOrder עצמה

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result.status).toBe(200);
    if (result.status === 200 && "orderId" in result.body) {
      expect(result.body.orderId).toBe("order-race-winner");
      expect(result.body.checkoutUrl).toBe("https://secure.cardcom.solutions/EA/EA5/race-winner");
    }
    // המנצח כבר pending עם checkoutUrl שמור - אין קריאה נוספת ל-Cardcom בכלל מהנתיב הזה.
    expect(cardcom.calls.length).toBe(0);
  });

  it("מנצח race שהוא created בלי checkout עדיין - ממשיכים ליצור session **לאותה** הזמנה, בלי insert נוסף", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });
    db.simulateRaceOnNextInsert = true;
    db.raceWinnerOverrides = { status: "created", checkoutUrl: null };

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result.status).toBe(200);
    expect(cardcom.calls.length).toBe(1); // קריאה אחת בלבד, לאותה הזמנה (order-race-winner)
    expect(db.insertOrderCallCount).toBe(1); // ה-insert היחיד הוא זה שנכשל (race) - לא בוצע insert נוסף
    expect(db.markOrderPendingCalls).toEqual([
      { orderId: "order-race-winner", details: { cardcomLowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } },
    ]);
  });
});

describe("pending קיים (Idempotency-Key אחר)", () => {
  it("מחזיר את ה-checkoutUrl הקיים, מסובב token, לא יוצר הזמנה/session חדשים", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    const existing: OrderRecord = {
      id: "order-existing",
      status: "pending",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_existing",
      checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/existing",
    };
    db.ordersById.set(existing.id, existing);

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(db.insertOrderCallCount).toBe(0);
    expect(cardcom.calls.length).toBe(0);
    expect(db.updateAccessTokenHashCalls).toEqual([{ orderId: "order-existing", accessTokenHash: "hash-of-token-1" }]);
    if (result.status === 200 && "orderId" in result.body) {
      expect(result.body.orderId).toBe("order-existing");
      expect(result.body.checkoutUrl).toBe("https://secure.cardcom.solutions/EA/EA5/existing");
    }
  });
});

describe("created קיים ללא checkout (Idempotency-Key אחר)", () => {
  it("ממשיך ליצור session לאותה הזמנה (UPDATE), לא insert נוסף", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    const existing: OrderRecord = {
      id: "order-existing",
      status: "created",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_existing",
      checkoutUrl: null,
    };
    db.ordersById.set(existing.id, existing);

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(db.insertOrderCallCount).toBe(0);
    expect(cardcom.calls.length).toBe(1);
    expect(db.markOrderPendingCalls[0].orderId).toBe("order-existing");
    expect(result.status).toBe(200);
  });
});

describe("paid עם entitlement פעיל (Idempotency-Key אחר)", () => {
  it("מחזיר {status:'paid'}, בלי token, בלי insert/session חדשים", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    const existing: OrderRecord = {
      id: "order-paid",
      status: "paid",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_paid",
      checkoutUrl: null,
    };
    db.ordersById.set(existing.id, existing);
    db.setEntitlement(REPORT_ID, "baseReport", "active");

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result).toEqual({ status: 200, body: { status: "paid" } });
    expect(db.insertOrderCallCount).toBe(0);
    expect(cardcom.calls.length).toBe(0);
    expect(db.updateAccessTokenHashCalls).toEqual([]);
  });
});

describe("paid ללא entitlement (אנומליה - fail-closed)", () => {
  it("לא יוצר תשלום נוסף, לא 'מתקן' בשקט - מחזיר שגיאה פנימית כללית ומתעד אזהרה בלי מזהים רגישים", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const anomalyLogger = fakeAnomalyLogger();
    const deps = buildDeps({ database: db, cardcomClient: cardcom, anomalyLogger });

    const existing: OrderRecord = {
      id: "order-paid-no-entitlement",
      status: "paid",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_paid_anomaly",
      checkoutUrl: null,
    };
    db.ordersById.set(existing.id, existing);
    // בכוונה בלי db.setEntitlement - מייצג הפרה של הערבות של dohefes_finalize_verified_payment.

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result).toEqual({ status: 500, body: { error: "internal_error" } });
    expect(db.insertOrderCallCount).toBe(0);
    expect(cardcom.calls.length).toBe(0);
    expect(anomalyLogger.calls).toEqual([{ reason: "paid_order_without_entitlement", reportId: REPORT_ID, productType: "baseReport" }]);
    // אין מזהים רגישים (token/פרטי Cardcom) באזהרה - רק reason/reportId/productType.
    expect(Object.keys(anomalyLogger.calls[0]).sort()).toEqual(["productType", "reason", "reportId"]);
  });

  it("אותה אנומליה גם כשנמצאת דרך idempotency-key מדויק (לא רק דרך findBlockingOrderForProduct)", async () => {
    const deps = buildDeps({ database: db });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    const order = [...db.ordersById.values()][0];
    order.status = "paid";
    // שוב, בכוונה בלי entitlement.

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ status: 500, body: { error: "internal_error" } });
  });
});

describe("failed מאפשר ניסיון חדש", () => {
  it("הזמנה failed לא נחסמת - Idempotency-Key חדש יוצר הזמנה חדשה כרגיל", async () => {
    const deps = buildDeps({ database: db });
    const existing: OrderRecord = {
      id: "order-failed",
      status: "failed",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_failed",
      checkoutUrl: null,
    };
    db.ordersById.set(existing.id, existing);

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(db.insertOrderCallCount).toBe(1);
    expect(result.status).toBe(200);
    if (result.status === 200 && "orderId" in result.body) {
      expect(result.body.orderId).not.toBe("order-failed");
    }
  });
});

describe("refunded מאפשר ניסיון חדש", () => {
  it("הזמנה refunded לא נחסמת - Idempotency-Key חדש יוצר הזמנה חדשה כרגיל", async () => {
    const deps = buildDeps({ database: db });
    const existing: OrderRecord = {
      id: "order-refunded",
      status: "refunded",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_refunded",
      checkoutUrl: null,
    };
    db.ordersById.set(existing.id, existing);

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(db.insertOrderCallCount).toBe(1);
    expect(result.status).toBe(200);
    if (result.status === 200 && "orderId" in result.body) {
      expect(result.body.orderId).not.toBe("order-refunded");
    }
  });

  it("cancelled גם הוא לא חוסם (אותה משפחת סטטוסים סופיים לא-משולמים)", async () => {
    const deps = buildDeps({ database: db });
    const existing: OrderRecord = {
      id: "order-cancelled",
      status: "cancelled",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_cancelled",
      checkoutUrl: null,
    };
    db.ordersById.set(existing.id, existing);

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(db.insertOrderCallCount).toBe(1);
    expect(result.status).toBe(200);
  });
});

describe("מוצר אחר באותו report אינו נחסם", () => {
  it("הזמנה חוסמת ל-baseReport לא מונעת יצירת הזמנה ל-cashFlowAnalysis באותו דוח", async () => {
    const deps = buildDeps({ database: db });
    const blockingBaseReport: OrderRecord = {
      id: "order-base-pending",
      status: "pending",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_base_pending",
      checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/base",
    };
    db.ordersById.set(blockingBaseReport.id, blockingBaseReport);
    // REPORT_ID כבר "paid" (ר' beforeEach) - עומד בתנאי הסף של cashFlowAnalysis.

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "cashFlowAnalysis", idempotencyKey: IDEMPOTENCY_KEY });

    expect(db.insertOrderCallCount).toBe(1);
    expect(result.status).toBe(200);
    if (result.status === 200 && "orderId" in result.body) {
      expect(result.body.orderId).not.toBe("order-base-pending");
    }
  });
});

describe("report אחר אינו נחסם", () => {
  it("הזמנה חוסמת בדוח אחד לא משפיעה על אותו productType בדוח אחר", async () => {
    const deps = buildDeps({ database: db });
    const blockingOtherReport: OrderRecord = {
      id: "order-other-report-pending",
      status: "pending",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_other_report",
      checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/other",
    };
    db.ordersById.set(blockingOtherReport.id, blockingOtherReport);

    const result = await createPaymentOrder(deps, { reportId: OTHER_REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(db.insertOrderCallCount).toBe(1);
    expect(result.status).toBe(200);
    if (result.status === 200 && "orderId" in result.body) {
      expect(result.body.orderId).not.toBe("order-other-report-pending");
    }
  });
});
