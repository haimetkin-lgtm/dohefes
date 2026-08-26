import { describe, expect, it } from "vitest";
import { computeCostSchedule } from "./cashflow-cost-schedule";
import type { CostScheduleAnchors, CostScheduleInput } from "./cashflow-cost-schedule";
import type { CashFlowCostItemId, CostTimingRule } from "./cashflow-types";

const MONTH_INDICES = Array.from({ length: 12 }, (_, i) => i); // 0..11

const BASE_ANCHORS: CostScheduleAnchors = {
  landPurchaseMonthIndex: 0,
  permitMonthIndex: 3,
  escortStartMonthIndex: 2,
  escortEndMonthIndexExclusive: 5,
  constructionStartMonthIndex: 4,
  preCompletionMonthIndex: 10,
  relocationStartMonthIndex: 1,
  relocationEndMonthIndexExclusive: 4,
};

function run(
  costAmountsByItemId: Partial<Record<CashFlowCostItemId, number>>,
  timingRulesByItemId: Partial<Record<CashFlowCostItemId, CostTimingRule>>,
  overrides: Partial<CostScheduleInput> = {}
) {
  const input: CostScheduleInput = {
    monthIndices: MONTH_INDICES,
    costAmountsByItemId,
    timingRulesByItemId,
    constructionCurve: [1], // ברירת מחדל: חודש בנייה יחיד, לא בשימוש ברוב הבדיקות
    anchors: BASE_ANCHORS,
    ...overrides,
  };
  return computeCostSchedule(input);
}

describe("עלות בחודש מפורש", () => {
  it("permitMonth: כל הסכום נופל בדיוק בחודש permitMonthIndex", () => {
    const result = run({ municipalFees: 50_000 }, { municipalFees: { rule: "permitMonth" } });
    expect(result.months[3].costsByItemId.municipalFees).toBe(50_000);
    expect(result.months[0].costsByItemId.municipalFees).toBeUndefined();
    expect(result.totalsByItemId.municipalFees).toBe(50_000);
  });
});

describe("עלות בתחילת הפרויקט", () => {
  it("landPurchaseMonth: כל הסכום בחודש landPurchaseMonthIndex (0)", () => {
    const result = run({ landPurchase: 1_000_000 }, { landPurchase: { rule: "landPurchaseMonth" } });
    expect(result.months[0].costsByItemId.landPurchase).toBe(1_000_000);
  });
});

describe("עלות בתחילת הבנייה", () => {
  it("constructionStart: כל הסכום בחודש constructionStartMonthIndex", () => {
    const result = run({ demolition: 200_000 }, { demolition: { rule: "constructionStart" } });
    expect(result.months[4].costsByItemId.demolition).toBe(200_000);
  });
});

describe("עלות במסירה", () => {
  it("preCompletion: כל הסכום בחודש preCompletionMonthIndex", () => {
    const result = run({ legalRefund: 30_000 }, { legalRefund: { rule: "preCompletion" } });
    expect(result.months[10].costsByItemId.legalRefund).toBe(30_000);
  });
});

describe("פריסה אחידה", () => {
  it("spreadOverEscort: מתחלק שווה בשווה על פני [start, endExclusive), התאמת שקל מדויקת", () => {
    const result = run({ financialSupervision: 9_000 }, { financialSupervision: { rule: "spreadOverEscort" } });
    // escort: [2,5) = חודשים 2,3,4 - 9,000/3=3,000 בדיוק
    expect(result.months[2].costsByItemId.financialSupervision).toBe(3_000);
    expect(result.months[3].costsByItemId.financialSupervision).toBe(3_000);
    expect(result.months[4].costsByItemId.financialSupervision).toBe(3_000);
    expect(result.months[5].costsByItemId.financialSupervision).toBeUndefined();
    expect(result.totalsByItemId.financialSupervision).toBe(9_000);
  });
});

describe("פריסה לפי עקומת בנייה", () => {
  it("spreadOverConstruction: מתחלק לפי הפרשי העקומה, לא שווה בשווה", () => {
    // עקומה לא-אחידה במכוון: תוספות 0.1/0.2/0.4/0.3 - שונה מפריסה אחידה (שהייתה נותנת 0.25 לכל חודש)
    const curve = [0.1, 0.3, 0.7, 1.0];
    const result = run(
      { constructionResidential: 100_000 },
      { constructionResidential: { rule: "spreadOverConstruction" } },
      { constructionCurve: curve }
    );
    // constructionStartMonthIndex=4 -> חודשים 4,5,6,7
    expect(result.months[4].costsByItemId.constructionResidential).toBeCloseTo(10_000, 6);
    expect(result.months[5].costsByItemId.constructionResidential).toBeCloseTo(20_000, 6);
    expect(result.months[6].costsByItemId.constructionResidential).toBeCloseTo(40_000, 6);
    expect(result.months[7].costsByItemId.constructionResidential).toBeCloseTo(30_000, 6);
    expect(result.totalsByItemId.constructionResidential).toBeCloseTo(100_000, 6);
  });
});

