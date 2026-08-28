import { describe, expect, it } from "vitest";
import {
  PENDING_TTL_MS,
  addPending,
  cleanupPending,
  promoteToActive,
  resolveActiveAccess,
  resolvePendingByContext,
  resolvePendingByReportAndProduct,
  revokeActiveAccess,
  touchActiveAccess,
} from "./payment-storage";
import type { StorageLike } from "./payment-storage";

const REPORT_A = "11111111-1111-1111-1111-111111111111";
const REPORT_B = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-01-01T00:00:00Z");
const CHECKOUT_URL = "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP";
const IDEMPOTENCY_KEY = "33333333-3333-3333-3333-333333333333";

/** מימוש בזיכרון של StorageLike - לא window.localStorage אמיתי, בדיוק כמו FakeDatabase בשאר
 *  הפרויקט. failSetItemKeys מדמה quota error/כל כשל כתיבה אחר לפי מפתח ספציפי. */
class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  failSetItemKeys = new Set<string>();
  setItemCalls: Array<{ key: string; value: string }> = [];

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.setItemCalls.push({ key, value });
    if (this.failSetItemKeys.has(key)) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  /** עזר לבדיקות - כתיבה גולמית ישירה למאגר, לדימוי JSON פגום/מבנה לא צפוי. */
  setRaw(key: string, raw: string): void {
    this.map.set(key, raw);
  }
}

/** עזר לבדיקות בלבד - ברירות מחדל סבירות לקלט addPending, עם אפשרות override נקודתי. */
function pendingInput(overrides: Partial<{ reportId: string; productType: "baseReport" | "cashFlowAnalysis"; accessToken: string; checkoutUrl: string; idempotencyKey: string }> = {}) {
  return {
    reportId: REPORT_A,
    productType: "cashFlowAnalysis" as const,
    accessToken: "tok-1",
    checkoutUrl: CHECKOUT_URL,
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  };
}

describe("addPending + resolvePendingByContext", () => {
  it("רשומה שנוספה נמצאת בדיוק לפי paymentContextId שלה, כולל checkoutUrl/idempotencyKey", () => {
    const storage = new FakeStorage();
    const result = addPending(storage, "po_abc", pendingInput(), NOW);
    expect(result.ok).toBe(true);

    const resolved = resolvePendingByContext(storage, "po_abc", NOW);
    expect(resolved).toEqual({
      reportId: REPORT_A,
      productType: "cashFlowAnalysis",
      accessToken: "tok-1",
      checkoutUrl: CHECKOUT_URL,
      idempotencyKey: IDEMPOTENCY_KEY,
      createdAt: NOW.toISOString(),
    });
  });

  it("paymentContextId לא-קיים מחזיר null, לא זורק", () => {
    const storage = new FakeStorage();
    expect(resolvePendingByContext(storage, "po_missing", NOW)).toBeNull();
  });
});

describe("שתי לשוניות - pending לא נדרס", () => {
  it("שתי הזמנות עם paymentContextId שונה נשמרות שתיהן, כל אחת נמצאת בנפרד", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_tab1", pendingInput({ reportId: REPORT_A, accessToken: "tok-tab1" }), NOW);
    addPending(storage, "po_tab2", pendingInput({ reportId: REPORT_B, accessToken: "tok-tab2" }), NOW);

    expect(resolvePendingByContext(storage, "po_tab1", NOW)?.accessToken).toBe("tok-tab1");
    expect(resolvePendingByContext(storage, "po_tab2", NOW)?.accessToken).toBe("tok-tab2");
  });

  it("קידום לשונית אחת (promoteToActive) לא מוחק את ה-pending של הלשונית האחרת", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_tab1", pendingInput({ reportId: REPORT_A, accessToken: "tok-tab1" }), NOW);
    addPending(storage, "po_tab2", pendingInput({ reportId: REPORT_B, accessToken: "tok-tab2" }), NOW);

    const result = promoteToActive(storage, "po_tab1", NOW);

    expect(result.ok).toBe(true);
    expect(resolvePendingByContext(storage, "po_tab1", NOW)).toBeNull(); // קודם - נמחק
    expect(resolvePendingByContext(storage, "po_tab2", NOW)?.accessToken).toBe("tok-tab2"); // אחר - נשאר
  });
});

