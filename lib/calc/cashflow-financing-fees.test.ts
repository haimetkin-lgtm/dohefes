import { describe, expect, it } from "vitest";
import { computeFinancingFeeSchedule } from "./cashflow-financing-fees";
import type {
  DebtBalanceMonthInput,
  FinancingFeeScheduleInput,
  UnusedFacilityBalanceBasis,
} from "./cashflow-financing-fees";

function debtMonth(
  monthIndex: number,
  facilityLimitNis: number,
  openingDebtBalanceNis: number,
  closingDebtBalanceNis: number
): DebtBalanceMonthInput {
  return { monthIndex, facilityLimitNis, openingDebtBalanceNis, closingDebtBalanceNis };
}

const FOUR_MONTHS: DebtBalanceMonthInput[] = [
  debtMonth(0, 1_000_000, 0, 300_000),
  debtMonth(1, 1_000_000, 300_000, 500_000),
  debtMonth(2, 1_000_000, 500_000, 700_000),
  debtMonth(3, 1_000_000, 700_000, 600_000),
];

describe("עמלת פתיחה בסכום קבוע", () => {
  it("openingFeeExpenseNis = amountNis בחודש chargeMonthIndex, 0 בשאר החודשים", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      openingFee: { kind: "fixedAmount", amountNis: 15_000, chargeMonthIndex: 1 },
    });
    expect(result.months[1].openingFeeExpenseNis).toBe(15_000);
    expect(result.months[0].openingFeeExpenseNis).toBe(0);
    expect(result.months[2].openingFeeExpenseNis).toBe(0);
    expect(result.totalOpeningFeeExpenseNis).toBe(15_000);
  });
});

describe("עמלת פתיחה כאחוז מפורש מהמסגרת", () => {
  it("openingFeeExpenseNis = facilityBaseNis * fraction, לא נגזר בשקט ממסגרת אחרת", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      openingFee: { kind: "facilityFraction", fraction: 0.01, facilityBaseNis: 2_000_000, chargeMonthIndex: 0 },
    });
    // facilityBaseNis (2,000,000) שונה במכוון מ-facilityLimitNis של החודש (1,000,000) - מוכיח שאין גזירה שקטה
    expect(result.months[0].openingFeeExpenseNis).toBe(20_000);
    expect(result.totalOpeningFeeExpenseNis).toBe(20_000);
  });
});

describe("חודש חיוב נכון ו-off-by-one", () => {
  it("החיוב מדויק בחודש chargeMonthIndex בלבד - לא לפניו ולא אחריו", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      openingFee: { kind: "fixedAmount", amountNis: 10_000, chargeMonthIndex: 2 },
    });
    expect(result.months[1].openingFeeExpenseNis).toBe(0);
    expect(result.months[2].openingFeeExpenseNis).toBe(10_000);
    expect(result.months[3].openingFeeExpenseNis).toBe(0);
  });
});

function unusedCommission(basis: UnusedFacilityBalanceBasis) {
  return {
    annualRateFraction: 0.01,
    balanceBasis: basis,
    startMonthIndex: 0,
    endMonthIndexExclusive: 4,
  };
}

describe("עמלת אי-ניצול על בסיס פתיחה", () => {
  it("unusedFacilityBalanceBasisNis = max(0, facilityLimit - openingDebt)", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      unusedFacilityCommission: unusedCommission("openingAvailableFacility"),
    });
    // חודש 1: facilityLimit=1,000,000, openingDebt=300,000 -> זמין=700,000
    expect(result.months[1].unusedFacilityBalanceBasisNis).toBe(700_000);
    expect(result.months[1].unusedFacilityCommissionNis).toBeCloseTo(700_000 * 0.01 / 12, 6);
  });
});

describe("עמלת אי-ניצול על בסיס סגירה", () => {
  it("unusedFacilityBalanceBasisNis = max(0, facilityLimit - closingDebt)", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      unusedFacilityCommission: unusedCommission("closingAvailableFacility"),
    });
    // חודש 1: facilityLimit=1,000,000, closingDebt=500,000 -> זמין=500,000 (שונה מבסיס הפתיחה - 700,000)
    expect(result.months[1].unusedFacilityBalanceBasisNis).toBe(500_000);
    expect(result.months[1].unusedFacilityCommissionNis).toBeCloseTo(500_000 * 0.01 / 12, 6);
  });
});

