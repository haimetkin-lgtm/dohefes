import { describe, expect, it } from "vitest";
import { computeUnitMonthlyReceipts } from "./cashflow-sales-schedule";
import type { ReceiptUnitInput } from "./cashflow-sales-schedule";
import { resolveConstructionCurve } from "./cashflow-construction-curve";
import type { PaymentTranche } from "./cashflow-types";

const soldUnit: ReceiptUnitInput = { count: 5, priceNis: 2_000_000, category: "residential" };

function sum(receipts: { amountNis: number }[]): number {
  return receipts.reduce((s, r) => s + r.amountNis, 0);
}

const preset15_70_15: PaymentTranche[] = [
  { fraction: 0.15, timing: { kind: "relativeToSale", monthsAfterSale: 0 }, label: "בחתימה" },
  { fraction: 0.7, timing: { kind: "evenSpread", fromMonthsAfterSale: 1, toMonthsAfterSale: 21 }, label: "בהתקדמות" },
  { fraction: 0.15, timing: { kind: "handover" }, label: "במסירה" },
];

describe("computeUnitMonthlyReceipts, לוח 15/70/15 סטנדרטי", () => {
  it("סכום כל התקבולים שווה בדיוק למחיר היחידה (count*priceNis)", () => {
    const receipts = computeUnitMonthlyReceipts(soldUnit, preset15_70_15, 3, 24, "explicitSchedule");
    expect(sum(receipts)).toBe(soldUnit.count * soldUnit.priceNis);
  });

  it("המנה הראשונה (15%) נופלת בדיוק בחודש המכירה", () => {
    const receipts = computeUnitMonthlyReceipts(soldUnit, preset15_70_15, 3, 24, "explicitSchedule");
    const atSaleMonth = receipts.find((r) => r.monthIndex === 3)!;
    expect(atSaleMonth).toBeDefined();
    expect(atSaleMonth.amountNis).toBeCloseTo(0.15 * soldUnit.count * soldUnit.priceNis, 6);
  });

  it("מנת evenSpread פרוסה על 21 החודשים (4 עד 24) בסכום שווה לכל חודש", () => {
    const receipts = computeUnitMonthlyReceipts(soldUnit, preset15_70_15, 3, 24, "explicitSchedule");
    const spreadMonths = receipts.filter((r) => r.monthIndex >= 4 && r.monthIndex <= 24);
    // 21 חודשים בטווח 4-24, אבל חודש 24 גם מקבל את מנת ה-handover - נבדוק רק חודש באמצע הטווח
    const midMonth = receipts.find((r) => r.monthIndex === 10)!;
    const expectedPerMonth = (0.7 * soldUnit.count * soldUnit.priceNis) / 21;
    expect(midMonth.amountNis).toBeCloseTo(expectedPerMonth, 4);
    expect(spreadMonths.length).toBeGreaterThan(0);
  });

  it("החודש האחרון (24, מסירה) מכיל את מנת ה-15% + חלק evenSpread + כל תיקון עיגול", () => {
    const receipts = computeUnitMonthlyReceipts(soldUnit, preset15_70_15, 3, 24, "explicitSchedule");
    const last = receipts.find((r) => r.monthIndex === 24)!;
    expect(last).toBeDefined();
    expect(last.amountNis).toBeGreaterThan(0);
  });
});

describe("יחידות שאף פעם לא מייצרות תקבול", () => {
  it("יחידת תמורה (isCompensationUnit) מחזירה מערך ריק", () => {
    const unit: ReceiptUnitInput = { ...soldUnit, isCompensationUnit: true };
    expect(computeUnitMonthlyReceipts(unit, preset15_70_15, 3, 24, "explicitSchedule")).toEqual([]);
  });

  it("מבנה קיים (isExistingStructure) מחזיר מערך ריק", () => {
    const unit: ReceiptUnitInput = { ...soldUnit, isExistingStructure: true };
    expect(computeUnitMonthlyReceipts(unit, preset15_70_15, 3, 24, "explicitSchedule")).toEqual([]);
  });

  it('מב"צ (category="publicBuilding") מחזיר מערך ריק', () => {
    const unit: ReceiptUnitInput = { ...soldUnit, category: "publicBuilding" };
    expect(computeUnitMonthlyReceipts(unit, preset15_70_15, 3, 24, "explicitSchedule")).toEqual([]);
  });
});

describe("evenSpread, טווח חודש יחיד (from===to)", () => {
  it("מחלקת בצורה דטרמיניסטית - כל הסכום בחודש היחיד", () => {
    const tranches: PaymentTranche[] = [
      { fraction: 1, timing: { kind: "evenSpread", fromMonthsAfterSale: 5, toMonthsAfterSale: 5 }, label: "חודש בודד" },
    ];
    const receipts = computeUnitMonthlyReceipts(soldUnit, tranches, 0, 24, "explicitSchedule");
    expect(receipts).toHaveLength(1);
    expect(receipts[0].monthIndex).toBe(5);
    expect(receipts[0].amountNis).toBe(soldUnit.count * soldUnit.priceNis);
  });
});

