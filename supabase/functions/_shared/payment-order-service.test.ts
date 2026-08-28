import { beforeEach, describe, expect, it } from "vitest";
import { createPaymentOrder } from "./payment-order-service";
import type {
  CardcomClientLike,
  ClaimResult,
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

const BLOCKING_STATUSES = new Set(["created", "pending", "paid"]);
const LEASE_SECONDS = 30;
const NOW_MS = Date.parse("2026-01-01T00:00:00Z");

interface ClaimState {
  token: string;
  expiresAtMs: number;
}

/** מסד נתונים מזוייף בזיכרון - מיישם בדיוק את PaymentOrderDatabase, בלי שום Supabase אמיתי.
 *  claimCheckoutCreation מדמה את סמנטיקת ה-CAS של dohefes_claim_checkout_creation (UPDATE אטומי
 *  יחיד ב-Postgres): claim מוענק רק אם ההזמנה 'created' וגם (אין claim פעיל, או שהוא פג לפי
 *  nowMs - נשלט ידנית מהבדיקות כדי לדמות תפוגת lease בלי טיימרים אמיתיים). */
class FakeDatabase implements PaymentOrderDatabase {
  reportPaymentStatusByReportId = new Map<string, string | null>();
  ordersById = new Map<string, OrderRecord>();
  ordersByIdempotencyKey = new Map<string, string>();
  entitlementsByKey = new Map<string, OrderEntitlementLookup>();
  claims = new Map<string, ClaimState>();
  nowMs = NOW_MS;
  nextOrderId = 1;

  insertOrderCallCount = 0;
  simulateRaceOnNextInsert = false;
  raceWinnerOverrides: Partial<OrderRecord> = {};

  findBlockingOrderCalls: Array<{ reportId: string; productType: string }> = [];
  getEntitlementCalls: Array<{ reportId: string; productType: string }> = [];
  updateAccessTokenHashCalls: Array<{ orderId: string; accessTokenHash: string }> = [];
  claimCheckoutCreationCalls: Array<{ orderId: string; claimToken: string; leaseSeconds: number }> = [];
  releaseClaimAsPendingCalls: Array<{ orderId: string; claimToken: string; details: { cardcomLowProfileCode: string; checkoutUrl: string } }> = [];
  releaseClaimAsFailedCalls: Array<{ orderId: string; claimToken: string; failureCode: string }> = [];

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

  async claimCheckoutCreation(orderId: string, claimToken: string, leaseSeconds: number): Promise<ClaimResult> {
    this.claimCheckoutCreationCalls.push({ orderId, claimToken, leaseSeconds });
    const order = this.ordersById.get(orderId);
    if (!order || order.status !== "created") return { claimed: false };

    const existing = this.claims.get(orderId);
    const activeClaimHeld = existing !== undefined && existing.expiresAtMs > this.nowMs;
    if (activeClaimHeld) return { claimed: false };

    this.claims.set(orderId, { token: claimToken, expiresAtMs: this.nowMs + leaseSeconds * 1000 });
    return { claimed: true };
  }

  async releaseClaimAsPending(
    orderId: string,
    claimToken: string,
    details: { cardcomLowProfileCode: string; checkoutUrl: string }
  ): Promise<boolean> {
    this.releaseClaimAsPendingCalls.push({ orderId, claimToken, details });
    const current = this.claims.get(orderId);
    if (!current || current.token !== claimToken) return false;
    this.claims.delete(orderId);
    const order = this.ordersById.get(orderId);
    if (order) {
      order.status = "pending";
      order.checkoutUrl = details.checkoutUrl;
    }
    return true;
  }

  async releaseClaimAsFailed(orderId: string, claimToken: string, failureCode: string): Promise<boolean> {
    this.releaseClaimAsFailedCalls.push({ orderId, claimToken, failureCode });
    const current = this.claims.get(orderId);
    if (!current || current.token !== claimToken) return false;
    this.claims.delete(orderId);
    const order = this.ordersById.get(orderId);
    if (order) order.status = "failed";
    return true;
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
    generateClaimToken: () => `claim-${++counter}`,
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

function fakeAnomalyLogger(): PaymentOrderAnomalyLogger & { calls: Array<{ reason: string; productType: string }> } {
  const calls: Array<{ reason: string; productType: string }> = [];
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
    indicatorUrl: overrides.indicatorUrl ?? "https://project-ref.supabase.co/functions/v1/dohefes-cardcom-payment-indicator",
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

  it("claim משוחרר בהצלחה - אין claim פעיל שנשאר אחרי הזמנה שהושלמה", async () => {
    const deps = buildDeps({ database: db });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    const order = [...db.ordersById.values()][0];
    expect(db.claims.has(order.id)).toBe(false);
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

  it("מסובב token בכל קריאה כשההזמנה created/pending, אך לא יותר אחרי שהיא paid", async () => {
    const deps = buildDeps({ database: db });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    // 2 קריאות = 2 סיבובים (הראשונה - יצירה טרייה; השנייה - retry על pending+checkoutUrl כבר קיים).
    expect(db.updateAccessTokenHashCalls.length).toBe(2);

    const order = [...db.ordersById.values()][0];
    order.status = "paid";
    db.setEntitlement(REPORT_ID, "baseReport", "active");

    const afterPaid = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(afterPaid.body).toEqual({ status: "paid" });
    // אין סיבוב token נוסף אחרי ה-paid - נשאר על 2.
    expect(db.updateAccessTokenHashCalls.length).toBe(2);
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

describe("Cardcom נכשל בוודאות -> order failed (claim משוחרר)", () => {
  it("cardcomClient מחזיר ok:false (כשל ודאי) -> releaseClaimAsFailed נקרא, תגובה 502 כללית", async () => {
    const cardcom = fakeCardcomClient({ ok: false, failureCode: "provider_rejected" });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result).toEqual({ status: 502, body: { error: "payment_provider_error" } });
    expect(db.releaseClaimAsFailedCalls.length).toBe(1);
    expect(db.releaseClaimAsFailedCalls[0]).toMatchObject({ orderId: "order-1", failureCode: "provider_rejected" });
    expect(db.releaseClaimAsFailedCalls[0].claimToken).toMatch(/^claim-/);
    expect(db.releaseClaimAsPendingCalls).toEqual([]);
    expect([...db.ordersById.values()][0].status).toBe("failed");
  });

  it("ממצא ביקורת סופית: אם releaseClaimAsFailed מאבד בעלות (claim נדרס בינתיים) - הכשל לא מוסתר, מתועדת אזהרה, ותגובה retryable (לא 'failed' שקרי)", async () => {
    // מדמה: בדיוק כשה-cardcomClient מחזירה כשל ודאי, "מישהו אחר" כבר תפס claim חדש על אותה
    // הזמנה (חריגה נדירה מה-lease) - releaseClaimAsFailed (ה-fake, כמו ה-DB האמיתי) מתנה על
    // claimToken תואם ומחזירה false כי הוא כבר לא תואם.
    const cardcom: CardcomClientLike & { calls: unknown[] } = {
      calls: [],
      async createLowProfile(request) {
        this.calls.push(request);
        // "בעלים אחר" כבר תפס claim חדש - claimToken שונה מזה שהשירות מחזיק כרגע.
        const order = [...db.ordersById.values()][0];
        db.claims.set(order.id, { token: "claim-stolen-by-someone-else", expiresAtMs: db.nowMs + LEASE_SECONDS * 1000 });
        return { ok: false, failureCode: "provider_rejected" };
      },
    };
    const anomalyLogger = fakeAnomalyLogger();
    const deps = buildDeps({ database: db, cardcomClient: cardcom, anomalyLogger });

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    // לא "עבר בשקט" - retryable (503), לא 502 "failed" שקרי (גורל ההזמנה ביד הבעלים החדש כרגע).
    expect(result).toEqual({ status: 503, body: { error: "checkout_creation_in_progress" } });
    // הניסיון לשחרר-כ-failed כן קרה (לא דולג) - רק לא הצליח, וזה תועד:
    expect(db.releaseClaimAsFailedCalls.length).toBe(1);
    expect([...db.ordersById.values()][0].status).toBe("created"); // לא "failed" - ה-UPDATE לא תפס
    expect(anomalyLogger.calls).toEqual([{ reason: "claim_release_as_failed_lost_ownership", productType: "baseReport" }]);
  });
});

describe("timeout (כשל לא ודאי) - לא failed, לא claim משוחרר, לא קריאה שנייה מיידית", () => {
  it("provider_unreachable -> 503 retryable (אותה תגובה כללית כמו 'claim תפוס') לקורא שחווה את זה בעצמו, ההזמנה נשארת 'created' וה-claim נשאר פעיל", async () => {
    // 503 checkout_creation_in_progress, לא 502 - כי מבחינת המערכת "עדיין לא נפתר" (retryable)
    // הוא בדיוק אותו מסר לקורא שחווה בעצמו timeout כמו לקורא אחר שמצא claim פעיל של מישהו אחר -
    // בשני המקרים הפעולה הנכונה זהה (retry), ואין תועלת בהבחנה מלאכותית בין 502 ל-503 כאן.
    const cardcom = fakeCardcomClient({ ok: false, failureCode: "provider_unreachable" });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result).toEqual({ status: 503, body: { error: "checkout_creation_in_progress" } });
    expect(db.releaseClaimAsFailedCalls).toEqual([]);
    const order = [...db.ordersById.values()][0];
    expect(order.status).toBe("created"); // לא failed - ייתכן ש-Cardcom כן יצרה session
    expect(db.claims.has(order.id)).toBe(true); // ה-claim עדיין פעיל, לא שוחרר
  });

  it("provider_http_503 (5xx) מטופל זהה - לא ודאי, לא failed", async () => {
    const cardcom = fakeCardcomClient({ ok: false, failureCode: "provider_http_503" });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(db.releaseClaimAsFailedCalls).toEqual([]);
    expect([...db.ordersById.values()][0].status).toBe("created");
  });

  it("timeout אינו גורם מיד לקריאת Cardcom שנייה - retry מיידי (לפני שה-lease פג) מקבל retryable בלי לגעת ב-Cardcom", async () => {
    const cardcom = fakeCardcomClient({ ok: false, failureCode: "provider_unreachable" });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(cardcom.calls.length).toBe(1);

    // retry מיידי, עדיין באותו lease - לא אמור לגעת ב-Cardcom שוב.
    const retry = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(cardcom.calls.length).toBe(1);
    expect(retry).toEqual({ status: 503, body: { error: "checkout_creation_in_progress" } });
  });
});

describe("claim פעיל אינו ניתן להשתלטות לפני פקיעתו", () => {
  it("שתי בקשות עוקבות (idempotency-key זהה) לפני שה-claim הראשון שוחרר - השנייה retryable, בלי Cardcom", async () => {
    const order: OrderRecord = {
      id: "order-created",
      status: "created",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_created",
      checkoutUrl: null,
    };
    db.ordersById.set(order.id, order);
    db.ordersByIdempotencyKey.set(IDEMPOTENCY_KEY, order.id);
    db.claims.set(order.id, { token: "claim-held-by-someone-else", expiresAtMs: db.nowMs + LEASE_SECONDS * 1000 });

    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const result = await createPaymentOrder(buildDeps({ database: db, cardcomClient: cardcom }), {
      reportId: REPORT_ID,
      productType: "baseReport",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result).toEqual({ status: 503, body: { error: "checkout_creation_in_progress" } });
    expect(cardcom.calls.length).toBe(0);
    expect(db.updateAccessTokenHashCalls).toEqual([]);
  });
});

describe("claim שפג ניתן להשתלטות", () => {
  it("claim שפג (nowMs עבר את expiresAtMs) מאפשר claim חדש וקריאה חדשה ל-Cardcom", async () => {
    const order: OrderRecord = {
      id: "order-created",
      status: "created",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_created",
      checkoutUrl: null,
    };
    db.ordersById.set(order.id, order);
    db.ordersByIdempotencyKey.set(IDEMPOTENCY_KEY, order.id);
    db.claims.set(order.id, { token: "claim-expired", expiresAtMs: db.nowMs - 1 }); // כבר פג

    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const result = await createPaymentOrder(buildDeps({ database: db, cardcomClient: cardcom }), {
      reportId: REPORT_ID,
      productType: "baseReport",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(cardcom.calls.length).toBe(1);
    expect(result.status).toBe(200);
    if (result.status === 200 && "checkoutUrl" in result.body) {
      expect(result.body.checkoutUrl).toBe("https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP");
    }
  });
});

describe("שתי בקשות מקבילות (Idempotency-Key שונים) לאותה הזמנה created - רק קריאת Cardcom אחת", () => {
  it("המנצחת קוראת ל-Cardcom פעם אחת; המפסידה retryable, בלי token מטעה", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    // בקשה א' מכניסה את ההזמנה ל-created (מדמה insert שכבר קרה, כמו בתיאור המרוץ המקורי).
    const inserted: OrderRecord = {
      id: "order-a",
      status: "created",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_a",
      checkoutUrl: null,
    };
    db.ordersById.set(inserted.id, inserted);
    db.ordersByIdempotencyKey.set(IDEMPOTENCY_KEY, inserted.id);

    // מדמים "בקשה ב' תפסה claim ראשונה" (כאילו הריצה שלה כבר עברה את השלב הזה בדיוק לפני א').
    db.claims.set(inserted.id, { token: "claim-b-won", expiresAtMs: db.nowMs + LEASE_SECONDS * 1000 });

    // עכשיו בקשה א' (idempotency-key המקורי) מגיעה לאותה הזמנה - אמורה להפסיד את ה-claim.
    const resultA = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(resultA).toEqual({ status: 503, body: { error: "checkout_creation_in_progress" } });
    expect(cardcom.calls.length).toBe(0); // א' לא קראה ל-Cardcom בכלל
    expect(JSON.stringify(resultA)).not.toContain("accessToken");
    expect(JSON.stringify(resultA)).not.toContain("checkoutUrl");
  });
});

describe("הצלחה סוגרת claim ומחזירה תמיד את אותו checkout", () => {
  it("שתי קריאות עוקבות (אחרי הצלחה) מחזירות את אותו checkoutUrl, בלי claim/Cardcom נוסף", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });

    const first = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    const second = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(cardcom.calls.length).toBe(1);
    if (first.status === 200 && "checkoutUrl" in first.body && second.status === 200 && "checkoutUrl" in second.body) {
      expect(second.body.checkoutUrl).toBe(first.body.checkoutUrl);
    }
    const order = [...db.ordersById.values()][0];
    expect(db.claims.has(order.id)).toBe(false);
  });
});

describe("pending קיים אינו יוצר session חדש", () => {
  it("הזמנה pending+checkoutUrl קיימת (Idempotency-Key אחר) - fast-path, אין claim, אין Cardcom", async () => {
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
    expect(db.claimCheckoutCreationCalls).toEqual([]);
    expect(db.updateAccessTokenHashCalls).toEqual([{ orderId: "order-existing", accessTokenHash: "hash-of-token-1" }]);
    if (result.status === 200 && "orderId" in result.body) {
      expect(result.body.checkoutUrl).toBe("https://secure.cardcom.solutions/EA/EA5/existing");
    }
  });
});

describe("created קיים ללא checkout (Idempotency-Key אחר)", () => {
  it("ממשיך ליצור session לאותה הזמנה (claim + UPDATE), לא insert נוסף", async () => {
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
    expect(db.releaseClaimAsPendingCalls[0].orderId).toBe("order-existing");
    expect(result.status).toBe(200);
  });
});

describe("paid עם entitlement פעיל (Idempotency-Key אחר)", () => {
  it("מחזיר {status:'paid'}, בלי token, בלי insert/session/claim חדשים", async () => {
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
    expect(db.claimCheckoutCreationCalls).toEqual([]);
    expect(db.updateAccessTokenHashCalls).toEqual([]);
  });
});

describe("paid ללא entitlement (אנומליה - fail-closed)", () => {
  it("לא יוצר תשלום נוסף, לא 'מתקן' בשקט - מחזיר שגיאה פנימית כללית, מתעד אזהרה בלי reportId/מזהים רגישים", async () => {
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

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result).toEqual({ status: 500, body: { error: "internal_error" } });
    expect(db.insertOrderCallCount).toBe(0);
    expect(cardcom.calls.length).toBe(0);
    expect(anomalyLogger.calls).toEqual([{ reason: "paid_order_without_entitlement", productType: "baseReport" }]);
    // reportId **לא** נכלל בכוונה - הוא מזהה גישה בפועל (ר' payment-order-service.ts).
    expect(Object.keys(anomalyLogger.calls[0]).sort()).toEqual(["productType", "reason"]);
    expect(JSON.stringify(anomalyLogger.calls[0])).not.toContain(REPORT_ID);
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

describe("מרוץ מדומה: insert נכשל (partial unique index), מנצח created-בלי-checkout", () => {
  it("ממשיכים ליצור session **לאותה** הזמנה (המנצחת), בלי insert נוסף, קריאת Cardcom אחת", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });
    db.simulateRaceOnNextInsert = true;
    db.raceWinnerOverrides = { status: "created", checkoutUrl: null };

    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result.status).toBe(200);
    expect(cardcom.calls.length).toBe(1);
    expect(db.insertOrderCallCount).toBe(1);
    expect(db.releaseClaimAsPendingCalls[0].orderId).toBe("order-race-winner");
  });
});

describe("מרוץ בין השלמת checkout לבין בקשת retry", () => {
  it("retry שמגיע *לפני* שהמנצחת סיימה - retryable, בלי checkoutUrl חלקי/שגוי", async () => {
    const deps = buildDeps({ database: db });
    const order: OrderRecord = {
      id: "order-in-flight",
      status: "created",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_in_flight",
      checkoutUrl: null,
    };
    db.ordersById.set(order.id, order);
    db.ordersByIdempotencyKey.set(IDEMPOTENCY_KEY, order.id);
    // מדמה "בקשה אחרת" שכבר תפסה claim ועדיין לא סיימה (לא released).
    db.claims.set(order.id, { token: "claim-in-flight", expiresAtMs: db.nowMs + LEASE_SECONDS * 1000 });

    const retry = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(retry).toEqual({ status: 503, body: { error: "checkout_creation_in_progress" } });
    expect(order.status).toBe("created"); // לא נגעו בהזמנה
    expect(order.checkoutUrl).toBeNull();
  });

  it("retry שמגיע *אחרי* שהמנצחת סיימה - מקבל בדיוק את אותו checkoutUrl הקנוני, בלי claim/Cardcom נוסף", async () => {
    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });
    const order: OrderRecord = {
      id: "order-finished",
      status: "pending", // "המנצחת" כבר סיימה - released כ-pending עם checkoutUrl קנוני
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_finished",
      checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/canonical",
    };
    db.ordersById.set(order.id, order);
    db.ordersByIdempotencyKey.set(IDEMPOTENCY_KEY, order.id);

    const retry = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(cardcom.calls.length).toBe(0);
    expect(db.claimCheckoutCreationCalls).toEqual([]);
    if (retry.status === 200 && "checkoutUrl" in retry.body) {
      expect(retry.body.checkoutUrl).toBe("https://secure.cardcom.solutions/EA/EA5/canonical");
    } else {
      throw new Error("expected success shape");
    }
  });
});

describe("אין דליפה של claim token, access token או פרטי Cardcom", () => {
  it("תגובת checkout_creation_in_progress (503) לא מכילה claim token/access token כלשהו", async () => {
    const order: OrderRecord = {
      id: "order-created",
      status: "created",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_created",
      checkoutUrl: null,
    };
    db.ordersById.set(order.id, order);
    db.ordersByIdempotencyKey.set(IDEMPOTENCY_KEY, order.id);
    db.claims.set(order.id, { token: "super-secret-claim-token-xyz", expiresAtMs: db.nowMs + LEASE_SECONDS * 1000 });

    const deps = buildDeps({ database: db });
    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result).toEqual({ status: 503, body: { error: "checkout_creation_in_progress" } });
    expect(Object.keys(result.body)).toEqual(["error"]);
    expect(JSON.stringify(result)).not.toContain("super-secret-claim-token-xyz");
  });

  it("תגובת כשל ודאי אינה מכילה failureCode הפנימי של Cardcom - רק קוד שגיאה כללי משלנו", async () => {
    const cardcom = fakeCardcomClient({ ok: false, failureCode: "provider_rejected: card declined for user 054-1234567" });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });
    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    expect(result).toEqual({ status: 502, body: { error: "payment_provider_error" } });
    expect(JSON.stringify(result)).not.toContain("054-1234567");
  });

  it("תגובת ההצלחה מכילה רק orderId/checkoutUrl/accessToken/status - אין שדות נוספים (כולל לא claim token)", async () => {
    const deps = buildDeps({ database: db });
    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });
    if (result.status === 200 && "orderId" in result.body) {
      expect(Object.keys(result.body).sort()).toEqual(["accessToken", "checkoutUrl", "orderId", "status"]);
    }
  });
});