describe("promoteToActive - סדר הפעולות: כתיבה ל-active לפני מחיקת pending", () => {
  it("במקרה הרגיל: ה-token עובר ל-productAccess, ורק אז ה-pending נמחק", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", pendingInput(), NOW);

    const result = promoteToActive(storage, "po_abc", NOW);

    expect(result.ok).toBe(true);
    expect(resolveActiveAccess(storage, REPORT_A, "cashFlowAnalysis")).toEqual({
      accessToken: "tok-1",
      activatedAt: NOW.toISOString(),
      lastVerifiedAt: NOW.toISOString(),
    });
    expect(resolvePendingByContext(storage, "po_abc", NOW)).toBeNull();
  });

  it("כשל כתיבה ל-productAccess (quota) - pending נשאר שלם, לא מדווח הצלחה", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", pendingInput(), NOW);
    storage.failSetItemKeys.add("dohefes.productAccess");

    const result = promoteToActive(storage, "po_abc", NOW);

    expect(result.ok).toBe(false);
    expect(resolveActiveAccess(storage, REPORT_A, "cashFlowAnalysis")).toBeNull();
    // ה-pending לא נמחק - עדיין ניתן לנסות שוב בטעינה הבאה
    expect(resolvePendingByContext(storage, "po_abc", NOW)?.accessToken).toBe("tok-1");
  });

  it("paymentContextId לא-קיים - ok:false, לא נוגע בשום דבר", () => {
    const storage = new FakeStorage();
    const result = promoteToActive(storage, "po_missing", NOW);
    expect(result.ok).toBe(false);
    expect(storage.setItemCalls).toEqual([]);
  });
});

describe("reload מוצא active token", () => {
  it("אחרי promoteToActive, resolveActiveAccess מחדש (כמו רענון דף) עדיין מוצא את ה-token", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", pendingInput(), NOW);
    promoteToActive(storage, "po_abc", NOW);

    // מדמה "רענון" - storage חדש שמדמה אותו localStorage אמיתי (persistent), לא state בזיכרון
    const rawActive = storage.getItem("dohefes.productAccess")!;
    const freshStorage = new FakeStorage();
    freshStorage.setRaw("dohefes.productAccess", rawActive);

    expect(resolveActiveAccess(freshStorage, REPORT_A, "cashFlowAnalysis")?.accessToken).toBe("tok-1");
  });
});

describe("revokeActiveAccess - מוחקת רק report/product מתאים", () => {
  it("revoked למוצר אחד לא מוחק גישה פעילה למוצר אחר על אותו דוח, ולא לאותו מוצר על דוח אחר", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_1", pendingInput({ reportId: REPORT_A, productType: "cashFlowAnalysis", accessToken: "tok-cf-a" }), NOW);
    addPending(storage, "po_2", pendingInput({ reportId: REPORT_A, productType: "baseReport", accessToken: "tok-base-a" }), NOW);
    addPending(storage, "po_3", pendingInput({ reportId: REPORT_B, productType: "cashFlowAnalysis", accessToken: "tok-cf-b" }), NOW);
    promoteToActive(storage, "po_1", NOW);
    promoteToActive(storage, "po_2", NOW);
    promoteToActive(storage, "po_3", NOW);

    revokeActiveAccess(storage, REPORT_A, "cashFlowAnalysis");

    expect(resolveActiveAccess(storage, REPORT_A, "cashFlowAnalysis")).toBeNull();
    expect(resolveActiveAccess(storage, REPORT_A, "baseReport")?.accessToken).toBe("tok-base-a");
    expect(resolveActiveAccess(storage, REPORT_B, "cashFlowAnalysis")?.accessToken).toBe("tok-cf-b");
  });

  it("revoke למפתח שלא קיים לא זורק ולא כותב כלום", () => {
    const storage = new FakeStorage();
    revokeActiveAccess(storage, REPORT_A, "cashFlowAnalysis");
    expect(storage.setItemCalls).toEqual([]);
  });
});

