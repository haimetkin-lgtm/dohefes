import { describe, expect, it } from "vitest";
import { computeCashFlow } from "./cashflow-engine";
import type { CashFlowGuaranteeInput, CashFlowInput } from "./cashflow-engine";
import { computeCostSchedule } from "./cashflow-cost-schedule";
import type { CostScheduleResult } from "./cashflow-cost-schedule";
import type { PaymentTranche, SalesScheduleAssumptions } from "./cashflow-types";
import type { InterestCashFlowAssumptions } from "./cashflow-interest-engine";
import type { SalesUnitRowInput } from "./cashflow-operating-schedule";

const MONTH_INDICES = Array.from({ length: 9 }, (_, i) => i); // 0..8
const HANDOVER = 8;
const CONSTRUCTION_START = 2;
const MARKETING_START = 0;

const PHASES = Object.fromEntries(MONTH_INDICES.map((m) => [m, ["construction"] as const]));

const RESIDENTIAL_HANDOVER: PaymentTranche = { fraction: 1, timing: { kind: "handover" }, label: "מסירה" };
const SALES_SCHEDULE: SalesScheduleAssumptions = {
  model: "explicitSchedule",
  byCategory: { residential: [RESIDENTIAL_HANDOVER] },
  saleMonthByCategory: {},
};

function rowA(): SalesUnitRowInput {
  return {
    unitRowId: "row-a",
    unit: { count: 10, priceNis: 1_500_000, category: "residential" },
    batches: [{ unitsCount: 10, saleMonth: 1 }],
    isBuyerSaleLawEligible: true,
  };
}
function rowB(): SalesUnitRowInput {
  return {
    unitRowId: "row-b",
    unit: { count: 5, priceNis: 2_000_000, category: "residential" },
    batches: [{ unitsCount: 5, saleMonth: 3 }],
    isBuyerSaleLawEligible: false,
  };
}

function smallCostSchedule(): CostScheduleResult {
  return computeCostSchedule({
    monthIndices: MONTH_INDICES,
    costAmountsByItemId: { landPurchase: 500_000, demolition: 300_000 },
    timingRulesByItemId: { landPurchase: { rule: "landPurchaseMonth" }, demolition: { rule: "constructionStart" } },
    constructionCurve: [1],
    anchors: { landPurchaseMonthIndex: 0, constructionStartMonthIndex: CONSTRUCTION_START },
  });
}

const BASE_INTEREST_ASSUMPTIONS: InterestCashFlowAssumptions = {
  equityCapNis: 0,
  minimumCashBalanceNis: 0,
  creditFacilityLimitNis: 2_000_000,
  annualInterestRate: 0.06,
};

function baseInput(overrides: Partial<CashFlowInput> = {}): CashFlowInput {
  return {
    monthIndices: MONTH_INDICES,
    phasesByMonthIndex: PHASES,
    salesUnitRows: [rowA(), rowB()],
    salesScheduleAssumptions: SALES_SCHEDULE,
    marketingStartMonthIndex: MARKETING_START,
    constructionStartMonthIndex: CONSTRUCTION_START,
    handoverMonthIndex: HANDOVER,
    costSchedule: smallCostSchedule(),
    guarantees: [],
    interestAssumptions: BASE_INTEREST_ASSUMPTIONS,
    financingFeeAssumptions: {},
    ...overrides,
  };
}

describe("פרויקט פשוט ללא ערבויות או עמלות", () => {
  it("status=complete, מתכנס", () => {
    const result = computeCashFlow(baseInput());
    expect(result.status).toBe("complete");
    expect(result.isComplete).toBe(true);
    if (result.status === "complete") {
      expect(result.summary.totalGuaranteeExpenseNis).toBe(0);
      expect(result.summary.totalFinancingFeeExpenseNis).toBe(0);
    }
  });
});

describe("פרויקט עם מכירות, עלויות, ערבות רוכשים, עמלת פתיחה ועמלת אי-ניצול", () => {
  it("status=complete, כל הרכיבים פעילים", () => {
    const guarantees: CashFlowGuaranteeInput[] = [
      { kind: "buyerSaleLaw", mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 }, releaseMonthIndex: 9 },
    ];
    const result = computeCashFlow(
      baseInput({
        guarantees,
        financingFeeAssumptions: {
          openingFee: { kind: "fixedAmount", amountNis: 5_000, chargeMonthIndex: 0 },
          unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "averageOpeningClosingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 9 },
        },
      })
    );
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.summary.totalGuaranteeExpenseNis).toBeGreaterThan(0);
      expect(result.summary.totalOpeningFeeExpenseNis).toBe(5_000);
      expect(result.summary.totalUnusedFacilityCommissionNis).toBeGreaterThan(0);
    }
  });
});

