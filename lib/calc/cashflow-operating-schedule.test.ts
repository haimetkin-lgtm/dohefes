import { describe, expect, it } from "vitest";
import { computeOperatingSchedule } from "./cashflow-operating-schedule";
import type { OperatingScheduleInput, SalesUnitRowInput } from "./cashflow-operating-schedule";
import { computeCostSchedule } from "./cashflow-cost-schedule";
import type { CostScheduleResult } from "./cashflow-cost-schedule";
import type { PaymentTranche, SalesScheduleAssumptions } from "./cashflow-types";

const MONTH_INDICES = Array.from({ length: 9 }, (_, i) => i); // 0..8
const HANDOVER = 8;
const CONSTRUCTION_START = 2;
const MARKETING_START = 0;

const RESIDENTIAL_HANDOVER_TRANCHE: PaymentTranche = { fraction: 1, timing: { kind: "handover" }, label: "מסירה" };
const COMMERCIAL_IMMEDIATE_TRANCHE: PaymentTranche = { fraction: 1, timing: { kind: "relativeToSale", monthsAfterSale: 0 }, label: "מיידי" };

const SALES_SCHEDULE: SalesScheduleAssumptions = {
  model: "explicitSchedule",
  byCategory: {
    residential: [RESIDENTIAL_HANDOVER_TRANCHE],
    commercial: [COMMERCIAL_IMMEDIATE_TRANCHE],
  },
  saleMonthByCategory: {},
};

function emptyCostSchedule(): CostScheduleResult {
  return computeCostSchedule({
    monthIndices: MONTH_INDICES,
    costAmountsByItemId: {},
    timingRulesByItemId: {},
    constructionCurve: [1],
    anchors: {},
  });
}

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
function rowC(): SalesUnitRowInput {
  return {
    unitRowId: "row-c",
    unit: { count: 2, priceNis: 800_000, category: "commercial" },
    batches: [{ unitsCount: 2, saleMonth: 2 }],
    isBuyerSaleLawEligible: true,
  };
}

function run(salesUnitRows: SalesUnitRowInput[], overrides: Partial<OperatingScheduleInput> = {}) {
  const input: OperatingScheduleInput = {
    monthIndices: MONTH_INDICES,
    salesUnitRows,
    salesScheduleAssumptions: SALES_SCHEDULE,
    marketingStartMonthIndex: MARKETING_START,
    constructionStartMonthIndex: CONSTRUCTION_START,
    handoverMonthIndex: HANDOVER,
    costSchedule: emptyCostSchedule(),
    ...overrides,
  };
  return computeOperatingSchedule(input);
}

describe("שורת מכירה אחת", () => {
  it("תקבול נופל בדיוק בחודש הצפוי (handover, 100% מהמחיר)", () => {
    const result = run([rowA()]);
    expect(result.months[HANDOVER].receiptsByUnitRowId["row-a"]).toBe(15_000_000);
    expect(result.totalOperatingInflowsNis).toBe(15_000_000);
  });
});

describe("כמה שורות שנמכרות בחודשים שונים", () => {
  it("residential ב-handover, commercial מיידי - חודשים שונים בפועל", () => {
    const result = run([rowA(), rowC()]);
    expect(result.months[2].receiptsByUnitRowId["row-c"]).toBe(1_600_000);
    expect(result.months[HANDOVER].receiptsByUnitRowId["row-a"]).toBe(15_000_000);
    expect(result.months[2].receiptsByUnitRowId["row-a"]).toBeUndefined();
    expect(result.months[HANDOVER].receiptsByUnitRowId["row-c"]).toBeUndefined();
  });
});

describe("שתי שורות מאותה קטגוריה - נפרדות לפי unitRowId, מסוכמות לפי קטגוריה", () => {
  it("row-a ו-row-b (שתיהן residential, שתיהן ב-handover)", () => {
    const result = run([rowA(), rowB()]);
    const m = result.months[HANDOVER];
    expect(m.receiptsByUnitRowId["row-a"]).toBe(15_000_000);
    expect(m.receiptsByUnitRowId["row-b"]).toBe(10_000_000);
    expect(m.receiptsByUnitCategory.residential).toBe(25_000_000);
  });
});

describe("מזהה שורה כפול או ריק נדחה", () => {
  it("unitRowId ריק נדחה", () => {
    expect(() => run([{ ...rowA(), unitRowId: "" }])).toThrow();
  });
  it("unitRowId כפול נדחה", () => {
    expect(() => run([rowA(), { ...rowB(), unitRowId: "row-a" }])).toThrow();
  });
});

