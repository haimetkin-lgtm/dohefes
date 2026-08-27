import { describe, expect, it } from "vitest";
import { handleIndicatorCallback } from "./payment-indicator-service";
import type {
  CardcomIndicatorClientLike,
  FinalizeOutcome,
  OrderForVerification,
  PaymentIndicatorDatabase,
  SecurityEventReason,
} from "./payment-indicator-service";

const VALID_ORDER: OrderForVerification = {
  id: "order-1",
  reportId: "report-1",
  productType: "cashFlowAnalysis",
  providerOrderReference: "po_abc123",
  expectedAmountAgorot: 98_000,
  currencyCode: 1,
};

const VALID_FIELDS = { internalDealNumber: "deal-1", returnValue: "po_abc123", coinId: 1, amountAgorot: 98_000 };

interface FinalizeCall {
  lowProfileCode: string;
  cardcomInternalDealNumber: string;
  verifiedProviderOrderReference: string;
  verifiedAmountAgorot: number;
  verifiedCurrencyCode: number;
}

class FakeDatabase implements PaymentIndicatorDatabase {
  orders = new Map<string, OrderForVerification>();
  finalizeCalls: FinalizeCall[] = [];
  finalizeResult: FinalizeOutcome = {
    outcome: "finalized",
    orderId: "order-1",
    reportId: "report-1",
    productType: "cashFlowAnalysis",
    entitlementId: "entitlement-1",
  };
  securityEvents: Array<{ reason: SecurityEventReason; lowProfileCode: string }> = [];

  async getOrderByLowProfileCode(lowProfileCode: string): Promise<OrderForVerification | null> {
    return this.orders.get(lowProfileCode) ?? null;
  }

  async finalizeVerifiedPayment(
    lowProfileCode: string,
    cardcomInternalDealNumber: string,
    verifiedProviderOrderReference: string,
    verifiedAmountAgorot: number,
    verifiedCurrencyCode: number
  ): Promise<FinalizeOutcome> {
    this.finalizeCalls.push({
      lowProfileCode,
      cardcomInternalDealNumber,
      verifiedProviderOrderReference,
      verifiedAmountAgorot,
      verifiedCurrencyCode,
    });
    return this.finalizeResult;
  }

  async recordSecurityEvent(event: { reason: SecurityEventReason; lowProfileCode: string }): Promise<void> {
    this.securityEvents.push(event);
  }
}

function fakeCardcomClient(
  outcome: Awaited<ReturnType<CardcomIndicatorClientLike["getLowProfileIndicator"]>>
): CardcomIndicatorClientLike & { calls: Array<{ lowProfileCode: string }> } {
  const calls: Array<{ lowProfileCode: string }> = [];
  return {
    calls,
    async getLowProfileIndicator(request) {
      calls.push(request);
      return outcome;
    },
  };
}

describe("handleIndicatorCallback - תשלום תקין", () => {
  it("תשלום תקין ותואם -> קורא ל-finalize עם המזהים הנכונים, entitlement נוצרת, 200", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.finalizeCalls).toEqual([
      {
        lowProfileCode: "lpc-1",
        cardcomInternalDealNumber: "deal-1",
        // הערכים המאומתים שהועברו הם אלה שחזרו בפועל מ-Cardcom (fields.*) - **לא** מ-order.* -
        // ה-RPC עצמו עושה את ההשוואה מול ההזמנה (ר' payment-schema.sql, commit חמישי); העברת
        // order.* בחזרה לעצמו הייתה טאוטולוגיה חסרת ערך שלא בודקת כלום.
        verifiedProviderOrderReference: "po_abc123",
        verifiedAmountAgorot: 98_000,
        verifiedCurrencyCode: 1,
      },
    ]);
    expect(database.securityEvents).toEqual([]);
  });

  it("callback כפול על אותה עסקה -> finalize מחזיר already_finalized, 200, אין אירוע אבטחה (לא חשוד)", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    database.finalizeResult = { outcome: "already_finalized", orderId: "order-1", reportId: "report-1", productType: "cashFlowAnalysis", entitlementId: "entitlement-1" };
    const cardcomClient = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.finalizeCalls.length).toBe(1);
    expect(database.securityEvents).toEqual([]);
  });
});

