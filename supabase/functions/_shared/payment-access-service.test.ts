import { describe, expect, it } from "vitest";
import { checkProductAccess } from "./payment-access-service";
import type {
  AccessEntitlementLookup,
  AccessOrderLookup,
  PaymentAccessDatabase,
  TokenHasher,
} from "./payment-access-service";

const REPORT_ID = "report-1";
const PRODUCT_TYPE = "cashFlowAnalysis";
const RAW_TOKEN = "raw-token-abc";
const TOKEN_HASH = "hash-of-raw-token-abc";

const PAID_ORDER: AccessOrderLookup = {
  reportId: REPORT_ID,
  productType: PRODUCT_TYPE,
  status: "paid",
  verifiedAt: "2026-01-01T00:00:00Z",
  paidAt: "2026-01-01T00:00:00Z",
};

const ACTIVE_ENTITLEMENT: AccessEntitlementLookup = { entitlementStatus: "active" };

class FakeDatabase implements PaymentAccessDatabase {
  ordersByHash = new Map<string, AccessOrderLookup>();
  entitlements = new Map<string, AccessEntitlementLookup>();
  getOrderCalls: string[] = [];
  getEntitlementCalls: Array<{ reportId: string; productType: string }> = [];

  async getOrderByAccessTokenHash(accessTokenHash: string): Promise<AccessOrderLookup | null> {
    this.getOrderCalls.push(accessTokenHash);
    return this.ordersByHash.get(accessTokenHash) ?? null;
  }

  async getEntitlement(reportId: string, productType: string): Promise<AccessEntitlementLookup | null> {
    this.getEntitlementCalls.push({ reportId, productType });
    return this.entitlements.get(`${reportId}:${productType}`) ?? null;
  }
}

function fakeTokenHasher(mapping: Record<string, string> = { [RAW_TOKEN]: TOKEN_HASH }): TokenHasher {
  return {
    async hashAccessToken(rawToken: string): Promise<string> {
      return mapping[rawToken] ?? `hash-of-${rawToken}`;
    },
  };
}

function setup(): { database: FakeDatabase; tokenHasher: TokenHasher } {
  const database = new FakeDatabase();
  database.ordersByHash.set(TOKEN_HASH, PAID_ORDER);
  database.entitlements.set(`${REPORT_ID}:${PRODUCT_TYPE}`, ACTIVE_ENTITLEMENT);
  return { database, tokenHasher: fakeTokenHasher() };
}

describe("checkProductAccess - טוקן נכון", () => {
  it("הזמנה paid+verified+entitlement active -> active", async () => {
    const { database, tokenHasher } = setup();
    const result = await checkProductAccess(
      { database, tokenHasher },
      { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN }
    );
    expect(result).toEqual({ status: "active" });
  });
});

describe("checkProductAccess - טוקן שגוי", () => {
  it("hash לא תואם לשום הזמנה -> unavailable, בלי לחשוף שהטוקן פשוט שגוי", async () => {
    const { database, tokenHasher } = setup();
    const result = await checkProductAccess(
      { database, tokenHasher },
      { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: "some-other-token" }
    );
    expect(result).toEqual({ status: "unavailable" });
  });
});

describe("checkProductAccess - אי-התאמת דוח/מוצר (בעלות מלאה נדרשת)", () => {
  it("מוצר שונה מזה שבהזמנה שנמצאה -> unavailable", async () => {
    const { database, tokenHasher } = setup();
    const result = await checkProductAccess(
      { database, tokenHasher },
      { reportId: REPORT_ID, productType: "baseReport", rawAccessToken: RAW_TOKEN }
    );
    expect(result).toEqual({ status: "unavailable" });
  });

  it("דוח שונה מזה שבהזמנה שנמצאה -> unavailable", async () => {
    const { database, tokenHasher } = setup();
    const result = await checkProductAccess(
      { database, tokenHasher },
      { reportId: "report-DIFFERENT", productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN }
    );
    expect(result).toEqual({ status: "unavailable" });
  });
});

describe("checkProductAccess - paid בלי entitlement (מצב חריג, fail-closed)", () => {
  it("הזמנה paid+verified+paid_at, אך אין entitlement כלל -> unavailable, לא active", async () => {
    const database = new FakeDatabase();
    database.ordersByHash.set(TOKEN_HASH, PAID_ORDER); // אין entitlement שנוסף
    const result = await checkProductAccess(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN }
    );
    expect(result).toEqual({ status: "unavailable" });
  });
});

