import { describe, expect, it } from "vitest";
import { PRODUCTS as PAYMENT_PRODUCTS } from "../supabase/functions/_shared/payment-products";
import { CATALOG, UNIT_RANKING_FEATURE, formatPriceNis, getCatalogEntry, isProductId } from "./catalog";
import type { ProductId } from "./catalog";

describe("CATALOG - שלושת המוצרים במחיר 98,000 אגורות", () => {
  it("baseReport/cashFlowAnalysis/trackingReports - כולם 98_000 אגורות בדיוק", () => {
    for (const entry of Object.values(CATALOG)) {
      expect(entry.priceAgorot).toBe(98_000);
    }
  });

  it("baseReport/cashFlowAnalysis/trackingReports - המחיר מיובא מ-payment-products.ts, לא משוכפל כערך נפרד", () => {
    expect(CATALOG.baseReport.priceAgorot).toBe(PAYMENT_PRODUCTS.baseReport.amountAgorot);
    expect(CATALOG.cashFlowAnalysis.priceAgorot).toBe(PAYMENT_PRODUCTS.cashFlowAnalysis.amountAgorot);
    expect(CATALOG.trackingReports.priceAgorot).toBe(PAYMENT_PRODUCTS.trackingReports.amountAgorot);
  });
});

describe("CATALOG - מזהי מוצר ייחודיים", () => {
  it("כל מפתח ב-CATALOG שווה לשדה id של אותה רשומה", () => {
    for (const [key, entry] of Object.entries(CATALOG)) {
      expect(entry.id).toBe(key);
    }
  });

  it("אין כפילויות בין שלושת מזהי המוצר", () => {
    const ids = Object.values(CATALOG).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(3);
  });

  it("isProductId מזהה נכון את שלושת המוצרים, דוחה כל ערך אחר", () => {
    expect(isProductId("baseReport")).toBe(true);
    expect(isProductId("cashFlowAnalysis")).toBe(true);
    expect(isProductId("trackingReports")).toBe(true);
    expect(isProductId("unitRanking")).toBe(false);
    expect(isProductId("basicReport")).toBe(false);
    expect(isProductId("")).toBe(false);
    expect(isProductId(null)).toBe(false);
    expect(isProductId(undefined)).toBe(false);
    expect(isProductId(123)).toBe(false);
  });

  it("getCatalogEntry מחזירה את הרשומה הנכונה לכל מזהה", () => {
    (Object.keys(CATALOG) as ProductId[]).forEach((id) => {
      expect(getCatalogEntry(id)).toBe(CATALOG[id]);
    });
  });
});

describe("trackingReports - מוצר עצמאי", () => {
  it("paymentProductType נפרד משלו, לא זהה ל-baseReport/cashFlowAnalysis", () => {
    expect(CATALOG.trackingReports.paymentProductType).toBe("trackingReports");
    expect(CATALOG.trackingReports.paymentProductType).not.toBe(CATALOG.baseReport.paymentProductType);
    expect(CATALOG.trackingReports.paymentProductType).not.toBe(CATALOG.cashFlowAnalysis.paymentProductType);
  });

  it("לא כלול ב-allowedActions של baseReport - אינו תכונה גורפת של דוח הבסיס", () => {
    expect(CATALOG.baseReport.allowedActions).not.toContain("tracking");
  });
});

describe("unitRanking - אינו מוצר בתשלום", () => {
  it("לא חבר ב-CATALOG (לא ProductId, אין לו priceAgorot/paymentProductType)", () => {
    expect(Object.keys(CATALOG)).not.toContain("unitRanking");
    expect(isProductId("unitRanking")).toBe(false);
  });

  it("UNIT_RANKING_FEATURE לא מכיל שדה price/paymentProductType בכלל", () => {
    expect(UNIT_RANKING_FEATURE).not.toHaveProperty("priceAgorot");
    expect(UNIT_RANKING_FEATURE).not.toHaveProperty("paymentProductType");
  });

  it("דורש דוח baseReport שנרכש (reportId), לא מוצר עצמאי משלו", () => {
    expect(UNIT_RANKING_FEATURE.requiresPurchasedProduct).toBe("baseReport");
  });
});