describe("handleIndicatorCallback - אי-התאמה מול ההזמנה (ה-Edge Function לא סומכת על ה-webhook)", () => {
  it("סכום לא תואם -> אין קריאה ל-finalize, נרשם אירוע אבטחה כללי, 200", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: true, fields: { ...VALID_FIELDS, amountAgorot: 1 } });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.finalizeCalls).toEqual([]);
    expect(database.securityEvents).toEqual([{ reason: "verification_mismatch", lowProfileCode: "lpc-1" }]);
  });

  it("מטבע לא תואם -> אין קריאה ל-finalize, נרשם אירוע אבטחה", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: true, fields: { ...VALID_FIELDS, coinId: 2 } });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.finalizeCalls).toEqual([]);
    expect(database.securityEvents.length).toBe(1);
  });

  it("ReturnValue לא תואם -> אין קריאה ל-finalize, נרשם אירוע אבטחה", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: true, fields: { ...VALID_FIELDS, returnValue: "po_WRONG" } });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.finalizeCalls).toEqual([]);
    expect(database.securityEvents.length).toBe(1);
  });
});

describe("handleIndicatorCallback - Cardcom לא אישרה (payload מזויף בלבד לא מספיק)", () => {
  it("תגובה מזויפת ב-webhook לא רלוונטית - ההחלטה מבוססת רק על תגובת cardcomClient בפועל", async () => {
    // גם אם ה-webhook 'טוען' שהתשלום הצליח, הקוד לא קורא שום שדה כזה ממנו - רק lowProfileCode
    // מועבר ל-cardcomClient. אם ה-cardcomClient (כלומר Cardcom עצמה) לא מאשרת, שום דבר לא נכתב.
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: false, failureCode: "operation_failed" });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.finalizeCalls).toEqual([]);
    expect(database.securityEvents).toEqual([]);
  });

  it("Operation/OperationResponse/DealResponse שגויים (נבדק ב-cardcom-client) -> לא מגיע ל-DB בכלל", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: false, failureCode: "operation_failed" });

    await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    // getOrderByLowProfileCode לא אמור להיקרא כשה-Cardcom outcome כבר ok:false
    const spyDatabase = new FakeDatabase();
    let getOrderCalled = false;
    spyDatabase.getOrderByLowProfileCode = async () => {
      getOrderCalled = true;
      return null;
    };
    await handleIndicatorCallback({ database: spyDatabase, cardcomClient }, "lpc-1");
    expect(getOrderCalled).toBe(false);
  });
});

describe("handleIndicatorCallback - הזמנה לא ידועה", () => {
  it("Cardcom אישרה אך אין הזמנה תואמת אצלנו -> 200 כללי, אין דליפת קיום, אין finalize", async () => {
    const database = new FakeDatabase(); // ללא הזמנות
    const cardcomClient = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-unknown");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.finalizeCalls).toEqual([]);
  });

  it("תגובת 200 להזמנה לא ידועה זהה במבנה לתגובת 200 להזמנה ידועה - אין הבדל חיצוני שמבחין ביניהן", async () => {
    const knownDb = new FakeDatabase();
    knownDb.orders.set("lpc-1", VALID_ORDER);
    knownDb.finalizeResult = { outcome: "terminal_state", orderId: "order-1", reportId: "report-1", productType: "cashFlowAnalysis", entitlementId: null };
    const unknownDb = new FakeDatabase();

    const cardcomClient1 = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });
    const cardcomClient2 = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });

    const resultKnown = await handleIndicatorCallback({ database: knownDb, cardcomClient: cardcomClient1 }, "lpc-1");
    const resultUnknown = await handleIndicatorCallback({ database: unknownDb, cardcomClient: cardcomClient2 }, "lpc-unknown");

    expect(resultKnown).toEqual(resultUnknown);
  });
});

describe("handleIndicatorCallback - כשל תקשורת זמני (retryable)", () => {
  it("Cardcom לא זמינה (provider_unreachable) -> 503, אין mutation, ההזמנה לא מסומנת failed", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: false, failureCode: "provider_unreachable" });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 503 });
    expect(database.finalizeCalls).toEqual([]);
    expect(database.securityEvents).toEqual([]);
  });

  it("timeout על הקריאה ל-Cardcom (מגיע כ-provider_unreachable, ר' cardcom-client.ts) -> 503, אין entitlement שנוצרה, ההזמנה לא מסומנת failed", async () => {
    // cardcomClient הוא fake כאן (ה-timeout האמיתי, AbortSignal.timeout, נבדק ב-cardcom-client.test.ts) -
    // הבדיקה הזו מוודאת את השכבה הבאה: כש-cardcom-client כבר דיווח timeout כ-provider_unreachable,
    // ה-orchestration כאן לא קוראת ל-finalize (=לא נוצרת entitlement) ולא רושמת אירוע אבטחה
    // (זו לא התנהגות חשודה - זו תקלת ספק זמנית לגיטימית, לא ניסיון זיוף).
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: false, failureCode: "provider_unreachable" });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 503 });
    expect(database.finalizeCalls).toEqual([]);
    expect(database.securityEvents).toEqual([]);
  });

  it("העסקה עוד לא נרשמה סופית אצל Cardcom (not_completed) -> 503, לא failed", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: false, failureCode: "not_completed" });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 503 });
    expect(database.finalizeCalls).toEqual([]);
  });

  it("HTTP לא-2xx מ-Cardcom (provider_http_500) -> 503", async () => {
    const database = new FakeDatabase();
    const cardcomClient = fakeCardcomClient({ ok: false, failureCode: "provider_http_500" });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 503 });
  });
});

