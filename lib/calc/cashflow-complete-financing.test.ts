import { describe, expect, it } from "vitest";
import { computeCompleteFinancing } from "./cashflow-complete-financing";
import type { CompleteFinancingInput, FinancingFeeAssumptions } from "./cashflow-complete-financing";
import { computeFinancedCashFlow } from "./cashflow-financed-engine";
import type { OperatingMonthInput } from "./cashflow-financed-engine";
import { computeFinancingFeeSchedule } from "./cashflow-financing-fees";
import type { UnusedFacilityBalanceBasis } from "./cashflow-financing-fees";
import { computeGuaranteeSchedule } from "./cashflow-guarantees";
import type { GuaranteeScheduleResult } from "./cashflow-guarantees";
import type { InterestCashFlowAssumptions } from "./cashflow-interest-engine";

const MONTH_INDICES = [0, 1, 2, 3, 4, 5];

function operatingMonth(monthIndex: number, operatingInflowsNis: number, operatingOutflowsNis: number): OperatingMonthInput {
  return { monthIndex, operatingInflowsNis, operatingOutflowsNis, phases: ["construction"] };
}

function zeroGuaranteeSchedule(): GuaranteeScheduleResult {
  return computeGuaranteeSchedule({ monthIndices: MONTH_INDICES, instances: [] });
}

const BASE_ASSUMPTIONS: InterestCashFlowAssumptions = {
  equityCapNis: 0,
  minimumCashBalanceNis: 0,
  creditFacilityLimitNis: 2_000_000,
  annualInterestRate: 0.06,
};

const OPERATING_MONTHS: OperatingMonthInput[] = [
  operatingMonth(0, 0, 400_000),
  operatingMonth(1, 100_000, 150_000),
  operatingMonth(2, 400_000, 50_000),
  operatingMonth(3, 0, 0),
  operatingMonth(4, 300_000, 10_000),
  operatingMonth(5, 500_000, 0),
];

describe("אין עמלות -> התאמה מלאה ל-computeFinancedCashFlow (6c)", () => {
  it("months וסיכום זהים, מתכנס באיטרציה הראשונה", () => {
    const guaranteeSchedule = zeroGuaranteeSchedule();
    const financingFeeAssumptions: FinancingFeeAssumptions = {};

    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule,
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions,
    });
    const direct = computeFinancedCashFlow({ operatingMonths: OPERATING_MONTHS, guaranteeSchedule, interestAssumptions: BASE_ASSUMPTIONS });

    expect(complete.isConverged).toBe(true);
    expect(complete.iterationsUsed).toBe(1);
    complete.months.forEach((m, i) => {
      const d = direct.months[i];
      expect(m.equityInjectionNis).toBeCloseTo(d.equityInjectionNis, 6);
      expect(m.creditDrawNis).toBeCloseTo(d.creditDrawNis, 6);
      expect(m.interestExpenseNis).toBeCloseTo(d.interestExpenseNis, 6);
      expect(m.closingCashBalanceNis).toBeCloseTo(d.closingCashBalanceNis, 6);
      expect(m.closingDebtBalanceNis).toBeCloseTo(d.closingDebtBalanceNis, 6);
      expect(m.totalFinancingFeeExpenseNis).toBe(0);
    });
    expect(complete.totalInterestExpenseNis).toBeCloseTo(direct.totalInterestExpenseNis, 6);
    expect(complete.totalFinancingFeeExpenseNis).toBe(0);
  });
});

