import { describe, expect, it } from "vitest";
import {
  isCashFlowCostItemId,
  validateCostTimingOverrideKeys,
  validateCumulativePercentByMonth,
  validateGuaranteeMechanism,
  validatePaymentSchedule,
  validatePaymentTranches,
  validatePhases,
} from "./cashflow-validation";
import type { GuaranteeMechanism, PaymentTranche } from "./cashflow-types";

// לוח 15/70/15 תקין, בדיוק כמו הדוגמה במסמך התכנון (§3.3): saleMonth=3, handoverMonth=24
function validTranches(): PaymentTranche[] {
  return [
    { fraction: 0.15, timing: { kind: "relativeToSale", monthsAfterSale: 0 }, label: "בחתימה" },
    { fraction: 0.7, timing: { kind: "evenSpread", fromMonthsAfterSale: 1, toMonthsAfterSale: 21 }, label: "בהתקדמות" },
    { fraction: 0.15, timing: { kind: "handover" }, label: "במסירה" },
  ];
}

describe("validatePaymentTranches", () => {
  it("לוח 0.15/0.70/0.15 תקין עובר", () => {
    expect(validatePaymentTranches(validTranches()).valid).toBe(true);
  });

  it("דוחה fraction גדול מ-1 (טעות אחוז-במקום-שבר, 15 במקום 0.15)", () => {
    const bad: PaymentTranche[] = [
      { fraction: 15, timing: { kind: "handover" }, label: "טעות" },
    ];
    const result = validatePaymentTranches(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("אחוז"))).toBe(true);
  });

  it("דוחה fraction שלילי", () => {
    const bad: PaymentTranche[] = [
      { fraction: -0.1, timing: { kind: "handover" }, label: "שלילי" },
      { fraction: 1.1, timing: { kind: "handover" }, label: "משלים" },
    ];
    expect(validatePaymentTranches(bad).valid).toBe(false);
  });

  it("דוחה סכום שלא קרוב ל-1", () => {
    const bad: PaymentTranche[] = [{ fraction: 0.5, timing: { kind: "handover" }, label: "חצי" }];
    expect(validatePaymentTranches(bad).valid).toBe(false);
  });

  it("דוחה fraction לא סופי (NaN/Infinity)", () => {
    const bad: PaymentTranche[] = [{ fraction: NaN, timing: { kind: "handover" }, label: "לא סופי" }];
    expect(validatePaymentTranches(bad).valid).toBe(false);
  });
});

describe("validatePaymentSchedule", () => {
  it("לוח 15/70/15 תקין, saleMonth=3 handoverMonth=24, עובר", () => {
    const result = validatePaymentSchedule(validTranches(), 3, 24, "explicitSchedule");
    expect(result.valid).toBe(true);
  });

  it("דוחה relativeToSale שגורם לחודש לפני 0", () => {
    const tranches: PaymentTranche[] = [
      { fraction: 1, timing: { kind: "relativeToSale", monthsAfterSale: -5 }, label: "מוקדם מדי" },
    ];
    expect(validatePaymentSchedule(tranches, 3, 24, "explicitSchedule").valid).toBe(false);
  });

  it("דוחה טווח תשלומים שעובר את חודש המסירה", () => {
    const tranches: PaymentTranche[] = [
      { fraction: 1, timing: { kind: "relativeToSale", monthsAfterSale: 30 }, label: "אחרי המסירה" },
    ];
    const result = validatePaymentSchedule(tranches, 3, 24, "explicitSchedule");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("מסירה"))).toBe(true);
  });

  it("דוחה projectMonth מחוץ לטווח [0, handoverMonth]", () => {
    const tranches: PaymentTranche[] = [{ fraction: 1, timing: { kind: "projectMonth", monthIndex: 99 }, label: "חורג" }];
    expect(validatePaymentSchedule(tranches, 3, 24, "explicitSchedule").valid).toBe(false);
  });

  it("דוחה evenSpread שבו ההתחלה אחרי הסיום", () => {
    const tranches: PaymentTranche[] = [
      { fraction: 1, timing: { kind: "evenSpread", fromMonthsAfterSale: 10, toMonthsAfterSale: 2 }, label: "הפוך" },
    ];
    expect(validatePaymentSchedule(tranches, 3, 24, "explicitSchedule").valid).toBe(false);
  });

  it("דוחה evenSpread שחורג מהמסירה", () => {
    const tranches: PaymentTranche[] = [
      { fraction: 1, timing: { kind: "evenSpread", fromMonthsAfterSale: 1, toMonthsAfterSale: 30 }, label: "חורג" },
    ];
    const result = validatePaymentSchedule(tranches, 3, 24, "explicitSchedule");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("מסירה"))).toBe(true);
  });

  it("דוחה constructionProgress מחוץ לטווח [0,1]", () => {
    const tranches: PaymentTranche[] = [
      { fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 1.5 }, label: "חורג" },
    ];
    expect(validatePaymentSchedule(tranches, 3, 24, "legacyConstructionLinked").valid).toBe(false);
  });

  it("דוחה constructionProgress כשהמודל אינו legacyConstructionLinked", () => {
    const tranches: PaymentTranche[] = [
      { fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 0.5 }, label: "לא legacy" },
    ];
    const result = validatePaymentSchedule(tranches, 3, 24, "explicitSchedule");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("legacyConstructionLinked"))).toBe(true);
  });

  it("מקבל constructionProgress כשהמודל הוא legacyConstructionLinked", () => {
    const tranches: PaymentTranche[] = [
      { fraction: 1, timing: { kind: "constructionProgress", cumulativeProgress: 0.5 }, label: "legacy תקין" },
    ];
    expect(validatePaymentSchedule(tranches, 3, 24, "legacyConstructionLinked").valid).toBe(true);
  });

  it("דוחה handoverMonth לפני saleMonth", () => {
    expect(validatePaymentSchedule(validTranches(), 10, 5, "explicitSchedule").valid).toBe(false);
  });

  it("דוחה saleMonth/handoverMonth לא שלמים או לא סופיים", () => {
    expect(validatePaymentSchedule(validTranches(), 3.5, 24, "explicitSchedule").valid).toBe(false);
    expect(validatePaymentSchedule(validTranches(), 3, Infinity, "explicitSchedule").valid).toBe(false);
  });
});

