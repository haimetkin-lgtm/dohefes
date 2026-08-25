import { describe, expect, it } from "vitest";
import { computeSalesBatchMonthlyReceipts, computeUnitRowMonthlyReceipts } from "./cashflow-sales-schedule";
import type { ReceiptRowInput, UnitSalesBatch } from "./cashflow-sales-schedule";
import { resolveConstructionCurve } from "./cashflow-construction-curve";
import type { PaymentTranche } from "./cashflow-types";

function sum(receipts: { amountNis: number }[]): number {
  return receipts.reduce((s, r) => s + r.amountNis, 0);
}

const preset15_70_15: PaymentTranche[] = [
  { fraction: 0.15, timing: { kind: "relativeToSale", monthsAfterSale: 0 }, label: "בחתימה" },
  { fraction: 0.7, timing: { kind: "evenSpread", fromMonthsAfterSale: 1, toMonthsAfterSale: 21 }, label: "בהתקדמות" },
  { fraction: 0.15, timing: { kind: "handover" }, label: "במסירה" },
];

// ===== 1. UnitSalesBatch: הפרדת קצב מכירות מלוח תשלומים =====

describe("UnitSalesBatch: אותו טיפוס דירה נמכר במספר חודשים שונים", () => {
  const unit: ReceiptRowInput = { count: 20, priceNis: 2_000_000, category: "residential" };
  // 20 יחידות מאותו טיפוס, אבל לא כולן נמכרות יחד: 8 בחודש 2, 7 בחודש 6, 5 בחודש 10
  const batches: UnitSalesBatch[] = [
    { unitsCount: 8, saleMonth: 2 },
    { unitsCount: 7, saleMonth: 6 },
    { unitsCount: 5, saleMonth: 10 },
  ];

  it("סכום unitsCount בכל ה-batches שווה ל-UnitType.count", () => {
    expect(batches.reduce((s, b) => s + b.unitsCount, 0)).toBe(unit.count);
  });

  it("כל batch מקבל לוח תשלומים נפרד, עוגן לפי חודש המכירה שלו", () => {
    const receipts = computeUnitRowMonthlyReceipts(unit, batches, preset15_70_15, 0, 31, "explicitSchedule");
    // חודש 2: batch1 (8 יח') נחתם בדיוק שם, וה-evenSpread שלו עדיין לא התחיל (מתחיל בחודש 3) -
    // אף batch אחר עדיין לא נמכר (saleMonth 6/10) - זו נקודה "מבודדת" שמוכיחה עיגון לפי saleMonth
    const at2 = receipts.find((r) => r.monthIndex === 2)!;
    expect(at2.amountNis).toBeCloseTo(0.15 * 8 * unit.priceNis, 4);

    // חודש 6 ו-10: מכילים גם את מנת החתימה של batch2/batch3 בהתאמה, אבל גם תרומה מה-evenSpread
    // המתמשך של batch-ים קודמים שכבר החלו (חפיפה טבעית ותקינה, לא באג) - בודקים "לפחות" סכום
    // החתימה של אותו batch עצמו, לא שוויון מדויק
    const at6 = receipts.find((r) => r.monthIndex === 6)!;
    const at10 = receipts.find((r) => r.monthIndex === 10)!;
    expect(at6.amountNis).toBeGreaterThanOrEqual(0.15 * 7 * unit.priceNis);
    expect(at10.amountNis).toBeGreaterThanOrEqual(0.15 * 5 * unit.priceNis);
  });

  it("סכום כל התקבולים על פני כל ה-batches שווה בדיוק למחיר כל 20 היחידות", () => {
    const receipts = computeUnitRowMonthlyReceipts(unit, batches, preset15_70_15, 0, 31, "explicitSchedule");
    expect(sum(receipts)).toBe(unit.count * unit.priceNis);
  });

  it("נכשל אם סכום unitsCount לא שווה ל-count", () => {
    const badBatches: UnitSalesBatch[] = [{ unitsCount: 15, saleMonth: 2 }]; // חסרות 5 יחידות
    expect(() => computeUnitRowMonthlyReceipts(unit, badBatches, preset15_70_15, 0, 30, "explicitSchedule")).toThrow(/סכום/);
  });

  it("נכשל על unitsCount שלילי או לא שלם", () => {
    expect(() =>
      computeUnitRowMonthlyReceipts(unit, [{ unitsCount: -1, saleMonth: 2 }], preset15_70_15, 0, 30, "explicitSchedule")
    ).toThrow();
    expect(() =>
      computeUnitRowMonthlyReceipts(unit, [{ unitsCount: 3.5, saleMonth: 2 }], preset15_70_15, 0, 30, "explicitSchedule")
    ).toThrow();
  });

  it("נכשל על saleMonth לפני תחילת השיווק או אחרי המסירה", () => {
    expect(() =>
      computeUnitRowMonthlyReceipts(unit, [{ unitsCount: 20, saleMonth: -1 }], preset15_70_15, 0, 30, "explicitSchedule")
    ).toThrow();
    expect(() =>
      computeUnitRowMonthlyReceipts(unit, [{ unitsCount: 20, saleMonth: 31 }], preset15_70_15, 0, 30, "explicitSchedule")
    ).toThrow();
  });
});