describe("עמלת פתיחה מגדילה הוצאות מזומן, אשראי וריבית", () => {
  it("עם עמלת פתיחה קבועה: outflows/draw/interest גבוהים יותר מבלי עמלה", () => {
    const guaranteeSchedule = zeroGuaranteeSchedule();

    const without = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule,
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: {},
    });
    const withFee = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule,
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: { openingFee: { kind: "fixedAmount", amountNis: 20_000, chargeMonthIndex: 0 } },
    });

    expect(withFee.months[0].totalCashOutflowsNis).toBeGreaterThan(without.months[0].totalCashOutflowsNis);
    expect(withFee.months[0].creditDrawNis).toBeGreaterThan(without.months[0].creditDrawNis);
    expect(withFee.totalInterestExpenseNis).toBeGreaterThan(without.totalInterestExpenseNis);
    expect(withFee.isConverged).toBe(true);
    // עמלה קבועה, בלתי-תלויה בחוב, עדיין דורשת כמה איטרציות כדי שגם החוב יתייצב (ר' תיעוד הפונקציה)
    expect(withFee.iterationsUsed).toBeGreaterThanOrEqual(2);
    expect(withFee.iterationsUsed).toBeLessThan(10);
  });
});

describe("עמלת אי-ניצול מחושבת מחדש לאחר שינוי החוב", () => {
  it("הערכה נאיבית חד-פעמית (בלי לולאה) שונה מהתוצאה המתכנסת בפועל", () => {
    const guaranteeSchedule = zeroGuaranteeSchedule();
    const financingFeeAssumptions: FinancingFeeAssumptions = {
      unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "closingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
    };

    // הערכה נאיבית: מריצים פעם אחת בלי עמלה, ומחשבים עמלה על התוצאה הזו בלי להזין אותה חזרה
    const naiveFinanced = computeFinancedCashFlow({ operatingMonths: OPERATING_MONTHS, guaranteeSchedule, interestAssumptions: BASE_ASSUMPTIONS });
    let openingDebt = 0;
    const naiveBalances = naiveFinanced.months.map((m) => {
      const row = { monthIndex: m.monthIndex, facilityLimitNis: BASE_ASSUMPTIONS.creditFacilityLimitNis, openingDebtBalanceNis: openingDebt, closingDebtBalanceNis: m.closingDebtBalanceNis };
      openingDebt = m.closingDebtBalanceNis;
      return row;
    });
    const naiveFee = computeFinancingFeeSchedule({ monthlyDebtBalances: naiveBalances, unusedFacilityCommission: financingFeeAssumptions.unusedFacilityCommission });

    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule,
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions,
    });

    expect(complete.isConverged).toBe(true);
    // התוצאה המתכנסת שונה מההערכה הנאיבית (שלא הוזנה בחזרה לתזרים) - מוכיח שהתרחשה הרצה חוזרת אמיתית
    expect(complete.totalUnusedFacilityCommissionNis).not.toBeCloseTo(naiveFee.totalUnusedFacilityCommissionNis, 2);
  });
});

describe("שלושת בסיסי עמלת אי-הניצול מתכנסים", () => {
  const bases: UnusedFacilityBalanceBasis[] = ["openingAvailableFacility", "closingAvailableFacility", "averageOpeningClosingAvailableFacility"];

  for (const basis of bases) {
    it(`בסיס ${basis} מתכנס בתוך פחות מ-60 איטרציות`, () => {
      const complete = computeCompleteFinancing({
        operatingMonths: OPERATING_MONTHS,
        guaranteeSchedule: zeroGuaranteeSchedule(),
        interestAssumptions: BASE_ASSUMPTIONS,
        financingFeeAssumptions: {
          unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: basis, startMonthIndex: 0, endMonthIndexExclusive: 6 },
        },
      });
      expect(complete.isConverged).toBe(true);
      expect(complete.iterationsUsed).toBeLessThan(60);
      expect(complete.maxFeeDifferenceNis).toBeLessThanOrEqual(0.01);
      expect(complete.maxDebtDifferenceNis).toBeLessThanOrEqual(0.01);
    });
  }
});