describe("סכום שאינו מתחלק עגול", () => {
  it("1000 על פני 3 חודשים - סכום מדויק למרות שהחלוקה אינה עגולה", () => {
    const result = run(
      { organizerFee: 1_000 },
      { organizerFee: { rule: "spreadOverRelocation" } },
      { anchors: { ...BASE_ANCHORS, relocationStartMonthIndex: 0, relocationEndMonthIndexExclusive: 3 } }
    );
    const sum =
      (result.months[0].costsByItemId.organizerFee ?? 0) +
      (result.months[1].costsByItemId.organizerFee ?? 0) +
      (result.months[2].costsByItemId.organizerFee ?? 0);
    expect(sum).toBe(1_000); // תיקון שארית מבטיח שוויון מדויק, לא toBeCloseTo
    expect(result.totalsByItemId.organizerFee).toBe(1_000);
  });
});

describe("כמה פריטים באותו חודש", () => {
  it("שני פריטים שונים נופלים באותו חודש - כל אחד נשמר בנפרד, הסך הוא הסכום", () => {
    const result = run(
      { landPurchase: 1_000_000, brokerage: 30_000 },
      { landPurchase: { rule: "landPurchaseMonth" }, brokerage: { rule: "landPurchaseMonth" } }
    );
    expect(result.months[0].costsByItemId.landPurchase).toBe(1_000_000);
    expect(result.months[0].costsByItemId.brokerage).toBe(30_000);
    expect(result.months[0].totalCostOutflowsNis).toBe(1_030_000);
  });
});

describe("אותו פריט לאורך חודשים רבים", () => {
  it("פריט אחד פרוס על 8 חודשים - מופיע בעקביות בכל חודש בחלון", () => {
    const result = run(
      { overhead: 80_000 },
      { overhead: { rule: "spreadOverEscort" } },
      { anchors: { ...BASE_ANCHORS, escortStartMonthIndex: 0, escortEndMonthIndexExclusive: 8 } }
    );
    for (let m = 0; m < 8; m++) {
      expect(result.months[m].costsByItemId.overhead).toBeCloseTo(10_000, 6);
    }
    expect(result.months[8].costsByItemId.overhead).toBeUndefined();
    expect(result.totalsByItemId.overhead).toBe(80_000);
  });
});

describe("סכום חיובי ללא timing -> missingAssumptions", () => {
  it("לא נזרק לחודש 0 בשקט - מדווח ב-missingAssumptions, תרומה 0", () => {
    const result = run({ legal: 40_000 }, {});
    expect(result.missingAssumptions).toHaveLength(1);
    expect(result.missingAssumptions[0]).toContain("legal");
    expect(result.isComplete).toBe(false);
    for (const m of result.months) {
      expect(m.costsByItemId.legal).toBeUndefined();
    }
    expect(result.totalsByItemId.legal).toBe(0);
  });

  it("salesCurve ו-requiresProjectAgreement: תרומה 0, מדווח ב-missingAssumptions, לא נזרקת שגיאה", () => {
    const result = run(
      { marketing: 20_000, bettermentLevy: 15_000 },
      { marketing: { rule: "salesCurve" }, bettermentLevy: { rule: "requiresProjectAgreement", note: "תלוי מו״מ עם העירייה" } }
    );
    expect(result.missingAssumptions).toHaveLength(2);
    expect(result.missingAssumptions.some((w) => w.includes("marketing") && w.includes("salesCurve"))).toBe(true);
    expect(result.missingAssumptions.some((w) => w.includes("bettermentLevy") && w.includes("מו״מ"))).toBe(true);
    expect(result.isComplete).toBe(false);
  });
});

describe("סכום אפס ללא timing -> תקין", () => {
  it("אין missingAssumptions, isComplete=true", () => {
    const result = run({ legal: 0 }, {});
    expect(result.missingAssumptions).toEqual([]);
    expect(result.isComplete).toBe(true);
    // מדווח כ-0 מפורש (שקיפות מול הקלט), לא נעדר - אין חודש שמזכיר אותו כי לא היה מה לתזמן
    expect(result.totalsByItemId.legal).toBe(0);
    for (const m of result.months) expect(m.costsByItemId.legal).toBeUndefined();
  });
});

describe("חודש מחוץ לציר נדחה", () => {
  it("עוגן מחוץ לציר נדחה", () => {
    expect(() =>
      run({ landPurchase: 100 }, { landPurchase: { rule: "landPurchaseMonth" } }, { anchors: { ...BASE_ANCHORS, landPurchaseMonthIndex: 99 } })
    ).toThrow();
  });
  it("spreadOverConstruction שחורג מהציר נדחה, לא נחתך בשקט", () => {
    expect(() =>
      run(
        { constructionResidential: 100 },
        { constructionResidential: { rule: "spreadOverConstruction" } },
        { constructionCurve: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], anchors: { ...BASE_ANCHORS, constructionStartMonthIndex: 4 } }
      )
    ).toThrow();
  });
});