describe("אי-מוטציה ותוצאות סופיות ללא NaN/ערכים חסרים", () => {
  it("תגובת retryable לא נוגעת בהזמנה בכלל (אין insert/claim/release calls)", async () => {
    const order: OrderRecord = {
      id: "order-created",
      status: "created",
      reportId: REPORT_ID,
      productType: "baseReport",
      providerOrderReference: "po_created",
      checkoutUrl: null,
    };
    db.ordersById.set(order.id, order);
    db.ordersByIdempotencyKey.set(IDEMPOTENCY_KEY, order.id);
    db.claims.set(order.id, { token: "claim-other", expiresAtMs: db.nowMs + LEASE_SECONDS * 1000 });

    const cardcom = fakeCardcomClient({ ok: true, result: { lowProfileCode: "lpc-1", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" } });
    const deps = buildDeps({ database: db, cardcomClient: cardcom });
    await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(db.insertOrderCallCount).toBe(0);
    expect(db.releaseClaimAsPendingCalls).toEqual([]);
    expect(db.releaseClaimAsFailedCalls).toEqual([]);
    expect(db.updateAccessTokenHashCalls).toEqual([]);
    expect(cardcom.calls.length).toBe(0);
    expect(order.status).toBe("created");
    expect(order.checkoutUrl).toBeNull();
  });

  it("תגובת הצלחה: orderId/checkoutUrl/accessToken כולם מחרוזות לא-ריקות, לא NaN/undefined/null", async () => {
    const deps = buildDeps({ database: db });
    const result = await createPaymentOrder(deps, { reportId: REPORT_ID, productType: "baseReport", idempotencyKey: IDEMPOTENCY_KEY });

    expect(result.status).toBe(200);
    if (result.status === 200 && "orderId" in result.body) {
      for (const value of [result.body.orderId, result.body.checkoutUrl, result.body.accessToken]) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
        expect(value).not.toBe("NaN");
        expect(value).not.toContain("undefined");
        expect(value).not.toContain("null");
      }
    }
  });
});