describe("בכל איטרציה העמלה מוחלפת ולא נספרת שוב", () => {
  it("totalUnusedFacilityCommissionNis הסופי תואם לחישוב טרי על יתרות החוב הסופיות שדווחו", () => {
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule: zeroGuaranteeSchedule(),
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: {
        unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "averageOpeningClosingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
      },
    });

    let openingDebt = 0;
    const finalBalances = complete.months.map((m) => {
      const row = { monthIndex: m.monthIndex, facilityLimitNis: BASE_ASSUMPTIONS.creditFacilityLimitNis, openingDebtBalanceNis: openingDebt, closingDebtBalanceNis: m.closingDebtBalanceNis };
      openingDebt = m.closingDebtBalanceNis;
      return row;
    });
    const freshFee = computeFinancingFeeSchedule({
      monthlyDebtBalances: finalBalances,
      unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "averageOpeningClosingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
    });

    // אם העמלה הייתה "נצברת" (מתווספת) איטרציה אחר איטרציה, זה לא היה תואם לחישוב טרי יחיד על היתרות הסופיות
    expect(complete.totalUnusedFacilityCommissionNis).toBeCloseTo(freshFee.totalUnusedFacilityCommissionNis, 2);
  });
});

describe("תוצאה סופית אינה מסומנת requiresCashFlowRecalculation", () => {
  it("השדה לא קיים בכלל בטיפוס/באובייקט המוחזר", () => {
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule: zeroGuaranteeSchedule(),
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: { openingFee: { kind: "fixedAmount", amountNis: 5_000, chargeMonthIndex: 0 } },
    });
    expect("requiresCashFlowRecalculation" in complete).toBe(false);
  });
});

describe("הגבלת 60 איטרציות וברירת המחדל", () => {
  it("בתרחיש רגיל, מתכנס משמעותית לפני 60 איטרציות בלי לציין maxIterations", () => {
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule: zeroGuaranteeSchedule(),
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: {
        unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "closingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
      },
    });
    expect(complete.isConverged).toBe(true);
    expect(complete.iterationsUsed).toBeLessThan(60);
  });

  it("maxIterations לא תקין (לא שלם/שלילי) נדחה", () => {
    expect(() =>
      computeCompleteFinancing({
        operatingMonths: OPERATING_MONTHS,
        guaranteeSchedule: zeroGuaranteeSchedule(),
        interestAssumptions: BASE_ASSUMPTIONS,
        financingFeeAssumptions: {},
        maxIterations: 0,
      })
    ).toThrow();
    expect(() =>
      computeCompleteFinancing({
        operatingMonths: OPERATING_MONTHS,
        guaranteeSchedule: zeroGuaranteeSchedule(),
        interestAssumptions: BASE_ASSUMPTIONS,
        financingFeeAssumptions: {},
        maxIterations: 2.5,
      })
    ).toThrow();
  });
});

describe("תרחיש מכוון שאינו מתכנס (maxIterations לבדיקה בלבד) -> isConverged:false", () => {
  it("maxIterations=1 עם בסיס תלוי-סגירה שדורש מספר איטרציות אמיתי -> isConverged=false, אזהרה קיימת", () => {
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule: zeroGuaranteeSchedule(),
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: {
        unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "closingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
      },
      maxIterations: 1,
    });
    expect(complete.isConverged).toBe(false);
    expect(complete.iterationsUsed).toBe(1);
    expect(complete.warnings.length).toBeGreaterThan(0);
    expect(complete.warnings[0]).toContain("לא הושגה התכנסות");
  });
});