describe("יחידות שאף פעם לא מקבלות batches ולא מייצרות תקבול", () => {
  const batches: UnitSalesBatch[] = [{ unitsCount: 5, saleMonth: 2 }];

  it("יחידת תמורה (isCompensationUnit) מחזירה מערך ריק", () => {
    const unit: ReceiptRowInput = { count: 5, priceNis: 2_000_000, isCompensationUnit: true };
    expect(computeUnitRowMonthlyReceipts(unit, batches, preset15_70_15, 0, 24, "explicitSchedule")).toEqual([]);
  });

  it("מבנה קיים (isExistingStructure) מחזיר מערך ריק", () => {
    const unit: ReceiptRowInput = { count: 5, priceNis: 2_000_000, isExistingStructure: true };
    expect(computeUnitRowMonthlyReceipts(unit, batches, preset15_70_15, 0, 24, "explicitSchedule")).toEqual([]);
  });

  it('מב"צ (category="publicBuilding") מחזיר מערך ריק', () => {
    const unit: ReceiptRowInput = { count: 5, priceNis: 0, category: "publicBuilding" };
    expect(computeUnitRowMonthlyReceipts(unit, batches, preset15_70_15, 0, 24, "explicitSchedule")).toEqual([]);
  });
});

// ===== 2. constructionProgress מוזז לציר הפרויקט (permitMonths + חודש בנייה יחסי) =====

describe("constructionProgress: היסט לציר הפרויקט לפי תקופת ההיתר", () => {
  it("8 חודשי היתר + 50% התקדמות בחודש בנייה יחסי 11 -> חודש פרויקט 19, לא 11", () => {
    const permitMonths = 8;
    const constructionMonths = 24;
    const constructionCurve = resolveConstructionCurve(constructionMonths, { model: "linear" }); // curve[11]=(12)/24=0.5
    const handoverMonth = permitMonths + constructionMonths - 1; // 8+24-1=31 (0-based, חודש אחרון)

    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 0.5 }, label: "50%" }];
    const receipts = computeSalesBatchMonthlyReceipts(
      { unitsCount: 1, priceNis: 1_000_000 },
      tranches,
      0,
      handoverMonth,
      "legacyConstructionLinked",
      constructionCurve,
      permitMonths
    );

    expect(receipts).toEqual([{ monthIndex: 19, amountNis: 1_000_000 }]);
  });

  it("ללא constructionStartMonth (0), התקבול נופל ישירות באינדקס היחסי", () => {
    const constructionCurve = resolveConstructionCurve(24, { model: "linear" });
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 0.5 }, label: "50%" }];
    const receipts = computeSalesBatchMonthlyReceipts({ unitsCount: 1, priceNis: 1_000_000 }, tranches, 0, 23, "legacyConstructionLinked", constructionCurve, 0);
    expect(receipts).toEqual([{ monthIndex: 11, amountNis: 1_000_000 }]);
  });
});

// ===== 3. אין fallback שקט בעקומת התקדמות =====

describe("constructionProgress: אין fallback שקט, עקומה לא תקינה נכשלת במפורש", () => {
  it("נכשל כשהעקומה מסתיימת ב-0.8 כשנדרש 1.0 (עקומה לא תקינה)", () => {
    const invalidCurve = [0.2, 0.5, 0.8]; // לא מגיעה ל-100%
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 0.9 }, label: "90%" }];
    expect(() =>
      computeSalesBatchMonthlyReceipts({ unitsCount: 1, priceNis: 1_000_000 }, tranches, 0, 10, "legacyConstructionLinked", invalidCurve, 0)
    ).toThrow();
  });

  it("נכשל אם מבקשים התקדמות שהעקומה (התקינה) לא מגיעה אליה בפועל, לא מוזז לחודש אחרון", () => {
    // עקומה תקינה (מגיעה ל-1) אך cumulativeProgress גדול מ-1 כבר נדחה קודם ע"י validatePaymentSchedule -
    // כאן בודקים ישירות את resolveConstructionProgressProjectMonth דרך קריאה שמדלגת על אותה בדיקה:
    // עקומה עם ערך מקסימלי נמוך מהמבוקש, אך שעדיין "תקינה" מבחינת validateCumulativePercentByMonth
    // (12 חודשים, מגיעה ל-100%, פשוט cumulativeProgress המבוקש גבוה מ-1 נדחה קודם - לכן משתמשים כאן
    // בעקומה לא-תקינה בכוונה כדי לוודא שהמסלול הזה (לא "no index found") גם נכשל, לא fallback):
    const invalidCurve = [0.1, 0.2, 0.3]; // לא מגיעה ל-100%, ולכן גם "לא מגיעה" ל-0.5 שהתבקש כאן במובן שהעקומה עצמה פסולה
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 0.5 }, label: "50%" }];
    expect(() =>
      computeSalesBatchMonthlyReceipts({ unitsCount: 1, priceNis: 1_000_000 }, tranches, 0, 10, "legacyConstructionLinked", invalidCurve, 0)
    ).toThrow();
  });
});