describe("שינוי סדר השורות אינו משנה את התוצאה", () => {
  it("[A,B,C] ו-[C,B,A] מפיקים תוצאה זהה", () => {
    const forward = run([rowA(), rowB(), rowC()]);
    const backward = run([rowC(), rowB(), rowA()]);
    expect(backward.months).toEqual(forward.months);
    expect(backward.totalOperatingInflowsNis).toBe(forward.totalOperatingInflowsNis);
    expect(backward.receiptsTotalsByUnitRowId).toEqual(forward.receiptsTotalsByUnitRowId);
  });
});

describe("שורה זכאית לערבות נכנסת ל-eligibleBuyerReceiptsNis", () => {
  it("row-a (eligible) ו-row-c (eligible) נכנסות, כל אחת בחודש שלה", () => {
    const result = run([rowA(), rowC()]);
    expect(result.months[HANDOVER].eligibleBuyerReceiptsNis).toBe(15_000_000);
    expect(result.months[2].eligibleBuyerReceiptsNis).toBe(1_600_000);
    expect(result.totalEligibleBuyerReceiptsNis).toBe(16_600_000);
  });
});

describe("שורה שאינה זכאית אינה נכנסת לבסיס הערבות אך כן נכנסת לתקבולים הכלליים", () => {
  it("row-b (לא eligible): נכנסת ל-totalOperatingInflowsNis, לא ל-eligibleBuyerReceiptsNis", () => {
    const result = run([rowA(), rowB()]);
    const m = result.months[HANDOVER];
    expect(m.totalOperatingInflowsNis).toBe(25_000_000); // A+B
    expect(m.eligibleBuyerReceiptsNis).toBe(15_000_000); // A בלבד
  });
});

describe("יחידת תמורה ללא תקבול", () => {
  it("isCompensationUnit עם batches ריק - 0 בכל חודש, אין שגיאה", () => {
    const compensationRow: SalesUnitRowInput = {
      unitRowId: "row-comp",
      unit: { count: 4, priceNis: 0, category: "residential", isCompensationUnit: true },
      batches: [],
      isBuyerSaleLawEligible: false,
    };
    const result = run([compensationRow]);
    for (const m of result.months) {
      expect(m.receiptsByUnitRowId["row-comp"]).toBeUndefined();
    }
    expect(result.totalOperatingInflowsNis).toBe(0);
  });
});

describe("ניסיון להוסיף batches ליחידה שאינה נמכרת נדחה", () => {
  it("isCompensationUnit עם batches לא ריק נדחה", () => {
    const badRow: SalesUnitRowInput = {
      unitRowId: "row-bad",
      unit: { count: 4, priceNis: 0, category: "residential", isCompensationUnit: true },
      batches: [{ unitsCount: 1, saleMonth: 1 }],
      isBuyerSaleLawEligible: false,
    };
    expect(() => run([badRow])).toThrow();
  });
});

describe("עלויות ותקבולים באותו חודש", () => {
  it("עלות בחודש 2 ותקבול בחודש 2 (row-c) מופיעים שניהם, בלי הפרעה זה לזה", () => {
    const costSchedule = computeCostSchedule({
      monthIndices: MONTH_INDICES,
      costAmountsByItemId: { municipalFees: 40_000 },
      timingRulesByItemId: { municipalFees: { rule: "permitMonth" } },
      constructionCurve: [1],
      anchors: { permitMonthIndex: 2 },
    });
    const result = run([rowC()], { costSchedule });
    const m = result.months[2];
    expect(m.receiptsByUnitRowId["row-c"]).toBe(1_600_000);
    expect(m.costsByItemId.municipalFees).toBe(40_000);
    expect(m.totalOperatingOutflowsNis).toBe(40_000);
    expect(m.totalOperatingInflowsNis).toBe(1_600_000);
  });
});