describe("התאמות מזומן וחוב מתקיימות בתוצאה הסופית (דיוק floating-point רגיל, לא סבילות התכנסות)", () => {
  it("closingCash/closingDebt לפי הנוסחאות המלאות (כולל totalFinancingFeeExpenseNis), opening נגזר מהחודש הקודם", () => {
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule: zeroGuaranteeSchedule(),
      interestAssumptions: { ...BASE_ASSUMPTIONS, equityCapNis: 200_000, minimumCashBalanceNis: 10_000, creditFacilityLimitNis: 300_000 },
      financingFeeAssumptions: {
        openingFee: { kind: "fixedAmount", amountNis: 8_000, chargeMonthIndex: 0 },
        unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "averageOpeningClosingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
      },
    });

    // commit 6f: כל השדות המוחזרים מגיעים מאותה איטרציה קוהרנטית (financed + appliedFeeSchedule
    // שהזין אותו) - הנוסחאות מתקיימות עד דיוק floating-point רגיל, לא רק בגבול MONEY_EPSILON_NIS.
    let openingCash = 0;
    let openingDebt = 0;
    for (const m of complete.months) {
      const expectedClosingCash =
        openingCash + m.operatingInflowsNis + m.equityInjectionNis + m.creditDrawNis - m.operatingOutflowsNis - m.guaranteeExpenseNis - m.totalFinancingFeeExpenseNis - m.creditRepaymentNis;
      expect(m.closingCashBalanceNis).toBeCloseTo(expectedClosingCash, 8);

      const expectedClosingDebt = openingDebt + m.creditDrawNis + m.interestExpenseNis - m.creditRepaymentNis;
      expect(m.closingDebtBalanceNis).toBeCloseTo(expectedClosingDebt, 8);

      openingCash = m.closingCashBalanceNis;
      openingDebt = m.closingDebtBalanceNis;
    }
  });
});

/**
 * הוכחת קוהרנטיות כללית: אם מזינים מחדש את totalFinancingFeeExpenseNis המדווח (per-month) ישירות
 * ל-computeFinancedCashFlow, מקבלים בדיוק (לא בסבילות) את אותם שדות תזרים כמו ב-`complete.months` -
 * מוכיח ש-`financed` המוחזר אכן הופק ע"י `appliedFeeSchedule` המדווח, לא ע"י לוח אחר ("ערבוב איטרציות").
 */
function assertCoherentWithReappliedFee(
  complete: ReturnType<typeof computeCompleteFinancing>,
  guaranteeSchedule: GuaranteeScheduleResult,
  interestAssumptions: InterestCashFlowAssumptions
) {
  const reappliedOperatingMonths: OperatingMonthInput[] = complete.months.map((m) => ({
    monthIndex: m.monthIndex,
    operatingInflowsNis: m.operatingInflowsNis,
    operatingOutflowsNis: m.operatingOutflowsNis + m.totalFinancingFeeExpenseNis,
    phases: ["construction"],
  }));
  const reapplied = computeFinancedCashFlow({ operatingMonths: reappliedOperatingMonths, guaranteeSchedule, interestAssumptions });

  complete.months.forEach((m, i) => {
    const r = reapplied.months[i];
    expect(m.equityInjectionNis).toBeCloseTo(r.equityInjectionNis, 8);
    expect(m.creditDrawNis).toBeCloseTo(r.creditDrawNis, 8);
    expect(m.creditRepaymentNis).toBeCloseTo(r.creditRepaymentNis, 8);
    expect(m.interestExpenseNis).toBeCloseTo(r.interestExpenseNis, 8);
    expect(m.closingCashBalanceNis).toBeCloseTo(r.closingCashBalanceNis, 8);
    expect(m.closingDebtBalanceNis).toBeCloseTo(r.closingDebtBalanceNis, 8);
    expect(m.fundingDeficitBalanceNis).toBeCloseTo(r.fundingDeficitBalanceNis, 8);
    expect(m.facilityBreachNis).toBeCloseTo(r.facilityBreachNis, 8);
  });
}

describe("עמלה קבועה: העמלה המוצגת היא בדיוק זו שהוזנה לתזרים הסופי", () => {
  it("הזנה חוזרת של totalFinancingFeeExpenseNis המדווח משחזרת בדיוק את שדות התזרים המדווחים", () => {
    const guaranteeSchedule = zeroGuaranteeSchedule();
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule,
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: { openingFee: { kind: "fixedAmount", amountNis: 20_000, chargeMonthIndex: 0 } },
    });
    expect(complete.isConverged).toBe(true);
    assertCoherentWithReappliedFee(complete, guaranteeSchedule, BASE_ASSUMPTIONS);
  });
});