describe("עקומה לא תקינה נדחית", () => {
  it("עקומה שלא מסתיימת ב-1 נדחית", () => {
    expect(() =>
      run(
        { constructionResidential: 100 },
        { constructionResidential: { rule: "spreadOverConstruction" } },
        { constructionCurve: [0.1, 0.2, 0.3] }
      )
    ).toThrow();
  });
  it("עקומה יורדת (לא מונוטונית) נדחית", () => {
    expect(() =>
      run(
        { constructionResidential: 100 },
        { constructionResidential: { rule: "spreadOverConstruction" } },
        { constructionCurve: [0.5, 0.2, 1.0] }
      )
    ).toThrow();
  });
});

describe("מפתח לא מוכר נדחה (כולל פריטי מימון נגזרים)", () => {
  it("מפתח שרירותי לא מוכר ב-costAmountsByItemId נדחה", () => {
    expect(() => run({ notARealItem: 100 } as unknown as Partial<Record<CashFlowCostItemId, number>>, {})).toThrow();
  });
  it("accountOpeningCommission (פריט מימון נגזר, הוסר ב-7-prep) נדחה כמפתח לא מוכר", () => {
    expect(() =>
      run({ accountOpeningCommission: 5_000 } as unknown as Partial<Record<CashFlowCostItemId, number>>, {
        accountOpeningCommission: { rule: "escortStart" },
      } as unknown as Partial<Record<CashFlowCostItemId, CostTimingRule>>)
    ).toThrow();
  });
  it("interest/guaranteeCommission (תוצרי לולאה חודשית, מעולם לא היו ב-CashFlowCostItemId) נדחים", () => {
    expect(() => run({ interest: 100 } as unknown as Partial<Record<CashFlowCostItemId, number>>, {})).toThrow();
  });
  it("מפתח לא מוכר ב-timingRulesByItemId נדחה גם בלי סכום מקביל", () => {
    expect(() =>
      run({}, { notARealItem: { rule: "landPurchaseMonth" } } as unknown as Partial<Record<CashFlowCostItemId, CostTimingRule>>)
    ).toThrow();
  });
});

describe("התאמת שקל לכל פריט וללוח כולו", () => {
  it("sum(חודשים) === סכום הקלט, לכל פריט וללוח כולו", () => {
    const result = run(
      {
        landPurchase: 1_000_000,
        organizerFee: 1_000,
        financialSupervision: 9_000,
      },
      {
        landPurchase: { rule: "landPurchaseMonth" },
        organizerFee: { rule: "spreadOverRelocation" },
        financialSupervision: { rule: "spreadOverEscort" },
      }
    );
    const sumLandPurchase = result.months.reduce((acc, m) => acc + (m.costsByItemId.landPurchase ?? 0), 0);
    const sumOrganizer = result.months.reduce((acc, m) => acc + (m.costsByItemId.organizerFee ?? 0), 0);
    const sumFinancial = result.months.reduce((acc, m) => acc + (m.costsByItemId.financialSupervision ?? 0), 0);
    expect(sumLandPurchase).toBeCloseTo(1_000_000, 6);
    expect(sumOrganizer).toBeCloseTo(1_000, 6);
    expect(sumFinancial).toBeCloseTo(9_000, 6);

    expect(result.totalsByItemId.landPurchase).toBeCloseTo(1_000_000, 6);
    expect(result.totalsByItemId.organizerFee).toBeCloseTo(1_000, 6);
    expect(result.totalsByItemId.financialSupervision).toBeCloseTo(9_000, 6);

    const sumOfMonthTotals = result.months.reduce((acc, m) => acc + m.totalCostOutflowsNis, 0);
    expect(result.totalCostOutflowsNis).toBeCloseTo(1_010_000, 6);
    expect(sumOfMonthTotals).toBeCloseTo(result.totalCostOutflowsNis, 6);
  });
});

describe("אין NaN/Infinity ואין מוטציה", () => {
  it("כל השדות המספריים סופיים בתרחיש מלא", () => {
    const result = run(
      {
        landPurchase: 1_000_000,
        organizerFee: 1_000,
        constructionResidential: 500_000,
        legal: 0,
      },
      {
        landPurchase: { rule: "landPurchaseMonth" },
        organizerFee: { rule: "spreadOverRelocation" },
        constructionResidential: { rule: "spreadOverConstruction" },
      },
      { constructionCurve: [0.25, 0.5, 0.75, 1.0] }
    );
    for (const m of result.months) {
      for (const value of Object.values(m.costsByItemId)) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(Number.isFinite(m.totalCostOutflowsNis)).toBe(true);
    }
    expect(Number.isFinite(result.totalCostOutflowsNis)).toBe(true);
  });

  it("אין מוטציה של הקלט", () => {
    const input: CostScheduleInput = {
      monthIndices: [...MONTH_INDICES],
      costAmountsByItemId: { landPurchase: 1_000_000, organizerFee: 1_000 },
      timingRulesByItemId: { landPurchase: { rule: "landPurchaseMonth" }, organizerFee: { rule: "spreadOverRelocation" } },
      constructionCurve: [0.5, 1.0],
      anchors: { ...BASE_ANCHORS },
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    computeCostSchedule(input);

    expect(input).toEqual(snapshot);
  });
});