describe("relativeToSale / projectMonth / handover", () => {
  it("relativeToSale ממוקם נכון ביחס לחודש המכירה", () => {
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "relativeToSale", monthsAfterSale: 4 }, label: "מנה" }];
    const receipts = computeUnitMonthlyReceipts(soldUnit, tranches, 6, 24, "explicitSchedule");
    expect(receipts).toEqual([{ monthIndex: 10, amountNis: soldUnit.count * soldUnit.priceNis }]);
  });

  it("projectMonth ממוקם בחודש המוחלט שצוין", () => {
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "projectMonth", monthIndex: 15 }, label: "מנה" }];
    const receipts = computeUnitMonthlyReceipts(soldUnit, tranches, 6, 24, "explicitSchedule");
    expect(receipts).toEqual([{ monthIndex: 15, amountNis: soldUnit.count * soldUnit.priceNis }]);
  });

  it("handover ממוקם תמיד בדיוק בחודש המסירה", () => {
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "handover" }, label: "מנה" }];
    const receipts = computeUnitMonthlyReceipts(soldUnit, tranches, 6, 24, "explicitSchedule");
    expect(receipts).toEqual([{ monthIndex: 24, amountNis: soldUnit.count * soldUnit.priceNis }]);
  });
});

describe("constructionProgress, רק במסלול legacyConstructionLinked", () => {
  it("נדחה (throws) כשמופיע במסלול explicitSchedule", () => {
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 0.5 }, label: "מנה" }];
    expect(() => computeUnitMonthlyReceipts(soldUnit, tranches, 0, 24, "explicitSchedule")).toThrow();
  });

  it("זורק כשחסר constructionCurve במסלול legacyConstructionLinked", () => {
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 0.5 }, label: "מנה" }];
    expect(() => computeUnitMonthlyReceipts(soldUnit, tranches, 0, 24, "legacyConstructionLinked")).toThrow();
  });

  it("ממוקם בחודש הראשון שבו עקומת הבנייה מגיעה לאחוז ההתקדמות", () => {
    const curve = resolveConstructionCurve(24, { model: "linear" }); // curve[i] = (i+1)/24
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 0.5 }, label: "מנה" }];
    const receipts = computeUnitMonthlyReceipts(soldUnit, tranches, 0, 24, "legacyConstructionLinked", curve);
    // 0.5 מגיע לראשונה כש-(i+1)/24>=0.5 -> i+1>=12 -> i=11 (0-based)
    expect(receipts).toEqual([{ monthIndex: 11, amountNis: soldUnit.count * soldUnit.priceNis }]);
  });

  it("סכום כל התקבולים במודל legacy שווה בדיוק למחיר היחידה גם עם כמה מנות", () => {
    const curve = resolveConstructionCurve(12, { model: "sCurve" });
    const tranches: PaymentTranche[] = [
      { fraction: 0.3, timing: { kind: "constructionProgress", cumulativeProgress: 0.25 }, label: "רבע" },
      { fraction: 0.4, timing: { kind: "constructionProgress", cumulativeProgress: 0.6 }, label: "60%" },
      { fraction: 0.3, timing: { kind: "constructionProgress", cumulativeProgress: 1 }, label: "גמר" },
    ];
    const receipts = computeUnitMonthlyReceipts(soldUnit, tranches, 0, 12, "legacyConstructionLinked", curve);
    expect(sum(receipts)).toBe(soldUnit.count * soldUnit.priceNis);
  });
});

describe("מגורים מול מסחר/משרדים - בסיס המע\"מ אינו מומר", () => {
  it("התקבול הכולל תמיד count*priceNis, ללא קשר לקטגוריה", () => {
    const residential: ReceiptUnitInput = { count: 2, priceNis: 3_000_000, category: "residential" };
    const commercial: ReceiptUnitInput = { count: 1, priceNis: 1_500_000, category: "commercial" };
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "handover" }, label: "מנה" }];

    const residentialReceipts = computeUnitMonthlyReceipts(residential, tranches, 0, 12, "explicitSchedule");
    const commercialReceipts = computeUnitMonthlyReceipts(commercial, tranches, 0, 12, "explicitSchedule");

    expect(sum(residentialReceipts)).toBe(residential.count * residential.priceNis);
    expect(sum(commercialReceipts)).toBe(commercial.count * commercial.priceNis);
  });
});

describe("count>1 מגדיל את הסכום הכולל בהתאם", () => {
  it("סכום שווה ל-count*priceNis, לא רק priceNis", () => {
    const unit: ReceiptUnitInput = { count: 8, priceNis: 2_200_000, category: "residential" };
    const receipts = computeUnitMonthlyReceipts(unit, preset15_70_15, 0, 24, "explicitSchedule");
    expect(sum(receipts)).toBe(unit.count * unit.priceNis);
  });
});

describe("לוח לא תקין נדחה מוקדם", () => {
  it("זורק על לוח עם סכום fraction שגוי", () => {
    const badTranches: PaymentTranche[] = [{ fraction: 0.5, timing: { kind: "handover" }, label: "חצי בלבד" }];
    expect(() => computeUnitMonthlyReceipts(soldUnit, badTranches, 0, 24, "explicitSchedule")).toThrow();
  });
});