describe("עמלת אי-ניצול: יתרות החוב, בסיס העמלה והעמלה המוחלת שייכים לאותו מעבר", () => {
  it("שלושת הבסיסים - הזנה חוזרת משחזרת בדיוק את שדות התזרים המדווחים", () => {
    const guaranteeSchedule = zeroGuaranteeSchedule();
    const bases: UnusedFacilityBalanceBasis[] = ["openingAvailableFacility", "closingAvailableFacility", "averageOpeningClosingAvailableFacility"];
    for (const basis of bases) {
      const complete = computeCompleteFinancing({
        operatingMonths: OPERATING_MONTHS,
        guaranteeSchedule,
        interestAssumptions: BASE_ASSUMPTIONS,
        financingFeeAssumptions: {
          unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: basis, startMonthIndex: 0, endMonthIndexExclusive: 6 },
        },
      });
      expect(complete.isConverged).toBe(true);
      assertCoherentWithReappliedFee(complete, guaranteeSchedule, BASE_ASSUMPTIONS);
    }
  });
});

describe("מקרה עמלה קטנה מהסף (fixed-point residual)", () => {
  it("עמלה חיובית וזעירה (<0.01) שמחושבת באיטרציה הראשונה לא מוחלת בשקט ולא נעלמת בשקט", () => {
    const guaranteeSchedule = zeroGuaranteeSchedule();
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule,
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: { openingFee: { kind: "fixedAmount", amountNis: 0.005, chargeMonthIndex: 0 } },
    });

    expect(complete.isConverged).toBe(true);
    expect(complete.iterationsUsed).toBe(1); // מתכנס מיד: 0.005 קטן מהסף מול appliedFeeSchedule=0

    // לא "מחילה בשקט": שדות התזרים חייבים לשקף בדיוק את מה שהוחל (0), לא את מה שחושב-מחדש (0.005)
    expect(complete.months[0].openingFeeExpenseNis).toBe(0);
    expect(complete.months[0].totalFinancingFeeExpenseNis).toBe(0);
    expect(complete.totalOpeningFeeExpenseNis).toBe(0);

    // לא "נעלמת בשקט": השארית עדיין גלויה בשדה ייעודי, לא מוסתרת לגמרי
    expect(complete.fixedPointResidualFeeNis).toBeCloseTo(0.005, 6);
    expect(complete.fixedPointResidualFeeNis).toBeGreaterThan(0);

    // ועדיין קוהרנטי: financed המוחזר תואם בדיוק להזנה חוזרת של מה שבאמת הוחל (0)
    assertCoherentWithReappliedFee(complete, guaranteeSchedule, BASE_ASSUMPTIONS);
  });
});

describe("אי-התכנסות מחזירה את האיטרציה האחרונה הקוהרנטית, לא שילוב של שתי איטרציות", () => {
  it("גם ב-isConverged=false, הזנה חוזרת של הלוח המדווח משחזרת בדיוק את שדות התזרים המדווחים", () => {
    const guaranteeSchedule = zeroGuaranteeSchedule();
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule,
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: {
        unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "closingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
      },
      maxIterations: 1,
    });
    expect(complete.isConverged).toBe(false);
    assertCoherentWithReappliedFee(complete, guaranteeSchedule, BASE_ASSUMPTIONS);
  });
});