describe("JSON פגום נכשל סגור", () => {
  it("dohefes.pendingPurchases עם JSON לא-תקין - נקרא כמאגר ריק, לא זורק", () => {
    const storage = new FakeStorage();
    storage.setRaw("dohefes.pendingPurchases", "{not valid json!!");
    expect(resolvePendingByContext(storage, "po_anything", NOW)).toBeNull();
  });

  it("dohefes.productAccess עם JSON לא-תקין - נקרא כמאגר ריק, לא זורק", () => {
    const storage = new FakeStorage();
    storage.setRaw("dohefes.productAccess", "not even json");
    expect(resolveActiveAccess(storage, REPORT_A, "cashFlowAnalysis")).toBeNull();
  });

  it("schemaVersion לא תואם (למשל ממבנה ישן) - נקרא כמאגר ריק, לא מנסה 'לתקן' את הצורה", () => {
    const storage = new FakeStorage();
    storage.setRaw("dohefes.pendingPurchases", JSON.stringify({ schemaVersion: 999, entries: { po_x: { reportId: REPORT_A } } }));
    expect(resolvePendingByContext(storage, "po_x", NOW)).toBeNull();
  });

  it("מבנה תקין-JSON אך לא בצורה הצפויה (למשל מערך) - נקרא כמאגר ריק", () => {
    const storage = new FakeStorage();
    storage.setRaw("dohefes.pendingPurchases", JSON.stringify(["not", "the", "right", "shape"]));
    expect(resolvePendingByContext(storage, "po_anything", NOW)).toBeNull();
  });

  it("migration: רשומה מ-schemaVersion 1 הישן (בלי checkoutUrl/idempotencyKey) נכשלת סגור - לא מומרת בניחוש, לא זורקת", () => {
    const storage = new FakeStorage();
    // בדיוק הצורה שהמודול היה כותב לפני הסבב הזה - schemaVersion 1, בלי checkoutUrl/idempotencyKey.
    storage.setRaw(
      "dohefes.pendingPurchases",
      JSON.stringify({
        schemaVersion: 1,
        entries: { po_old: { reportId: REPORT_A, productType: "cashFlowAnalysis", accessToken: "tok-old", createdAt: NOW.toISOString() } },
      })
    );
    expect(resolvePendingByContext(storage, "po_old", NOW)).toBeNull();
    expect(resolvePendingByReportAndProduct(storage, REPORT_A, "cashFlowAnalysis", NOW)).toEqual({ ok: false, reason: "not_found" });
  });

  it("רשומה בודדת פגומה (חסר checkoutUrl, למשל אחרי עריכה ידנית ב-DevTools) לא מפילה רשומות תקינות אחרות באותו מאגר", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_good", pendingInput({ reportId: REPORT_B, accessToken: "tok-good" }), NOW);
    // מזריקים רשומה שנייה, פגומה, ישירות לתוך אותו JSON - חסרה checkoutUrl.
    const raw = JSON.parse(storage.getItem("dohefes.pendingPurchases")!);
    raw.entries.po_broken = { reportId: REPORT_A, productType: "cashFlowAnalysis", accessToken: "tok-broken", idempotencyKey: IDEMPOTENCY_KEY, createdAt: NOW.toISOString() };
    storage.setRaw("dohefes.pendingPurchases", JSON.stringify(raw));

    expect(resolvePendingByContext(storage, "po_broken", NOW)).toBeNull();
    expect(resolvePendingByContext(storage, "po_good", NOW)?.accessToken).toBe("tok-good");
  });
});