// ===== 4. ולידציה ליחידות ולסכומים =====

describe("ולידציית קלט: count/priceNis", () => {
  it("נכשל על count לא סופי (NaN/Infinity)", () => {
    expect(() => computeSalesBatchMonthlyReceipts({ unitsCount: NaN, priceNis: 1_000_000 }, preset15_70_15, 0, 24, "explicitSchedule")).toThrow();
    expect(() => computeSalesBatchMonthlyReceipts({ unitsCount: Infinity, priceNis: 1_000_000 }, preset15_70_15, 0, 24, "explicitSchedule")).toThrow();
  });

  it("נכשל על priceNis שלילי או לא סופי", () => {
    expect(() => computeSalesBatchMonthlyReceipts({ unitsCount: 1, priceNis: -100 }, preset15_70_15, 0, 24, "explicitSchedule")).toThrow();
    expect(() => computeSalesBatchMonthlyReceipts({ unitsCount: 1, priceNis: NaN }, preset15_70_15, 0, 24, "explicitSchedule")).toThrow();
  });

  it("נכשל על unitsCount שלילי או לא שלם", () => {
    expect(() => computeSalesBatchMonthlyReceipts({ unitsCount: -2, priceNis: 1_000_000 }, preset15_70_15, 0, 24, "explicitSchedule")).toThrow();
    expect(() => computeSalesBatchMonthlyReceipts({ unitsCount: 2.5, priceNis: 1_000_000 }, preset15_70_15, 0, 24, "explicitSchedule")).toThrow();
  });

  it("כל תקבול מוחזר סופי, לא-שלילי, עם monthIndex שלם בטווח הפרויקט", () => {
    const receipts = computeSalesBatchMonthlyReceipts({ unitsCount: 5, priceNis: 2_000_000 }, preset15_70_15, 3, 24, "explicitSchedule");
    for (const r of receipts) {
      expect(Number.isFinite(r.amountNis)).toBe(true);
      expect(r.amountNis).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(r.monthIndex)).toBe(true);
      expect(r.monthIndex).toBeGreaterThanOrEqual(0);
      expect(r.monthIndex).toBeLessThanOrEqual(24);
    }
  });
});

// ===== 5. בדיקת evenSpread מחוזקת =====

describe("evenSpread מחוזק: 15/70/15, saleMonth=3, handoverMonth=24", () => {
  const unit = { unitsCount: 5, priceNis: 2_000_000 };
  const receipts = computeSalesBatchMonthlyReceipts(unit, preset15_70_15, 3, 24, "explicitSchedule");
  const totalAmountNis = unit.unitsCount * unit.priceNis;
  const perMonthSpread = (0.7 * totalAmountNis) / 21; // 21 חודשים: 4 עד 24 כולל

  it("בדיוק 21 חודשים בטווח evenSpread (4 עד 24), ואין תקבול מחוץ לטווח [3,24]", () => {
    for (const r of receipts) {
      expect(r.monthIndex).toBeGreaterThanOrEqual(3);
      expect(r.monthIndex).toBeLessThanOrEqual(24);
    }
    // 22 חודשים סה"כ: 3 (חתימה) + 4..24 (evenSpread, 21 חודשים, חופף עם 24=מסירה)
    const monthIndexes = receipts.map((r) => r.monthIndex);
    expect(new Set(monthIndexes).size).toBe(22); // 3, 4, 5, ..., 24
  });

  it("כל חודש 4 עד 23 מקבל בדיוק את חלקו היחסי מה-evenSpread (70%/21)", () => {
    for (let m = 4; m <= 23; m++) {
      const r = receipts.find((x) => x.monthIndex === m)!;
      expect(r.amountNis).toBeCloseTo(perMonthSpread, 6);
    }
  });

  it("חודש 24 מקבל evenSpread + 15% מסירה + כל תיקון עיגול (residual)", () => {
    const at24 = receipts.find((r) => r.monthIndex === 24)!;
    const expectedBeforeResidual = perMonthSpread + 0.15 * totalAmountNis;
    // מותר סטייה קטנה (residual), אבל לא סטייה גדולה
    expect(Math.abs(at24.amountNis - expectedBeforeResidual)).toBeLessThan(1);
  });

  it("חודש 3 (חתימה) מקבל בדיוק 15%, בלי מרכיב evenSpread", () => {
    const at3 = receipts.find((r) => r.monthIndex === 3)!;
    expect(at3.amountNis).toBeCloseTo(0.15 * totalAmountNis, 6);
  });

  it("סכום כולל שווה בדיוק לסכום המכירה", () => {
    expect(sum(receipts)).toBe(totalAmountNis);
  });
});

