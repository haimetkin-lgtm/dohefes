// בדיקות סטטיות ממוקדות (Commit 5b, סעיף 7: "אל תסתפק רק בבדיקות טקסט") לחיווט app/tracking/page.tsx
// ו-app/payment-return/page.tsx בפועל - **בנוסף** ל-lib/tracking/access-state.test.ts (state
// machine טהור) ו-lib/payment/tracking-client.test.ts (client טהור). כאן: קריאת קוד המקור
// עצמו, ווידוא תבניות קבועות וידועות (imports/קריאות פונקציה ספציפיות) - לא ניחוש חופשי.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readApp(relativePath: string): string {
  return readFileSync(join(process.cwd(), "app", relativePath), "utf-8");
}

const TRACKING_PAGE = readApp("tracking/page.tsx");
const PAYMENT_RETURN_PAGE = readApp("payment-return/page.tsx");

describe("1. reportId לא תקין אינו טוען נתונים", () => {
  it("REPORT_ID_INVALID נשלח כש-UUID לא תקף/חסר, לפני כל קריאת רשת", () => {
    expect(TRACKING_PAGE).toMatch(/UUID_PATTERN\.test\(id\)/);
    expect(TRACKING_PAGE).toMatch(/dispatch\(\{ type: "REPORT_ID_INVALID" \}\)/);
  });

  it("קריאת project_name/dohefes-get-tracking-data לא קורות לפני שreportId אומת", () => {
    const invalidCheckIndex = TRACKING_PAGE.indexOf("REPORT_ID_INVALID");
    const projectNameFetchIndex = TRACKING_PAGE.indexOf('.select("project_name")');
    expect(invalidCheckIndex).toBeLessThan(projectNameFetchIndex);
  });
});

describe("3. המחיר והשם מגיעים מהקטלוג, לא מקודדים בעמוד", () => {
  it("משתמש ב-CATALOG.trackingReports.displayName/priceAgorot דרך formatPriceNis - לא ב-'980'/'דוחות מעקב בנייה' כטקסט קבוע", () => {
    expect(TRACKING_PAGE).toMatch(/from "@\/lib\/catalog"/);
    expect(TRACKING_PAGE).toMatch(/CATALOG\.trackingReports\.displayName/);
    expect(TRACKING_PAGE).toMatch(/formatPriceNis\(trackingProduct\.priceAgorot\)/);
    expect(TRACKING_PAGE).not.toContain("980 ₪");
    expect(TRACKING_PAGE).not.toContain('"דוחות מעקב בנייה"');
  });
});

describe("4. רכישה שולחת רק reportId+trackingReports, ללא מחיר מהלקוח", () => {
  it("purchaseProduct נקראת עם productType: PRODUCT_TYPE קבוע (\"trackingReports\"), לא עם price/amount/currency", () => {
    expect(TRACKING_PAGE).toMatch(/const PRODUCT_TYPE = "trackingReports"/);
    const purchaseCallMatch = TRACKING_PAGE.match(/purchaseProduct\([\s\S]{0,200}?\)/);
    expect(purchaseCallMatch).not.toBeNull();
    const call = purchaseCallMatch![0];
    expect(call).toContain("productType: PRODUCT_TYPE");
    expect(call).not.toMatch(/price|amount|currency/i);
  });
});