describe("TTL - pending שפג מנוקה, active אינו נמחק לפי אותו TTL", () => {
  it("cleanupPending מסירה רשומה שעברה את PENDING_TTL_MS, משאירה רשומה תקינה", () => {
    const storage = new FakeStorage();
    const oldEnough = new Date(NOW.getTime() - PENDING_TTL_MS - 1000);
    addPending(storage, "po_expired", pendingInput({ reportId: REPORT_A, accessToken: "tok-old" }), oldEnough);
    addPending(storage, "po_fresh", pendingInput({ reportId: REPORT_B, accessToken: "tok-new" }), NOW);

    cleanupPending(storage, NOW);

    expect(resolvePendingByContext(storage, "po_expired", NOW)).toBeNull();
    expect(resolvePendingByContext(storage, "po_fresh", NOW)?.accessToken).toBe("tok-new");
  });

  it("רשומה בדיוק בגבול ה-TTL (לא עברה אותו) עדיין נחשבת תקפה", () => {
    const storage = new FakeStorage();
    const justInside = new Date(NOW.getTime() - PENDING_TTL_MS + 1000);
    addPending(storage, "po_boundary", pendingInput(), justInside);
    expect(resolvePendingByContext(storage, "po_boundary", NOW)).not.toBeNull();
  });

  it("pending באמצע polling (כמה קריאות resolvePendingByContext ברצף, בלי טעינת TTL) לא נמחק באמצע", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_polling", pendingInput(), NOW);

    // מדמה polling - כמה קריאות רצופות, כולן עדיין הרבה לפני ה-TTL
    for (let i = 0; i < 10; i++) {
      const pollTime = new Date(NOW.getTime() + i * 2000);
      expect(resolvePendingByContext(storage, "po_polling", pollTime)?.accessToken).toBe("tok-1");
    }
  });

  it("cleanupPending (TTL של pending) אף פעם לא נוגעת ב-dohefes.productAccess", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", pendingInput(), NOW);
    promoteToActive(storage, "po_abc", NOW);

    // "עכשיו" רחוק מאוד בעתיד - הרבה מעבר לכל TTL סביר של pending
    const farFuture = new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000);
    cleanupPending(storage, farFuture);

    expect(resolveActiveAccess(storage, REPORT_A, "cashFlowAnalysis")?.accessToken).toBe("tok-1");
  });

  it("pending שפג (TTL) לא נמצא עוד - לא מספק כלום ל'חידוש' אוטומטי (הקורא חייב ליצור הזמנה חדשה במפורש)", () => {
    const storage = new FakeStorage();
    const oldEnough = new Date(NOW.getTime() - PENDING_TTL_MS - 1000);
    addPending(storage, "po_expired", pendingInput(), oldEnough);

    expect(resolvePendingByContext(storage, "po_expired", NOW)).toBeNull();
    expect(resolvePendingByReportAndProduct(storage, REPORT_A, "cashFlowAnalysis", NOW)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("localStorage quota error - לא זורק, מדווח ok:false", () => {
  it("addPending עם setItem שנכשל מחזירה ok:false ולא זורקת חריגה", () => {
    const storage = new FakeStorage();
    storage.failSetItemKeys.add("dohefes.pendingPurchases");
    expect(() => addPending(storage, "po_abc", pendingInput(), NOW)).not.toThrow();
    const result = addPending(storage, "po_abc", pendingInput(), NOW);
    expect(result.ok).toBe(false);
  });
});

describe("אין מוטציה של הקלט", () => {
  it("addPending לא משנה את אובייקט ה-input שהועבר לה", () => {
    const storage = new FakeStorage();
    const input = pendingInput();
    const inputCopy = { ...input };
    addPending(storage, "po_abc", input, NOW);
    expect(input).toEqual(inputCopy);
  });
});

describe("אין access token בפלט שגיאה/חריגה", () => {
  it("כשל כתיבה (quota) - הודעת השגיאה הפנימית שנתפסת אינה כוללת את ה-accessToken בשום מקום שנחשף", () => {
    const storage = new FakeStorage();
    storage.failSetItemKeys.add("dohefes.pendingPurchases");
    const secretToken = "super-secret-access-token-xyz";
    const result = addPending(storage, "po_abc", pendingInput({ accessToken: secretToken }), NOW);
    expect(JSON.stringify(result)).not.toContain(secretToken);
  });

  it("promoteToActive עם כשל - ה-result המוחזר לא כולל את הטוקן", () => {
    const storage = new FakeStorage();
    const secretToken = "super-secret-access-token-xyz";
    addPending(storage, "po_abc", pendingInput({ accessToken: secretToken }), NOW);
    storage.failSetItemKeys.add("dohefes.productAccess");
    const result = promoteToActive(storage, "po_abc", NOW);
    expect(JSON.stringify(result)).not.toContain(secretToken);
  });
});

describe("fallback לפי reportId+productType (resolvePendingByReportAndProduct)", () => {
  it("התאמה יחידה נמצאת בהצלחה, כולל paymentContextId שלה", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_only", pendingInput({ accessToken: "tok" }), NOW);

    const result = resolvePendingByReportAndProduct(storage, REPORT_A, "cashFlowAnalysis", NOW);

    expect(result).toEqual({
      ok: true,
      paymentContextId: "po_only",
      record: { reportId: REPORT_A, productType: "cashFlowAnalysis", accessToken: "tok", checkoutUrl: CHECKOUT_URL, idempotencyKey: IDEMPOTENCY_KEY, createdAt: NOW.toISOString() },
    });
  });

  it("אין התאמה כלל - not_found", () => {
    const storage = new FakeStorage();
    const result = resolvePendingByReportAndProduct(storage, REPORT_A, "cashFlowAnalysis", NOW);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("מוצר שונה על אותו דוח לא נחשב התאמה", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_base", pendingInput({ productType: "baseReport", accessToken: "tok" }), NOW);
    const result = resolvePendingByReportAndProduct(storage, REPORT_A, "cashFlowAnalysis", NOW);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("שתי התאמות סותרות (אותו report+product, שני paymentContextId שונים) - נכשל סגור, לא בוחר אחת", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_first", pendingInput({ accessToken: "tok-1" }), NOW);
    addPending(storage, "po_second", pendingInput({ accessToken: "tok-2" }), NOW);

    const result = resolvePendingByReportAndProduct(storage, REPORT_A, "cashFlowAnalysis", NOW);

    expect(result).toEqual({ ok: false, reason: "ambiguous" });
  });
});

describe("touchActiveAccess", () => {
  it("מעדכנת lastVerifiedAt בלבד, לא נוגעת ב-accessToken/activatedAt", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", pendingInput(), NOW);
    promoteToActive(storage, "po_abc", NOW);

    const later = new Date(NOW.getTime() + 60_000);
    touchActiveAccess(storage, REPORT_A, "cashFlowAnalysis", later);

    expect(resolveActiveAccess(storage, REPORT_A, "cashFlowAnalysis")).toEqual({
      accessToken: "tok-1",
      activatedAt: NOW.toISOString(),
      lastVerifiedAt: later.toISOString(),
    });
  });

  it("אין רשומה קיימת - לא יוצרת אחת חדשה, לא זורקת", () => {
    const storage = new FakeStorage();
    expect(() => touchActiveAccess(storage, REPORT_A, "cashFlowAnalysis", NOW)).not.toThrow();
    expect(resolveActiveAccess(storage, REPORT_A, "cashFlowAnalysis")).toBeNull();
  });
});

describe("חידוש pending (addPending על מפתח קיים) - מעדכן token/checkoutUrl, לא יוצר רשומה שנייה", () => {
  it("addPending שנייה על אותו paymentContextId מחליפה את הרשומה (לא מוסיפה עוד אחת)", () => {
    const storage = new FakeStorage();
    addPending(storage, "po_abc", pendingInput({ accessToken: "tok-old", checkoutUrl: CHECKOUT_URL }), NOW);

    const renewedAt = new Date(NOW.getTime() + 60_000);
    const newCheckoutUrl = "https://secure.cardcom.solutions/EA/EA5/renewed/PaymentSP";
    addPending(storage, "po_abc", pendingInput({ accessToken: "tok-renewed", checkoutUrl: newCheckoutUrl }), renewedAt);

    const resolved = resolvePendingByContext(storage, "po_abc", renewedAt);
    expect(resolved?.accessToken).toBe("tok-renewed");
    expect(resolved?.checkoutUrl).toBe(newCheckoutUrl);
    expect(resolved?.idempotencyKey).toBe(IDEMPOTENCY_KEY); // אותו idempotencyKey תמיד - לא הוחלף
  });
});