describe("evenSpread, טווח חודש יחיד (from===to)", () => {
  it("מחלקת בצורה דטרמיניסטית - כל הסכום בחודש היחיד", () => {
    const tranches: PaymentTranche[] = [
      { fraction: 1, timing: { kind: "evenSpread", fromMonthsAfterSale: 5, toMonthsAfterSale: 5 }, label: "חודש בודד" },
    ];
    const receipts = computeSalesBatchMonthlyReceipts({ unitsCount: 5, priceNis: 2_000_000 }, tranches, 0, 24, "explicitSchedule");
    expect(receipts).toHaveLength(1);
    expect(receipts[0].monthIndex).toBe(5);
    expect(receipts[0].amountNis).toBe(5 * 2_000_000);
  });
});

// ===== שאר סוגי PaymentTiming (ר' commit 3 המקורי) =====

describe("relativeToSale / projectMonth / handover", () => {
  it("relativeToSale ממוקם נכון ביחס לחודש המכירה", () => {
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "relativeToSale", monthsAfterSale: 4 }, label: "מנה" }];
    const receipts = computeSalesBatchMonthlyReceipts({ unitsCount: 5, priceNis: 2_000_000 }, tranches, 6, 24, "explicitSchedule");
    expect(receipts).toEqual([{ monthIndex: 10, amountNis: 5 * 2_000_000 }]);
  });

  it("projectMonth ממוקם בחודש המוחלט שצוין", () => {
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "projectMonth", monthIndex: 15 }, label: "מנה" }];
    const receipts = computeSalesBatchMonthlyReceipts({ unitsCount: 5, priceNis: 2_000_000 }, tranches, 6, 24, "explicitSchedule");
    expect(receipts).toEqual([{ monthIndex: 15, amountNis: 5 * 2_000_000 }]);
  });

  it("handover ממוקם תמיד בדיוק בחודש המסירה", () => {
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "handover" }, label: "מנה" }];
    const receipts = computeSalesBatchMonthlyReceipts({ unitsCount: 5, priceNis: 2_000_000 }, tranches, 6, 24, "explicitSchedule");
    expect(receipts).toEqual([{ monthIndex: 24, amountNis: 5 * 2_000_000 }]);
  });
});

describe("constructionProgress נדחה מחוץ ל-legacyConstructionLinked", () => {
  it("נדחה (throws) כשמופיע במסלול explicitSchedule", () => {
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 0.5 }, label: "מנה" }];
    expect(() => computeSalesBatchMonthlyReceipts({ unitsCount: 1, priceNis: 1_000_000 }, tranches, 0, 24, "explicitSchedule")).toThrow();
  });
});

describe("מגורים מול מסחר/משרדים - בסיס המע\"מ אינו מומר", () => {
  it("התקבול הכולל תמיד count*priceNis, ללא קשר לקטגוריה", () => {
    const residential: ReceiptRowInput = { count: 2, priceNis: 3_000_000, category: "residential" };
    const commercial: ReceiptRowInput = { count: 1, priceNis: 1_500_000, category: "commercial" };
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "handover" }, label: "מנה" }];

    const residentialReceipts = computeUnitRowMonthlyReceipts(residential, [{ unitsCount: 2, saleMonth: 0 }], tranches, 0, 12, "explicitSchedule");
    const commercialReceipts = computeUnitRowMonthlyReceipts(commercial, [{ unitsCount: 1, saleMonth: 0 }], tranches, 0, 12, "explicitSchedule");

    expect(sum(residentialReceipts)).toBe(residential.count * residential.priceNis);
    expect(sum(commercialReceipts)).toBe(commercial.count * commercial.priceNis);
  });
});

describe("לוח לא תקין נדחה מוקדם", () => {
  it("זורק על לוח עם סכום fraction שגוי", () => {
    const badTranches: PaymentTranche[] = [{ fraction: 0.5, timing: { kind: "handover" }, label: "חצי בלבד" }];
    expect(() => computeSalesBatchMonthlyReceipts({ unitsCount: 5, priceNis: 2_000_000 }, badTranches, 0, 24, "explicitSchedule")).toThrow();
  });
});