describe("validateCumulativePercentByMonth", () => {
  it("עקומה עולה שמסתיימת ב-100% עוברת", () => {
    expect(validateCumulativePercentByMonth([0.1, 0.3, 0.6, 1]).valid).toBe(true);
  });

  it("דוחה עקומה יורדת", () => {
    expect(validateCumulativePercentByMonth([0.5, 0.3, 1]).valid).toBe(false);
  });

  it("דוחה ערך מחוץ ל-[0,1]", () => {
    expect(validateCumulativePercentByMonth([0.5, 1.5]).valid).toBe(false);
  });

  it("דוחה חודש אחרון שלא מגיע ל-100%", () => {
    expect(validateCumulativePercentByMonth([0.3, 0.6, 0.8]).valid).toBe(false);
  });

  it("דוחה מערך ריק", () => {
    expect(validateCumulativePercentByMonth([]).valid).toBe(false);
  });
});

describe("isCashFlowCostItemId / validateCostTimingOverrideKeys", () => {
  it("מזהה תקין מזוהה נכון", () => {
    expect(isCashFlowCostItemId("landPurchase")).toBe(true);
    expect(isCashFlowCostItemId("constructionCommercial")).toBe(true);
  });

  it("מזהה לא תקין נדחה", () => {
    expect(isCashFlowCostItemId("notARealCostItem")).toBe(false);
  });

  it("guaranteeCommission/unusedCreditCommission/interest אינם מזהי עלות חוקיים", () => {
    expect(isCashFlowCostItemId("guaranteeCommission")).toBe(false);
    expect(isCashFlowCostItemId("unusedCreditCommission")).toBe(false);
    expect(isCashFlowCostItemId("interest")).toBe(false);
  });

  it("validateCostTimingOverrideKeys דוחה מפתחות לא מוכרים", () => {
    const result = validateCostTimingOverrideKeys(["landPurchase", "bogus"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("bogus"))).toBe(true);
  });
});

describe("validateGuaranteeMechanism", () => {
  it("buyerSaleLaw עם annualRateFraction תקין (0.0085) עובר", () => {
    const mechanism: GuaranteeMechanism = { kind: "buyerSaleLaw", annualRateFraction: 0.0085 };
    expect(validateGuaranteeMechanism(mechanism).valid).toBe(true);
  });

  it("דוחה annualRateFraction גדול מ-1 (טעות אחוז-במקום-שבר, 0.85 במקום 0.0085)", () => {
    const mechanism: GuaranteeMechanism = { kind: "buyerSaleLaw", annualRateFraction: 0.85 };
    const result = validateGuaranteeMechanism(mechanism);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("אחוז"))).toBe(true);
  });

  it("kombinatsiaOwner עם durationMonths שלילי נדחה", () => {
    const mechanism: GuaranteeMechanism = { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: -12 };
    expect(validateGuaranteeMechanism(mechanism).valid).toBe(false);
  });

  it("kombinatsiaOwner עם durationMonths לא שלם נדחה", () => {
    const mechanism: GuaranteeMechanism = { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 36.5 };
    expect(validateGuaranteeMechanism(mechanism).valid).toBe(false);
  });

  it('unitCompensationOwner עם "requiresVerification" עובר בלי בדיקת שיעור', () => {
    const mechanism: GuaranteeMechanism = { kind: "unitCompensationOwner", annualRateFraction: "requiresVerification" };
    expect(validateGuaranteeMechanism(mechanism).valid).toBe(true);
  });
});

describe("validatePhases", () => {
  it("מערך שלבים תקין (חפיפה, למשל שיווק+בנייה) עובר", () => {
    expect(validatePhases(["construction", "marketing"]).valid).toBe(true);
  });

  it("דוחה מערך ריק", () => {
    expect(validatePhases([]).valid).toBe(false);
  });

  it("דוחה שלב לא מוכר", () => {
    // @ts-expect-error בודקים דחייה של ערך לא חוקי בזמן ריצה
    expect(validatePhases(["construction", "notAPhase"]).valid).toBe(false);
  });

  it("דוחה שלב כפול", () => {
    expect(validatePhases(["construction", "construction"]).valid).toBe(false);
  });
});
