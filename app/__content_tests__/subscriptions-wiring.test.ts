// בדיקה סטטית (קריאת קובצי המסך כטקסט, לא רינדור) לחיווט המנויים. ההרשאה והמכסה נקבעות בשרת, והחזית רק מציגה ושולחת בקשות.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf-8");

const CALCULATOR = read("app/calculator/page.tsx");
const PANEL = read("app/calculator/SubscriberPanel.tsx");
const SUBSCRIBE = read("app/subscribe/page.tsx");
const ACCOUNT = read("app/account/page.tsx");
const LOGIN = read("app/login/page.tsx");
const LIB = read("lib/subscriptions-api.ts");
const REPORT_VIEW = read("app/calculator/ReportView.tsx");
const LAYOUT = read("app/layout.tsx");
const HOME = read("app/page.tsx");
const SITEMAP = read("app/sitemap.ts");

describe("הייצוא נשאר נעול עד שהשרת החזיר הרשאה", () => {
  it("outputAccess במחשבון עדיין נגזר רק מ-reportId, בלי דגל מנוי בדפדפן", () => {
    expect(CALCULATOR).toMatch(/outputAccess=\{reportId \? "full" : "trial"\}/);
    expect(CALCULATOR).not.toMatch(/outputAccess=\{[^}]*(subscri|session)/i);
  });

  it("הפאנל מעביר reportId לעמוד רק אחרי תשובת שרת מוצלחת וכתיבת הגישה לדפדפן", () => {
    const afterOpen = PANEL.slice(PANEL.indexOf("await openSubscriberReport"));
    expect(afterOpen.indexOf("storeActiveAccess")).toBeLessThan(afterOpen.indexOf("onOpened(opened.reportId"));
    expect(afterOpen).toContain("if (!base.ok)");
  });

  it("ReportView לא מכיר מנויים: ההחלטה נשארת ב-outputAccess בלבד", () => {
    expect(REPORT_VIEW).not.toMatch(/subscri/i);
  });
});

describe("הפאנל במחשבון", () => {
  it("שולח לשרת רק סוג עסקה ומפתח idempotency, ושומר את המפתח לניסיונות חוזרים", () => {
    expect(PANEL).toContain("openSubscriberReport(session.access_token, dealType, pendingKey())");
    expect(PANEL).toContain("sessionStorage");
    expect(PANEL).toContain("FINAL_ERRORS");
  });

  it("פתיחה מנצלת מכסה רק בלחיצה על כפתור, לא באפקט אוטומטי", () => {
    const effects = PANEL.match(/useEffect\([\s\S]*?\n  \}, \[[^\]]*\]\);/g) ?? [];
    for (const effect of effects) expect(effect).not.toContain("openSubscriberReport");
    expect(PANEL).toContain("onClick={open}");
  });
});

describe("דף הרכישה והתשלום", () => {
  it("המחיר והמכסה מגיעים מהשרת, בלי מספרי מחיר מקודדים בדף", () => {
    expect(SUBSCRIBE).toContain("fetchPlans()");
    expect(SUBSCRIBE).not.toMatch(/\b(790|2,?490|8,?530|26,?890)\b/);
    expect(SUBSCRIBE).toContain("formatPriceNis(CATALOG.baseReport.priceAgorot)");
  });

  it("הרכישה שולחת חבילה ותשלום בלבד, והלקוח לא שולח סכום", () => {
    expect(LIB).toContain('{ plan, products: "dohefes", billing, origin: "dohefes" }');
    expect(LIB).not.toMatch(/amount|price_agorot|priceNis/i);
  });

  it("אין קישור לתשלום בקארדקום מקודד בדפי המנויים", () => {
    for (const source of [SUBSCRIBE, ACCOUNT, LOGIN, PANEL, LIB]) expect(source).not.toMatch(/cardcom/i);
  });
});

describe("האזור האישי", () => {
  it("מציג רק מנויי דוחות אפס, ומציין שהגישה לדוחות שמורה בדפדפן", () => {
    expect(ACCOUNT).toContain("onlyDohefes(await getMySubscriptions())");
    expect(ACCOUNT).toContain("הגישה לדוח נשמרת בדפדפן");
  });

  it("לא מחובר: מעביר לכניסה וחוזר לאזור האישי", () => {
    expect(ACCOUNT).toContain('rememberNext("/account/")');
    expect(ACCOUNT).toContain('router.replace("/login/")');
  });
});

describe("נקודות הכניסה באתר", () => {
  it("שני הכפתורים מופיעים בכותרת ובעמוד הראשי", () => {
    expect(LAYOUT).toContain('<SubscriberLinks variant="header" />');
    expect(HOME).toContain('<SubscriberLinks variant="hero" />');
  });

  it("דף הרכישה במפת האתר, ודפי הכניסה והאזור האישי לא", () => {
    expect(SITEMAP).toContain('"/subscribe/"');
    expect(SITEMAP).not.toContain("/login/");
    expect(SITEMAP).not.toContain("/account/");
  });

  it("דפי הכניסה והאזור האישי לא מאונדקסים", () => {
    expect(read("app/login/layout.tsx")).toContain("privatePageMetadata");
    expect(read("app/account/layout.tsx")).toContain("privatePageMetadata");
    expect(read("app/subscribe/layout.tsx")).toContain("publicPageMetadata");
  });
});