describe("לוח עלויות חלקי מעביר missingAssumptions", () => {
  it("costSchedule.missingAssumptions מועבר, isComplete=false, לא מומצא עיתוי חלופי", () => {
    const costSchedule = computeCostSchedule({
      monthIndices: MONTH_INDICES,
      costAmountsByItemId: { legal: 20_000 },
      timingRulesByItemId: {}, // אין כלל עיתוי - חוסר אמיתי
      constructionCurve: [1],
      anchors: {},
    });
    expect(costSchedule.isComplete).toBe(false);
    const result = run([rowA()], { costSchedule });
    expect(result.isComplete).toBe(false);
    expect(result.missingAssumptions.some((w) => w.includes("legal"))).toBe(true);
    for (const m of result.months) {
      expect(m.costsByItemId.legal).toBeUndefined();
    }
  });
});

describe("קטגוריה נמכרת בלי לוח תשלומים מוגדר", () => {
  it("מדווח כ-missingAssumptions, לא נזרקת שגיאה, תרומת השורה 0", () => {
    const officeRow: SalesUnitRowInput = {
      unitRowId: "row-office",
      unit: { count: 1, priceNis: 500_000, category: "office" }, // office אין ב-SALES_SCHEDULE.byCategory
      batches: [{ unitsCount: 1, saleMonth: 1 }],
      isBuyerSaleLawEligible: false,
    };
    const result = run([officeRow]);
    expect(result.isComplete).toBe(false);
    expect(result.missingAssumptions.some((w) => w.includes("row-office"))).toBe(true);
    expect(result.totalOperatingInflowsNis).toBe(0);
  });
});

describe("צירי חודשים בסדר שונה מותאמים לפי monthIndex", () => {
  it("costSchedule.months בסדר הפוך מפיק תוצאה זהה לסדר הרגיל", () => {
    const costSchedule = computeCostSchedule({
      monthIndices: MONTH_INDICES,
      costAmountsByItemId: { municipalFees: 40_000 },
      timingRulesByItemId: { municipalFees: { rule: "permitMonth" } },
      constructionCurve: [1],
      anchors: { permitMonthIndex: 2 },
    });
    const reversed: CostScheduleResult = { ...costSchedule, months: [...costSchedule.months].reverse() };

    const normal = run([rowA()], { costSchedule });
    const withReversed = run([rowA()], { costSchedule: reversed });

    expect(withReversed.months.map((m) => m.monthIndex)).toEqual(MONTH_INDICES); // סדר הפלט = monthIndices
    expect(withReversed.totalOperatingOutflowsNis).toBe(normal.totalOperatingOutflowsNis);
    expect(withReversed.months[2].costsByItemId.municipalFees).toBe(40_000);
  });
});

describe("חודש חסר/עודף/כפול בלוח העלויות נדחה", () => {
  it("חודש חסר נדחה", () => {
    const costSchedule = emptyCostSchedule();
    const truncated: CostScheduleResult = { ...costSchedule, months: costSchedule.months.slice(0, 8) }; // חסר חודש 8
    expect(() => run([rowA()], { costSchedule: truncated })).toThrow();
  });
  it("חודש עודף נדחה", () => {
    const costSchedule = computeCostSchedule({ monthIndices: [...MONTH_INDICES, 9], costAmountsByItemId: {}, timingRulesByItemId: {}, constructionCurve: [1], anchors: {} });
    expect(() => run([rowA()], { costSchedule })).toThrow();
  });
  it("חודש כפול נדחה", () => {
    const costSchedule = emptyCostSchedule();
    const duplicated: CostScheduleResult = { ...costSchedule, months: [costSchedule.months[0], costSchedule.months[0]] };
    expect(() => run([rowA()], { costSchedule: duplicated })).toThrow();
  });
  it("ציר monthIndices לא רציף נדחה", () => {
    expect(() => run([rowA()], { monthIndices: [0, 1, 3] })).toThrow();
  });
});