describe("תקבולי הערבות זהים בדיוק ל-eligibleBuyerReceiptsNis", () => {
  it("תוספת היתרה החודשית של buyerSaleLaw = eligibleBuyerReceiptsNis של אותו חודש", () => {
    const guarantees: CashFlowGuaranteeInput[] = [
      { kind: "buyerSaleLaw", mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 }, releaseMonthIndex: 9 },
    ];
    const result = computeCashFlow(baseInput({ guarantees }));
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;

    let previousBalance = 0;
    for (const m of result.operatingSchedule.months) {
      const guaranteeMonth = result.guaranteeSchedule.months.find((g) => g.monthIndex === m.monthIndex)!;
      const increment = guaranteeMonth.buyerGuaranteeBalanceNis - previousBalance;
      expect(increment).toBeCloseTo(m.eligibleBuyerReceiptsNis, 6);
      previousBalance = guaranteeMonth.buyerGuaranteeBalanceNis;
    }
  });
});

describe("שורה שאינה זכאית לערבות אינה נכנסת לבסיס", () => {
  it("row-b (לא זכאית) לא משפיעה על יתרת ערבות הרוכשים בחודש המסירה", () => {
    const guarantees: CashFlowGuaranteeInput[] = [
      { kind: "buyerSaleLaw", mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 }, releaseMonthIndex: 9 },
    ];
    const result = computeCashFlow(baseInput({ guarantees }));
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;

    const beforeHandoverGuarantee = result.guaranteeSchedule.months.find((g) => g.monthIndex === HANDOVER - 1)!;
    const handoverGuarantee = result.guaranteeSchedule.months.find((g) => g.monthIndex === HANDOVER)!;
    const handoverOperating = result.operatingSchedule.months.find((m) => m.monthIndex === HANDOVER)!;
    // row-a (זכאית) + row-b (לא זכאית) שתיהן ב-handover, אבל רק row-a (15,000,000) נכנסת לבסיס
    expect(handoverOperating.totalOperatingInflowsNis).toBe(25_000_000); // row-a + row-b
    expect(handoverOperating.eligibleBuyerReceiptsNis).toBe(15_000_000); // row-a בלבד
    // שתי השורות משלמות 100% ב-handover (אין תקבול מוקדם יותר) - היתרה לפני המסירה חייבת להיות 0,
    // ובחודש המסירה עצמו בדיוק 15,000,000 (row-a בלבד), לא 25,000,000 (לא row-a+row-b)
    expect(beforeHandoverGuarantee.buyerGuaranteeBalanceNis).toBe(0);
    expect(handoverGuarantee.buyerGuaranteeBalanceNis).toBe(15_000_000);
  });
});

describe("קומבינציה וערבות יחידות תמורה יחד", () => {
  it("שני מנגנונים נפרדים פעילים בו-זמנית, כל אחד בשדה שלו", () => {
    const guarantees: CashFlowGuaranteeInput[] = [
      { kind: "kombinatsiaOwner", mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 6 }, ownerUnitsMarketValueNis: 1_000_000, startMonthIndex: 0 },
      { kind: "unitCompensationOwner", mechanism: { kind: "unitCompensationOwner", annualRateFraction: 0.0085 }, compensationUnitValueNis: 800_000, startMonthIndex: 0, releaseMonthIndex: 5, ownerId: "דייר-1" },
    ];
    const result = computeCashFlow(baseInput({ guarantees }));
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    const m0 = result.guaranteeSchedule.months[0];
    expect(m0.ownerGuaranteeBalanceNis).toBe(1_000_000);
    expect(m0.unitCompensationGuaranteeBalanceNis).toBe(800_000);
    expect(m0.buyerGuaranteeBalanceNis).toBe(0);
  });
});

describe("קבוצת רכישה - מערך ערבויות ריק ומימון אפס, בלי special-case לפי שם", () => {
  it("guarantees=[] + creditFacilityLimitNis=0, עם הון עצמי מספיק - status=complete", () => {
    const result = computeCashFlow(
      baseInput({
        guarantees: [],
        interestAssumptions: { equityCapNis: 10_000_000, minimumCashBalanceNis: 0, creditFacilityLimitNis: 0, annualInterestRate: 0.06 },
      })
    );
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.summary.totalGuaranteeExpenseNis).toBe(0);
      expect(result.summary.facilityExceeded).toBe(false);
    }
  });
});