describe("סיכומי העמלות שווים לפירוט שהוחל בפועל", () => {
  it("total*Nis = סכום השדות המקבילים על פני כל החודשים, עד דיוק floating-point רגיל", () => {
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule: zeroGuaranteeSchedule(),
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: {
        openingFee: { kind: "fixedAmount", amountNis: 12_000, chargeMonthIndex: 0 },
        unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "averageOpeningClosingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
      },
    });
    const sumOpening = complete.months.reduce((acc, m) => acc + m.openingFeeExpenseNis, 0);
    const sumUnused = complete.months.reduce((acc, m) => acc + m.unusedFacilityCommissionNis, 0);
    const sumTotal = complete.months.reduce((acc, m) => acc + m.totalFinancingFeeExpenseNis, 0);
    expect(complete.totalOpeningFeeExpenseNis).toBeCloseTo(sumOpening, 8);
    expect(complete.totalUnusedFacilityCommissionNis).toBeCloseTo(sumUnused, 8);
    expect(complete.totalFinancingFeeExpenseNis).toBeCloseTo(sumTotal, 8);
  });
});

describe("סך כל רכיבי ההוצאה שווה ל-totalCashOutflowsNis", () => {
  it("totalCashOutflowsNis = operatingOutflowsNis + guaranteeExpenseNis + totalFinancingFeeExpenseNis בכל חודש", () => {
    const guaranteeSchedule = computeGuaranteeSchedule({
      monthIndices: MONTH_INDICES,
      instances: [
        {
          kind: "buyerSaleLaw",
          mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 },
          monthlyEligibleBuyerReceiptsNis: [100_000, 100_000, 100_000, 0, 0, 0],
          releaseMonthIndex: 6,
        },
      ],
    });
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule,
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: {
        openingFee: { kind: "fixedAmount", amountNis: 5_000, chargeMonthIndex: 1 },
        unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "openingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
      },
    });
    for (const m of complete.months) {
      expect(m.totalCashOutflowsNis).toBeCloseTo(m.operatingOutflowsNis + m.guaranteeExpenseNis + m.totalFinancingFeeExpenseNis, 6);
      expect(m.totalFinancingFeeExpenseNis).toBeCloseTo(m.openingFeeExpenseNis + m.unusedFacilityCommissionNis, 6);
    }
  });
});

describe("אין מוטציה ואין ערכים לא-סופיים", () => {
  it("אין NaN/Infinity בתרחיש מלא (ערבויות + שתי עמלות המימון)", () => {
    const guaranteeSchedule = computeGuaranteeSchedule({
      monthIndices: MONTH_INDICES,
      instances: [
        {
          kind: "kombinatsiaOwner",
          mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 4 },
          ownerUnitsMarketValueNis: 500_000,
          startMonthIndex: 0,
        },
      ],
    });
    const complete = computeCompleteFinancing({
      operatingMonths: OPERATING_MONTHS,
      guaranteeSchedule,
      interestAssumptions: BASE_ASSUMPTIONS,
      financingFeeAssumptions: {
        openingFee: { kind: "facilityFraction", fraction: 0.005, facilityBaseNis: 2_000_000, chargeMonthIndex: 0 },
        unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "averageOpeningClosingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
      },
    });
    for (const m of complete.months) {
      for (const value of Object.values(m)) {
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(Number.isFinite(complete.totalFinancingFeeExpenseNis)).toBe(true);
    expect(Number.isFinite(complete.maxFeeDifferenceNis)).toBe(true);
    expect(Number.isFinite(complete.maxDebtDifferenceNis)).toBe(true);
  });

  it("אין מוטציה של הקלט", () => {
    const guaranteeSchedule = zeroGuaranteeSchedule();
    const input: CompleteFinancingInput = {
      operatingMonths: OPERATING_MONTHS.map((m) => ({ ...m })),
      guaranteeSchedule,
      interestAssumptions: { ...BASE_ASSUMPTIONS },
      financingFeeAssumptions: {
        openingFee: { kind: "fixedAmount", amountNis: 5_000, chargeMonthIndex: 0 },
        unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "closingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 6 },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    computeCompleteFinancing(input);

    expect(input).toEqual(snapshot);
  });
});