describe("התאמות שקל לכל שורה, קטגוריה, חודש ופרויקט", () => {
  it("כל רמות ההתאמה מתקיימות", () => {
    const costSchedule = computeCostSchedule({
      monthIndices: MONTH_INDICES,
      costAmountsByItemId: { municipalFees: 40_000, organizerFee: 10_000 },
      timingRulesByItemId: { municipalFees: { rule: "permitMonth" }, organizerFee: { rule: "landPurchaseMonth" } },
      constructionCurve: [1],
      anchors: { permitMonthIndex: 2, landPurchaseMonthIndex: 0 },
    });
    const result = run([rowA(), rowB(), rowC()], { costSchedule });

    // שורה: sum(receiptsByUnitRowId[rowId]) === count*priceNis
    expect(result.receiptsTotalsByUnitRowId["row-a"]).toBeCloseTo(15_000_000, 6);
    expect(result.receiptsTotalsByUnitRowId["row-b"]).toBeCloseTo(10_000_000, 6);
    expect(result.receiptsTotalsByUnitRowId["row-c"]).toBeCloseTo(1_600_000, 6);

    // חודש: sum(receiptsByUnitRowId) === totalOperatingInflowsNis; זכאים בלבד === eligibleBuyerReceiptsNis
    for (const m of result.months) {
      const sumReceipts = Object.values(m.receiptsByUnitRowId).reduce((a, b) => a + b, 0);
      expect(sumReceipts).toBeCloseTo(m.totalOperatingInflowsNis, 6);
      const sumCosts = Object.values(m.costsByItemId).reduce((a, b) => a + (b ?? 0), 0);
      expect(sumCosts).toBeCloseTo(m.totalOperatingOutflowsNis, 6);
    }
    const sumEligibleHandover = result.months[HANDOVER].receiptsByUnitRowId["row-a"]; // row-b לא זכאית
    expect(sumEligibleHandover).toBeCloseTo(result.months[HANDOVER].eligibleBuyerReceiptsNis, 6);

    // פרויקט: sum(inflows חודשיים) === sum(receiptsTotalsByUnitRowId); sum(outflows חודשיים) === costSchedule.totalCostOutflowsNis
    const sumMonthlyInflows = result.months.reduce((a, m) => a + m.totalOperatingInflowsNis, 0);
    const sumRowTotals = Object.values(result.receiptsTotalsByUnitRowId).reduce((a, b) => a + b, 0);
    expect(sumMonthlyInflows).toBeCloseTo(sumRowTotals, 6);

    const sumMonthlyOutflows = result.months.reduce((a, m) => a + m.totalOperatingOutflowsNis, 0);
    expect(sumMonthlyOutflows).toBeCloseTo(costSchedule.totalCostOutflowsNis, 6);
    expect(result.totalOperatingOutflowsNis).toBeCloseTo(costSchedule.totalCostOutflowsNis, 6);
  });
});

describe("מוסכמת המע\"מ הקיימת נשמרת ללא שינוי", () => {
  it("residential (כולל מע\"מ) ו-commercial (נטו) - שניהם count*priceNis בלי המרה נוספת", () => {
    const result = run([rowA(), rowC()]);
    expect(result.receiptsTotalsByUnitRowId["row-a"]).toBe(10 * 1_500_000); // residential
    expect(result.receiptsTotalsByUnitRowId["row-c"]).toBe(2 * 800_000); // commercial
  });
});

describe("אין מוטציה ואין NaN/Infinity", () => {
  it("אין NaN/Infinity בתרחיש מלא", () => {
    const costSchedule = computeCostSchedule({
      monthIndices: MONTH_INDICES,
      costAmountsByItemId: { municipalFees: 40_000 },
      timingRulesByItemId: { municipalFees: { rule: "permitMonth" } },
      constructionCurve: [1],
      anchors: { permitMonthIndex: 2 },
    });
    const result = run([rowA(), rowB(), rowC()], { costSchedule });
    for (const m of result.months) {
      for (const v of Object.values(m.receiptsByUnitRowId)) expect(Number.isFinite(v)).toBe(true);
      for (const v of Object.values(m.receiptsByUnitCategory)) expect(Number.isFinite(v)).toBe(true);
      for (const v of Object.values(m.costsByItemId)) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(m.totalOperatingInflowsNis)).toBe(true);
      expect(Number.isFinite(m.eligibleBuyerReceiptsNis)).toBe(true);
      expect(Number.isFinite(m.totalOperatingOutflowsNis)).toBe(true);
    }
    expect(Number.isFinite(result.totalOperatingInflowsNis)).toBe(true);
  });

  it("אין מוטציה של הקלט", () => {
    const costSchedule = emptyCostSchedule();
    const input: OperatingScheduleInput = {
      monthIndices: [...MONTH_INDICES],
      salesUnitRows: [rowA(), rowB()],
      salesScheduleAssumptions: JSON.parse(JSON.stringify(SALES_SCHEDULE)),
      marketingStartMonthIndex: MARKETING_START,
      constructionStartMonthIndex: CONSTRUCTION_START,
      handoverMonthIndex: HANDOVER,
      costSchedule,
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    computeOperatingSchedule(input);

    expect(input).toEqual(snapshot);
  });
});