describe("עמלת אי-ניצול על בסיס ממוצע פתיחה-סגירה", () => {
  it("unusedFacilityBalanceBasisNis = (opening+closing)/2", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      unusedFacilityCommission: unusedCommission("averageOpeningClosingAvailableFacility"),
    });
    // חודש 1: זמין-פתיחה=700,000, זמין-סגירה=500,000 -> ממוצע=600,000
    expect(result.months[1].unusedFacilityBalanceBasisNis).toBe(600_000);
    expect(result.months[1].unusedFacilityCommissionNis).toBeCloseTo(600_000 * 0.01 / 12, 6);
  });
});

describe("מסגרת מנוצלת במלואה -> עמלה אפס", () => {
  it("חוב = מסגרת בדיוק -> זמין=0 -> עמלה=0", () => {
    const months = [debtMonth(0, 1_000_000, 1_000_000, 1_000_000)];
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: months,
      unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "averageOpeningClosingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 1 },
    });
    expect(result.months[0].unusedFacilityBalanceBasisNis).toBe(0);
    expect(result.months[0].unusedFacilityCommissionNis).toBe(0);
  });
});

describe("חוב מעל המסגרת -> בסיס אפס (לא שלילי)", () => {
  it("חוב גדול מהמסגרת -> Math.max(0,...) מונע בסיס שלילי", () => {
    const months = [debtMonth(0, 1_000_000, 1_200_000, 1_300_000)];
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: months,
      unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "averageOpeningClosingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 1 },
    });
    expect(result.months[0].unusedFacilityBalanceBasisNis).toBe(0);
    expect(result.months[0].unusedFacilityCommissionNis).toBe(0);
  });
});

describe("עמלה פעילה רק בחלון שנקבע", () => {
  it("מחוץ ל-[startMonthIndex, endMonthIndexExclusive) -> בסיס ועמלה אפס", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "openingAvailableFacility", startMonthIndex: 1, endMonthIndexExclusive: 3 },
    });
    expect(result.months[0].unusedFacilityCommissionNis).toBe(0);
    expect(result.months[1].unusedFacilityCommissionNis).toBeGreaterThan(0);
    expect(result.months[2].unusedFacilityCommissionNis).toBeGreaterThan(0);
    expect(result.months[3].unusedFacilityCommissionNis).toBe(0);
  });
});

describe("שיעורים שגויים נדחים", () => {
  it("annualRateFraction=0.85 לעמלת אי-ניצול נדחה (הדוגמה המפורשת מהמפרט)", () => {
    expect(() =>
      computeFinancingFeeSchedule({
        monthlyDebtBalances: FOUR_MONTHS,
        unusedFacilityCommission: { annualRateFraction: 0.85, balanceBasis: "openingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 4 },
      })
    ).toThrow();
  });
  it("annualRateFraction שלילי נדחה", () => {
    expect(() =>
      computeFinancingFeeSchedule({
        monthlyDebtBalances: FOUR_MONTHS,
        unusedFacilityCommission: { annualRateFraction: -0.01, balanceBasis: "openingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 4 },
      })
    ).toThrow();
  });
  it("annualRateFraction לא סופי נדחה", () => {
    expect(() =>
      computeFinancingFeeSchedule({
        monthlyDebtBalances: FOUR_MONTHS,
        unusedFacilityCommission: { annualRateFraction: NaN, balanceBasis: "openingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 4 },
      })
    ).toThrow();
  });
  it("openingFee.fraction גבוה מדי (טעות אחוז-במקום-שבר) נדחה", () => {
    expect(() =>
      computeFinancingFeeSchedule({
        monthlyDebtBalances: FOUR_MONTHS,
        openingFee: { kind: "facilityFraction", fraction: 1, facilityBaseNis: 1_000_000, chargeMonthIndex: 0 },
      })
    ).toThrow();
  });
  it("endMonthIndexExclusive <= startMonthIndex נדחה", () => {
    expect(() =>
      computeFinancingFeeSchedule({
        monthlyDebtBalances: FOUR_MONTHS,
        unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "openingAvailableFacility", startMonthIndex: 2, endMonthIndexExclusive: 2 },
      })
    ).toThrow();
  });
  it("chargeMonthIndex מחוץ לציר נדחה", () => {
    expect(() =>
      computeFinancingFeeSchedule({
        monthlyDebtBalances: FOUR_MONTHS,
        openingFee: { kind: "fixedAmount", amountNis: 1_000, chargeMonthIndex: 99 },
      })
    ).toThrow();
  });
});

describe("ולידציית ציר וחוב", () => {
  it("חודשים לא רציפים נדחים", () => {
    expect(() =>
      computeFinancingFeeSchedule({ monthlyDebtBalances: [debtMonth(0, 1_000_000, 0, 0), debtMonth(2, 1_000_000, 0, 0)] })
    ).toThrow();
  });
  it("יתרת חוב פתיחה שלילית נדחית", () => {
    expect(() => computeFinancingFeeSchedule({ monthlyDebtBalances: [debtMonth(0, 1_000_000, -1, 0)] })).toThrow();
  });
  it("יתרת חוב סגירה שלילית נדחית", () => {
    expect(() => computeFinancingFeeSchedule({ monthlyDebtBalances: [debtMonth(0, 1_000_000, 0, -1)] })).toThrow();
  });
  it("facilityLimitNis שלילי נדחה", () => {
    expect(() => computeFinancingFeeSchedule({ monthlyDebtBalances: [debtMonth(0, -1, 0, 0)] })).toThrow();
  });
});

describe("סכומי החודשים מתאימים לסיכום", () => {
  it("total*Nis = סכום השדות המקבילים על פני כל החודשים", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      openingFee: { kind: "fixedAmount", amountNis: 12_000, chargeMonthIndex: 0 },
      unusedFacilityCommission: unusedCommission("averageOpeningClosingAvailableFacility"),
    });
    const sumOpening = result.months.reduce((acc, m) => acc + m.openingFeeExpenseNis, 0);
    const sumUnused = result.months.reduce((acc, m) => acc + m.unusedFacilityCommissionNis, 0);
    const sumTotal = result.months.reduce((acc, m) => acc + m.totalFinancingFeeExpenseNis, 0);
    expect(result.totalOpeningFeeExpenseNis).toBeCloseTo(sumOpening, 6);
    expect(result.totalUnusedFacilityCommissionNis).toBeCloseTo(sumUnused, 6);
    expect(result.totalFinancingFeeExpenseNis).toBeCloseTo(sumTotal, 6);
    expect(result.totalFinancingFeeExpenseNis).toBeCloseTo(result.totalOpeningFeeExpenseNis + result.totalUnusedFacilityCommissionNis, 6);
    for (const m of result.months) {
      expect(m.totalFinancingFeeExpenseNis).toBeCloseTo(m.openingFeeExpenseNis + m.unusedFacilityCommissionNis, 6);
    }
  });
});