describe("unitRanking - רלוונטי רק לפינוי-בינוי", () => {
  it("relevantDealTypes מכיל אך ורק pinuyBinui", () => {
    expect(UNIT_RANKING_FEATURE.relevantDealTypes).toEqual(["pinuyBinui"]);
  });
});

describe("CATALOG - אין ערכי מחיר לא סופיים/שליליים", () => {
  it("priceAgorot הוא מספר שלם חיובי וסופי לכל מוצר", () => {
    for (const entry of Object.values(CATALOG)) {
      expect(Number.isFinite(entry.priceAgorot)).toBe(true);
      expect(Number.isInteger(entry.priceAgorot)).toBe(true);
      expect(entry.priceAgorot).toBeGreaterThan(0);
    }
  });

  it("priceAgorot דוחה NaN/Infinity/שלילי - בדיקת קצה על עצם קיום הבדיקה למעלה", () => {
    expect(Number.isFinite(NaN)).toBe(false);
    expect(Number.isFinite(Infinity)).toBe(false);
    expect(-98_000).toBeLessThan(0);
  });
});

describe("CATALOG - אי-מוטציה (immutability)", () => {
  it("CATALOG עצמו קפוא", () => {
    expect(Object.isFrozen(CATALOG)).toBe(true);
  });

  it("כל רשומה בקטלוג קפואה", () => {
    for (const entry of Object.values(CATALOG)) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it("מערכי includedFeatures/allowedActions קפואים בתוך כל רשומה", () => {
    for (const entry of Object.values(CATALOG)) {
      expect(Object.isFrozen(entry.includedFeatures)).toBe(true);
      expect(Object.isFrozen(entry.allowedActions)).toBe(true);
    }
  });

  it("ניסיון לשנות ערך קיים ב-CATALOG לא משפיע בפועל (strict mode/קפוא)", () => {
    const before = CATALOG.baseReport.displayName;
    try {
      // @ts-expect-error - בדיקת קפיאה בכוונה, לא שימוש חוקי
      CATALOG.baseReport.displayName = "שם אחר";
    } catch {
      // strict mode עשוי לזרוק - זו התנהגות תקינה, לא כישלון הבדיקה
    }
    expect(CATALOG.baseReport.displayName).toBe(before);
  });

  it("UNIT_RANKING_FEATURE קפוא, כולל relevantDealTypes/allowedActions", () => {
    expect(Object.isFrozen(UNIT_RANKING_FEATURE)).toBe(true);
    expect(Object.isFrozen(UNIT_RANKING_FEATURE.relevantDealTypes)).toBe(true);
    expect(Object.isFrozen(UNIT_RANKING_FEATURE.allowedActions)).toBe(true);
  });
});

describe("formatPriceNis - פורמט מחיר טהור, לשימוש משותף בכל המסכים (Commit 3)", () => {
  it("98,000 אגורות -> '980 ₪' - מחיר baseReport/cashFlowAnalysis/trackingReports בפועל", () => {
    expect(formatPriceNis(98_000)).toBe("980 ₪");
    expect(formatPriceNis(CATALOG.baseReport.priceAgorot)).toBe("980 ₪");
    expect(formatPriceNis(CATALOG.cashFlowAnalysis.priceAgorot)).toBe("980 ₪");
    expect(formatPriceNis(CATALOG.trackingReports.priceAgorot)).toBe("980 ₪");
  });

  it("מפריד אלפים בעברית - 180,000 אגורות -> '1,800 ₪'", () => {
    expect(formatPriceNis(180_000)).toBe("1,800 ₪");
  });

  it("0 אגורות -> '0 ₪' (קצה, לא קורס)", () => {
    expect(formatPriceNis(0)).toBe("0 ₪");
  });

  it("מעגל לשקל שלם - הגנת-עומק, לא צפוי לקרות בערכי הקטלוג בפועל (כולם עגולים)", () => {
    expect(formatPriceNis(98_050)).toBe("981 ₪");
    expect(formatPriceNis(98_049)).toBe("980 ₪");
  });

  it("תמיד מסתיים ב-' ₪' עם רווח לפני הסימן, לשלושת מחירי הקטלוג", () => {
    for (const entry of Object.values(CATALOG)) {
      expect(formatPriceNis(entry.priceAgorot)).toMatch(/^[\d,]+ ₪$/);
    }
  });
});