describe("7/8. active קורא/שומר רק דרך ה-Functions החדשות - dohefes-get/save-tracking-data", () => {
  it("מייבא getTrackingData/saveTrackingData מ-tracking-client.ts, לא מגדיר קריאה מקבילה", () => {
    expect(TRACKING_PAGE).toMatch(/from "@\/lib\/payment\/tracking-client"/);
    expect(TRACKING_PAGE).toMatch(/getTrackingData\(supabase\.functions/);
    expect(TRACKING_PAGE).toMatch(/saveTrackingData\(supabase\.functions/);
  });
});

describe("9. אין קריאה/כתיבה של dohefes_reports.tracking בקוד /tracking", () => {
  it("אין .from(\"dohefes_reports\").select/.update עם tracking בתוכו", () => {
    // מותר .select("project_name") בלבד (חריג מתועד) - נבדק שהוא היחיד שנוגע ב-dohefes_reports.
    const fromReportsLines = TRACKING_PAGE.split("\n").filter((l) => l.includes('.from("dohefes_reports")'));
    expect(fromReportsLines.length).toBe(1);
    expect(fromReportsLines[0]).not.toMatch(/tracking/);
  });

  it("אין .update({ tracking: ... }) בשום מקום בקובץ", () => {
    expect(TRACKING_PAGE).not.toMatch(/\.update\(\{\s*tracking/);
  });

  it("אין payment_status בקובץ - אין הסתמכות על השדה הישן לפתיחת המוצר", () => {
    expect(TRACKING_PAGE).not.toMatch(/payment_status/);
  });
});

describe("11. token לא מופיע ב-URL/query string בקוד - רק ב-header", () => {
  it("accessToken לעולם לא מוצמד ל-searchParams/URL כלשהו", () => {
    expect(TRACKING_PAGE).not.toMatch(/searchParams\.set\([^)]*[Tt]oken/);
    expect(TRACKING_PAGE).not.toMatch(/\?.*accessToken/);
  });

  it("accessToken לא מופיע בתוך שום JSX טקסט/הודעת שגיאה מוצגת (רק כפרמטר קריאה ל-client)", () => {
    // כל המחרוזות שמוצגות למשתמש (בתוך {" ... "} / <p>...) לא מכילות accessToken
    const displayedStrings = TRACKING_PAGE.match(/>[^<{}]*accessToken[^<{}]*</g) || [];
    expect(displayedStrings).toEqual([]);
  });
});

describe("12. entitlement למוצר אחר אינו פותח tracking - PRODUCT_TYPE קבוע, לא נגזר מהלקוח", () => {
  it("PRODUCT_TYPE הוא קבוע מודולי יחיד ('trackingReports'), לא state/prop/query param", () => {
    const constDeclarations = (TRACKING_PAGE.match(/const PRODUCT_TYPE = /g) || []).length;
    expect(constDeclarations).toBe(1);
    expect(TRACKING_PAGE).toMatch(/const PRODUCT_TYPE = "trackingReports";/);
  });

  it("resolveActiveAccess/getProductAccess/purchaseProduct/resumePendingCheckout כולם נקראים עם PRODUCT_TYPE, לא ערך משתנה אחר", () => {
    for (const fn of ["resolveActiveAccess", "getProductAccess", "purchaseProduct", "resumePendingCheckout", "revokeActiveAccess", "touchActiveAccess", "resolvePendingByReportAndProduct"]) {
      const regex = new RegExp(`${fn}\\([^)]*\\)`, "g");
      const calls = TRACKING_PAGE.match(regex) || [];
      for (const call of calls) {
        if (call.includes("PRODUCT_TYPE") || !/productType/.test(call)) continue;
        expect(call).toMatch(/PRODUCT_TYPE/);
      }
    }
  });
});

describe("20. אין פנייה ל-Cardcom בקוד /tracking", () => {
  it("שום אזכור ל-cardcom/Cardcom בקובץ - כל התקשורת דרך ה-Edge Functions הקיימות בלבד", () => {
    expect(TRACKING_PAGE.toLowerCase()).not.toMatch(/cardcom/);
  });
});

describe("21. אין import או route של UI התזרים", () => {
  it("app/cashflow אינו קיים כתיקייה/route בענף הזה", () => {
    expect(existsSync(join(process.cwd(), "app", "cashflow"))).toBe(false);
  });

  it("app/tracking/page.tsx לא מייבא משום קובץ תחת app/cashflow", () => {
    expect(TRACKING_PAGE).not.toMatch(/from ["']@\/app\/cashflow/);
  });

  it("app/payment-return/page.tsx לא מייבא משום קובץ תחת app/cashflow (רק SITE_PATHS.cashflow כמחרוזת-מיפוי, לא import)", () => {
    expect(PAYMENT_RETURN_PAGE).not.toMatch(/from ["']@\/app\/cashflow/);
  });
});

describe("17. payment-return מפנה productType לפי מיפוי מפורש, לא ל-/cashflow תמיד", () => {
  it("app/payment-return/page.tsx משתמש ב-resolveProductRedirectPath, לא בקריאה קשיחה ל-SITE_PATHS.cashflow בשלב ה-redirect", () => {
    expect(PAYMENT_RETURN_PAGE).toMatch(/resolveProductRedirectPath/);
    // ה-effect של שלב 5 (redirecting) לא קורא ל-SITE_PATHS.cashflow ישירות - עובר דרך target.path.
    const redirectEffectMatch = PAYMENT_RETURN_PAGE.match(/state\.kind !== "redirecting"[\s\S]{0,300}/);
    expect(redirectEffectMatch).not.toBeNull();
    expect(redirectEffectMatch![0]).not.toMatch(/SITE_PATHS\.cashflow/);
    expect(redirectEffectMatch![0]).toMatch(/resolveProductRedirectPath/);
  });
});

describe("18. payment-return אינו מנחש context חסר", () => {
  it("CONTEXT_NOT_FOUND נשלח (לא ניחוש) כש-returnValue/pending חסרים", () => {
    expect(PAYMENT_RETURN_PAGE).toMatch(/dispatch\(\{ type: "CONTEXT_NOT_FOUND" \}\)/);
    const occurrences = (PAYMENT_RETURN_PAGE.match(/CONTEXT_NOT_FOUND/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3); // supabaseConfigured, אין returnValue, אין pending תואם
  });
});

describe("16. Excel/print נעולים לפני active - disabled אמיתי + isTrackingExportUnlocked", () => {
  it("שני הכפתורים ב-renderEditor מקבלים disabled={!exportUnlocked}, exportUnlocked מגיע מ-isTrackingExportUnlocked", () => {
    expect(TRACKING_PAGE).toMatch(/const exportUnlocked = isTrackingExportUnlocked\(state\)/);
    const disabledCount = (TRACKING_PAGE.match(/\sdisabled=\{!exportUnlocked\}/g) || []).length;
    expect(disabledCount).toBe(2);
  });

  it("renderEditor נקרא רק ממצבי active/saveInProgress/saveError - אין נתיב לעורך מ-purchaseRequired/checkoutPending/וכו'", () => {
    const switchBlock = TRACKING_PAGE.match(/switch \(state\.kind\) \{[\s\S]*?\n  \}\n\}/);
    expect(switchBlock).not.toBeNull();
    const editorCaseMatch = switchBlock![0].match(/case "active":\s*\n\s*case "saveInProgress":\s*\n\s*case "saveError":\s*\n\s*return renderEditor/);
    expect(editorCaseMatch).not.toBeNull();
  });
});

describe("9-cont. כל call site של ReportView/tracking עדיין תואם לחלוטין ל-Commit 4 (לא נסוג)", () => {
  it("app/tracking/page.tsx לא מייבא ReportView (מוצר נפרד, לא ReportView של דוח האפס)", () => {
    expect(TRACKING_PAGE).not.toMatch(/ReportView/);
  });
});