describe("handleIndicatorCallback - outcome מה-RPC שדורש תיעוד אירוע אבטחה", () => {
  it("deal_number_conflict מה-RPC -> נרשם אירוע אבטחה, 200 (לא נחשף כלפי חוץ)", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    database.finalizeResult = { outcome: "deal_number_conflict", orderId: "order-1", reportId: "report-1", productType: "cashFlowAnalysis", entitlementId: null };
    const cardcomClient = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.securityEvents).toEqual([{ reason: "deal_number_conflict", lowProfileCode: "lpc-1" }]);
  });

  it("verification_mismatch מה-RPC (הגנת-עומק ברמת ה-DB עצמו) -> נרשם אירוע אבטחה, 200", async () => {
    // מייצג מצב שבו הבדיקה המוקדמת בשכבת ה-service (matches, למעלה) עברה בטעות/עקיפה כלשהי,
    // וה-RPC עצמו (שגם הוא בודק עצמאית מול השורה הנעולה, ר' payment-schema.sql commit חמישי)
    // הוא זה שתופס את אי-ההתאמה בפועל - חייב עדיין להירשם כאירוע אבטחה, לא להיבלע בשקט.
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    database.finalizeResult = { outcome: "verification_mismatch", orderId: "order-1", reportId: "report-1", productType: "cashFlowAnalysis", entitlementId: null };
    const cardcomClient = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.securityEvents).toEqual([{ reason: "verification_mismatch", lowProfileCode: "lpc-1" }]);
  });

  it("deal_mismatch מה-RPC -> נרשם אירוע אבטחה, 200", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    database.finalizeResult = { outcome: "deal_mismatch", orderId: "order-1", reportId: "report-1", productType: "cashFlowAnalysis", entitlementId: null };
    const cardcomClient = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.securityEvents).toEqual([{ reason: "deal_mismatch", lowProfileCode: "lpc-1" }]);
  });

  it("terminal_state מה-RPC -> אין אירוע אבטחה (לא חשוד, מצב סופי לגיטימי), 200", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    database.finalizeResult = { outcome: "terminal_state", orderId: "order-1", reportId: "report-1", productType: "cashFlowAnalysis", entitlementId: null };
    const cardcomClient = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(result).toEqual({ httpStatus: 200 });
    expect(database.securityEvents).toEqual([]);
  });
});

describe("handleIndicatorCallback - קלט חסר, בלי PII/סודות בשום תשובה", () => {
  it("lowProfileCode ריק/null -> 200, אין קריאה ל-Cardcom בכלל", async () => {
    const database = new FakeDatabase();
    const cardcomClient = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });

    const result = await handleIndicatorCallback({ database, cardcomClient }, null);

    expect(result).toEqual({ httpStatus: 200 });
    expect(cardcomClient.calls).toEqual([]);
  });

  it("IndicatorResult לא חושף שום פרט מעבר ל-httpStatus - אין PII/reason/order id בתשובה עצמה", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: true, fields: VALID_FIELDS });

    const result = await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(Object.keys(result)).toEqual(["httpStatus"]);
  });

  it("אירוע אבטחה שנרשם מכיל אך ורק reason ו-lowProfileCode - שום שדה אחר (לא סכום/מטבע/deal number)", async () => {
    const database = new FakeDatabase();
    database.orders.set("lpc-1", VALID_ORDER);
    const cardcomClient = fakeCardcomClient({ ok: true, fields: { ...VALID_FIELDS, amountAgorot: 1 } });

    await handleIndicatorCallback({ database, cardcomClient }, "lpc-1");

    expect(database.securityEvents.length).toBe(1);
    expect(Object.keys(database.securityEvents[0]).sort()).toEqual(["lowProfileCode", "reason"]);
  });
});