describe("requiresCashFlowRecalculation נכון", () => {
  it("false כשאין עמלות כלל", () => {
    const result = computeFinancingFeeSchedule({ monthlyDebtBalances: FOUR_MONTHS });
    expect(result.requiresCashFlowRecalculation).toBe(false);
  });
  it("true כשיש עמלת פתיחה בלבד", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      openingFee: { kind: "fixedAmount", amountNis: 5_000, chargeMonthIndex: 0 },
    });
    expect(result.requiresCashFlowRecalculation).toBe(true);
  });
  it("true כשיש עמלת אי-ניצול בלבד (בכל אחד משלושת הבסיסים)", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      unusedFacilityCommission: unusedCommission("closingAvailableFacility"),
    });
    expect(result.requiresCashFlowRecalculation).toBe(true);
  });
  it("false כשעמלת פתיחה קיימת אך מסתכמת ל-0 (amountNis=0)", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      openingFee: { kind: "fixedAmount", amountNis: 0, chargeMonthIndex: 0 },
    });
    expect(result.requiresCashFlowRecalculation).toBe(false);
  });
});

describe("אין מוטציה ואין NaN/Infinity", () => {
  it("אין NaN/Infinity בתרחיש מלא (שתי העמלות יחד)", () => {
    const result = computeFinancingFeeSchedule({
      monthlyDebtBalances: FOUR_MONTHS,
      openingFee: { kind: "facilityFraction", fraction: 0.005, facilityBaseNis: 1_500_000, chargeMonthIndex: 0 },
      unusedFacilityCommission: unusedCommission("averageOpeningClosingAvailableFacility"),
    });
    for (const m of result.months) {
      for (const value of Object.values(m)) {
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(Number.isFinite(result.totalFinancingFeeExpenseNis)).toBe(true);
  });

  it("אין מוטציה של הקלט", () => {
    const input: FinancingFeeScheduleInput = {
      monthlyDebtBalances: FOUR_MONTHS.map((m) => ({ ...m })),
      openingFee: { kind: "fixedAmount", amountNis: 5_000, chargeMonthIndex: 0 },
      unusedFacilityCommission: unusedCommission("openingAvailableFacility"),
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    computeFinancingFeeSchedule(input);

    expect(input).toEqual(snapshot);
  });
});
