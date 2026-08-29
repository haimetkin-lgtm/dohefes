import { describe, expect, it } from "vitest";
import { SITE_PATHS } from "./site";

describe("SITE_PATHS - basePath audit", () => {
  it("calculator כולל /dohefes בדיוק פעם אחת", () => {
    expect(SITE_PATHS.calculator).toBe("/dohefes/calculator/");
    expect(SITE_PATHS.calculator.match(/\/dohefes/g)).toHaveLength(1);
  });

  it("calculatorReport מקודד reportId ומוסיף אותו כ-query בלבד", () => {
    expect(SITE_PATHS.calculatorReport("a/b ?")).toBe("/dohefes/calculator/?id=a%2Fb%20%3F");
  });

  it("tracking(reportId) כולל /dohefes פעם אחת ושומר את reportId ב-query string", () => {
    const url = SITE_PATHS.tracking("11111111-1111-1111-1111-111111111111");
    expect(url).toBe("/dohefes/tracking/?id=11111111-1111-1111-1111-111111111111");
    expect(url.match(/\/dohefes/g)).toHaveLength(1);
  });

  it("tracking מקודד תווים מיוחדים ב-reportId (הגנה בסיסית, גם אם לא אמור לקרות בפועל - reportId הוא UUID תמיד)", () => {
    const url = SITE_PATHS.tracking("abc def/../xyz");
    expect(url).not.toContain(" ");
    expect(url).toContain(encodeURIComponent("abc def/../xyz"));
  });

  it("trackingSample הוא נתיב דוגמה פתוח ללא reportId", () => {
    expect(SITE_PATHS.trackingSample).toBe("/dohefes/tracking-sample/");
  });

  it("cashflow(reportId) כולל /dohefes פעם אחת ושומר את reportId ב-query string - נשאר במיפוי, אין route בפועל בענף הזה", () => {
    const url = SITE_PATHS.cashflow("11111111-1111-1111-1111-111111111111");
    expect(url).toBe("/dohefes/cashflow/?id=11111111-1111-1111-1111-111111111111");
    expect(url.match(/\/dohefes/g)).toHaveLength(1);
  });

  it("paymentReturn(paymentContextId, outcome) כולל /dohefes פעם אחת, ReturnValue וoutcome תקינים", () => {
    const url = SITE_PATHS.paymentReturn("po_abc123", "success");
    expect(url).toBe("/dohefes/payment-return/?ReturnValue=po_abc123&outcome=success");
    expect(url.match(/\/dohefes/g)).toHaveLength(1);
  });

  it("paymentReturn עם outcome=cancelled", () => {
    expect(SITE_PATHS.paymentReturn("po_abc123", "cancelled")).toBe("/dohefes/payment-return/?ReturnValue=po_abc123&outcome=cancelled");
  });

  it("אף נתיב לא מכיל /dohefes/dohefes (הכפלה) בשום מקרה", () => {
    expect(SITE_PATHS.calculator).not.toContain("/dohefes/dohefes");
    expect(SITE_PATHS.tracking("x")).not.toContain("/dohefes/dohefes");
    expect(SITE_PATHS.cashflow("x")).not.toContain("/dohefes/dohefes");
    expect(SITE_PATHS.paymentReturn("x", "success")).not.toContain("/dohefes/dohefes");
  });

  it("אף נתיב לא מתחיל בלי /dohefes (לא נחתת בשורש הדומיין בטעות)", () => {
    expect(SITE_PATHS.calculator.startsWith("/dohefes/")).toBe(true);
    expect(SITE_PATHS.tracking("x").startsWith("/dohefes/")).toBe(true);
    expect(SITE_PATHS.cashflow("x").startsWith("/dohefes/")).toBe(true);
    expect(SITE_PATHS.paymentReturn("x", "success").startsWith("/dohefes/")).toBe(true);
  });
});