describe("checkProductAccess - entitlement revoked/refunded", () => {
  it("entitlement קיימת אך revoked -> unavailable", async () => {
    const database = new FakeDatabase();
    database.ordersByHash.set(TOKEN_HASH, PAID_ORDER);
    database.entitlements.set(`${REPORT_ID}:${PRODUCT_TYPE}`, { entitlementStatus: "revoked" });
    const result = await checkProductAccess(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN }
    );
    expect(result).toEqual({ status: "unavailable" });
  });

  it("entitlement קיימת אך refunded -> unavailable", async () => {
    const database = new FakeDatabase();
    database.ordersByHash.set(TOKEN_HASH, PAID_ORDER);
    database.entitlements.set(`${REPORT_ID}:${PRODUCT_TYPE}`, { entitlementStatus: "refunded" });
    const result = await checkProductAccess(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN }
    );
    expect(result).toEqual({ status: "unavailable" });
  });
});

describe("checkProductAccess - הזמנה pending", () => {
  it("הזמנה created (לא שולמה עדיין) -> pending", async () => {
    const database = new FakeDatabase();
    database.ordersByHash.set(TOKEN_HASH, { ...PAID_ORDER, status: "created", verifiedAt: null, paidAt: null });
    const result = await checkProductAccess(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN }
    );
    expect(result).toEqual({ status: "pending" });
  });

  it("הזמנה pending (משתמש בדרך ל-Cardcom) -> pending", async () => {
    const database = new FakeDatabase();
    database.ordersByHash.set(TOKEN_HASH, { ...PAID_ORDER, status: "pending", verifiedAt: null, paidAt: null });
    const result = await checkProductAccess(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN }
    );
    expect(result).toEqual({ status: "pending" });
  });

  it("הזמנה failed -> unavailable (לא pending, מצב סופי)", async () => {
    const database = new FakeDatabase();
    database.ordersByHash.set(TOKEN_HASH, { ...PAID_ORDER, status: "failed", verifiedAt: null, paidAt: null });
    const result = await checkProductAccess(
      { database, tokenHasher: fakeTokenHasher() },
      { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN }
    );
    expect(result).toEqual({ status: "unavailable" });
  });
});

describe("checkProductAccess - retry (בטוח, דטרמיניסטי)", () => {
  it("שתי קריאות עוקבות עם אותו טוקן מחזירות בדיוק אותה תוצאה", async () => {
    const { database, tokenHasher } = setup();
    const request = { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN };

    const first = await checkProductAccess({ database, tokenHasher }, request);
    const second = await checkProductAccess({ database, tokenHasher }, request);

    expect(first).toEqual({ status: "active" });
    expect(second).toEqual({ status: "active" });
    expect(first).toEqual(second);
  });
});

describe("checkProductAccess - קלט פגום", () => {
  it("טוקן ריק -> unavailable, בלי לגעת ב-DB בכלל", async () => {
    const { database, tokenHasher } = setup();
    const result = await checkProductAccess(
      { database, tokenHasher },
      { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: "" }
    );
    expect(result).toEqual({ status: "unavailable" });
    expect(database.getOrderCalls).toEqual([]);
  });
});

describe("checkProductAccess - אי-מוטציה", () => {
  it("PaymentAccessDatabase חושפת רק מתודות קריאה - אין דרך מבנית לכתוב דרך הממשק הזה", async () => {
    const { database, tokenHasher } = setup();
    await checkProductAccess({ database, tokenHasher }, { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN });

    // אין insert/update/delete/write בממשק PaymentAccessDatabase בכלל - שתי המתודות היחידות
    // (getOrderByAccessTokenHash, getEntitlement) הן קריאה בלבד. בדיקה זו מוודאת שה-fake לא
    // חושף אף מתודה נוספת שאינה חלק מהממשק המוצהר.
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(database)).filter((name) => name !== "constructor");
    expect(methodNames.sort()).toEqual(["getEntitlement", "getOrderByAccessTokenHash"]);
  });
});

describe("checkProductAccess - היעדר מידע רגיש בתגובה", () => {
  it("התוצאה מכילה אך ורק status - שום מזהה/סכום/פרט Cardcom/מידע על מוצר אחר", async () => {
    const { database, tokenHasher } = setup();
    const result = await checkProductAccess(
      { database, tokenHasher },
      { reportId: REPORT_ID, productType: PRODUCT_TYPE, rawAccessToken: RAW_TOKEN }
    );
    expect(Object.keys(result)).toEqual(["status"]);
  });

  it("גם בתשובת unavailable אין דליפת מידע נוסף", async () => {
    const { database, tokenHasher } = setup();
    const result = await checkProductAccess(
      { database, tokenHasher },
      { reportId: REPORT_ID, productType: "baseReport", rawAccessToken: RAW_TOKEN }
    );
    expect(Object.keys(result)).toEqual(["status"]);
  });
});