describe("לוח תפעולי חסר הנחות מחזיר incompleteAssumptions ואינו מריץ מימון", () => {
  it("costSchedule.missingAssumptions -> status=incompleteAssumptions, financing=null", () => {
    const costSchedule = computeCostSchedule({
      monthIndices: MONTH_INDICES,
      costAmountsByItemId: { legal: 20_000 },
      timingRulesByItemId: {},
      constructionCurve: [1],
      anchors: {},
    });
    const result = computeCashFlow(baseInput({ costSchedule }));
    expect(result.status).toBe("incompleteAssumptions");
    expect(result.isComplete).toBe(false);
    expect(result.financing).toBeNull();
    expect(result.guaranteeSchedule).toBeNull();
    expect(result.missingAssumptions.some((w) => w.includes("legal"))).toBe(true);
  });
});

describe("requiresVerification עוצר לפני תוצאה מלאה", () => {
  it("unitCompensationOwner עם requiresVerification -> status=incompleteAssumptions, financing=null", () => {
    const guarantees: CashFlowGuaranteeInput[] = [
      {
        kind: "unitCompensationOwner",
        mechanism: { kind: "unitCompensationOwner", annualRateFraction: "requiresVerification" },
        compensationUnitValueNis: 800_000,
        startMonthIndex: 0,
        releaseMonthIndex: 5,
        ownerId: "דייר-1",
      },
    ];
    const result = computeCashFlow(baseInput({ guarantees }));
    expect(result.status).toBe("incompleteAssumptions");
    expect(result.financing).toBeNull();
    // בניגוד ללוח תפעולי חסר - כאן כן הגענו לחישוב לוח הערבויות עצמו
    expect(result.guaranteeSchedule).not.toBeNull();
    expect(result.missingAssumptions.some((w) => w.includes("requiresVerification"))).toBe(true);
  });
});

describe("אי-התכנסות מחזירה notConverged", () => {
  it("maxIterations=1 עם בסיס תלוי-סגירה -> status=notConverged, financing מוצג (לא מוסתר)", () => {
    const result = computeCashFlow(
      baseInput({
        financingFeeAssumptions: {
          unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "closingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 9 },
        },
        maxIterations: 1,
      })
    );
    expect(result.status).toBe("notConverged");
    expect(result.isComplete).toBe(false);
    if (result.status === "notConverged") {
      expect(result.financing.isConverged).toBe(false);
      expect(result.warnings.some((w) => w.includes("לא הושגה התכנסות"))).toBe(true);
    }
  });
});

describe("ערבות מעבר לתחזית הופכת לאזהרה", () => {
  it("kombinatsiaOwner חורגת מהציר - status=complete, אזהרה קיימת", () => {
    const guarantees: CashFlowGuaranteeInput[] = [
      { kind: "kombinatsiaOwner", mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 36 }, ownerUnitsMarketValueNis: 500_000, startMonthIndex: 0 },
    ];
    const result = computeCashFlow(baseInput({ guarantees }));
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.summary.activeGuaranteesBeyondForecast).toBe(true);
      expect(result.warnings.some((w) => w.includes("פעילה מעבר"))).toBe(true);
    }
  });
});

describe("גירעון וחריגת מסגרת מועברים לסיכום", () => {
  it("מסגרת קטנה מדי ובלי הון עצמי -> facilityExceeded/גירעון בסיכום ובאזהרות", () => {
    const costSchedule = computeCostSchedule({
      monthIndices: MONTH_INDICES,
      costAmountsByItemId: { landPurchase: 5_000_000 },
      timingRulesByItemId: { landPurchase: { rule: "landPurchaseMonth" } },
      constructionCurve: [1],
      anchors: { landPurchaseMonthIndex: 0 },
    });
    const result = computeCashFlow(
      baseInput({
        costSchedule,
        interestAssumptions: { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 100_000, annualInterestRate: 0.06 },
      })
    );
    expect(["complete", "notConverged"]).toContain(result.status);
    if (result.status === "complete") {
      expect(result.summary.facilityExceeded).toBe(true);
      expect(result.summary.peakFundingDeficitNis).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("חרגה") || w.includes("גירעון"))).toBe(true);
    } else if (result.status === "notConverged") {
      expect(result.financing.facilityExceeded).toBe(true);
    }
  });
});

describe("התאמות מקצה לקצה", () => {
  it("operating inflows/outflows -> financing, eligible receipts -> guarantee, אין חיוב כפול", () => {
    const guarantees: CashFlowGuaranteeInput[] = [
      { kind: "buyerSaleLaw", mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 }, releaseMonthIndex: 9 },
    ];
    const result = computeCashFlow(
      baseInput({
        guarantees,
        financingFeeAssumptions: {
          openingFee: { kind: "fixedAmount", amountNis: 5_000, chargeMonthIndex: 0 },
          unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "openingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 9 },
        },
      })
    );
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;

    const operatingByMonth = new Map(result.operatingSchedule.months.map((m) => [m.monthIndex, m]));
    const guaranteeByMonth = new Map(result.guaranteeSchedule.months.map((m) => [m.monthIndex, m]));

    for (const fm of result.financing.months) {
      const om = operatingByMonth.get(fm.monthIndex)!;
      const gm = guaranteeByMonth.get(fm.monthIndex)!;

      // operating inflows -> financing operating inflows
      expect(fm.operatingInflowsNis).toBeCloseTo(om.totalOperatingInflowsNis, 6);
      // operating outflows + guarantee + financing fees -> financing total cash outflows, בלי כפילות
      expect(fm.totalCashOutflowsNis).toBeCloseTo(fm.operatingOutflowsNis + fm.guaranteeExpenseNis + fm.totalFinancingFeeExpenseNis, 6);
      expect(fm.operatingOutflowsNis).toBeCloseTo(om.totalOperatingOutflowsNis, 6);
      expect(fm.guaranteeExpenseNis).toBeCloseTo(gm.totalGuaranteeExpenseNis, 6);
    }

    // summary totals -> detailed monthly totals
    const sumInflows = result.financing.months.reduce((a, m) => a + m.operatingInflowsNis, 0);
    expect(result.summary.totalOperatingInflowsNis).toBeCloseTo(sumInflows, 6);
    const sumOutflows = result.financing.months.reduce((a, m) => a + m.operatingOutflowsNis, 0);
    expect(result.summary.totalOperatingOutflowsNis).toBeCloseTo(sumOutflows, 6);
  });
});

describe("שינוי סדר שורות הקלט אינו משנה תוצאה", () => {
  it("סדר salesUnitRows/guarantees הפוך מפיק תוצאה זהה", () => {
    const guarantees: CashFlowGuaranteeInput[] = [
      { kind: "buyerSaleLaw", mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 }, releaseMonthIndex: 9 },
      { kind: "kombinatsiaOwner", mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 6 }, ownerUnitsMarketValueNis: 500_000, startMonthIndex: 0 },
    ];
    const forward = computeCashFlow(baseInput({ salesUnitRows: [rowA(), rowB()], guarantees }));
    const backward = computeCashFlow(baseInput({ salesUnitRows: [rowB(), rowA()], guarantees: [...guarantees].reverse() }));
    expect(forward.status).toBe("complete");
    expect(backward.status).toBe("complete");
    if (forward.status === "complete" && backward.status === "complete") {
      expect(backward.summary).toEqual(forward.summary);
    }
  });
});

describe("אין מוטציה ואין NaN/Infinity", () => {
  it("אין NaN/Infinity בתרחיש מלא", () => {
    const guarantees: CashFlowGuaranteeInput[] = [
      { kind: "buyerSaleLaw", mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 }, releaseMonthIndex: 9 },
      { kind: "kombinatsiaOwner", mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 6 }, ownerUnitsMarketValueNis: 500_000, startMonthIndex: 0 },
    ];
    const result = computeCashFlow(
      baseInput({
        guarantees,
        financingFeeAssumptions: {
          openingFee: { kind: "fixedAmount", amountNis: 5_000, chargeMonthIndex: 0 },
          unusedFacilityCommission: { annualRateFraction: 0.01, balanceBasis: "averageOpeningClosingAvailableFacility", startMonthIndex: 0, endMonthIndexExclusive: 9 },
        },
      })
    );
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    for (const v of Object.values(result.summary)) {
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    }
    for (const m of result.financing.months) {
      for (const v of Object.values(m)) {
        if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("אין מוטציה של הקלט", () => {
    const guarantees: CashFlowGuaranteeInput[] = [
      { kind: "buyerSaleLaw", mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 }, releaseMonthIndex: 9 },
    ];
    const input = baseInput({ guarantees });
    const snapshot = JSON.parse(JSON.stringify(input));

    computeCashFlow(input);

    expect(input).toEqual(snapshot);
  });
});
