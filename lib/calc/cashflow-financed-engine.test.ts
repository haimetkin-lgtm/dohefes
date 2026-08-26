import { describe, expect, it } from "vitest";
import { computeFinancedCashFlow } from "./cashflow-financed-engine";
import type { FinancedCashFlowInput, OperatingMonthInput } from "./cashflow-financed-engine";
import { computeInterestCashFlow } from "./cashflow-interest-engine";
import type { InterestCashFlowAssumptions } from "./cashflow-interest-engine";
import { computeGuaranteeSchedule } from "./cashflow-guarantees";
import type { GuaranteeInstanceInput, GuaranteeScheduleResult } from "./cashflow-guarantees";

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
  creditFacilityLimitNis: 5_000_000,
  annualInterestRate: 0.06,
};

describe("ללא ערבויות - תוצאה זהה למנוע הריבית הקיים", () => {
  it("כל שדה נגזר מתאים בדיוק לקריאה ישירה ל-computeInterestCashFlow", () => {
    const operatingMonths = [
      operatingMonth(0, 0, 400_000),
      operatingMonth(1, 100_000, 150_000),
      operatingMonth(2, 400_000, 50_000),
      operatingMonth(3, 0, 0),
      operatingMonth(4, 300_000, 10_000),
      operatingMonth(5, 500_000, 0),
    ];
    const guaranteeSchedule = zeroGuaranteeSchedule();
    const assumptions: InterestCashFlowAssumptions = { ...BASE_ASSUMPTIONS, minimumCashBalanceNis: 10_000, creditFacilityLimitNis: 300_000 };

    const financed = computeFinancedCashFlow({ operatingMonths, guaranteeSchedule, interestAssumptions: assumptions });

    const direct = computeInterestCashFlow(
      operatingMonths.map((m) => ({ monthIndex: m.monthIndex, inflowsNis: m.operatingInflowsNis, outflowsNis: m.operatingOutflowsNis, phases: m.phases })),
      assumptions
    );

    financed.months.forEach((fm, i) => {
      const dm = direct.months[i];
      expect(fm.equityInjectionNis).toBeCloseTo(dm.equityInjectionNis, 6);
      expect(fm.creditDrawNis).toBeCloseTo(dm.creditDrawNis, 6);
      expect(fm.creditRepaymentNis).toBeCloseTo(dm.creditRepaymentNis, 6);
      expect(fm.interestExpenseNis).toBeCloseTo(dm.interestExpenseNis, 6);
      expect(fm.closingCashBalanceNis).toBeCloseTo(dm.closingCashBalanceNis, 6);
      expect(fm.closingDebtBalanceNis).toBeCloseTo(dm.closingDebtBalanceNis, 6);
      expect(fm.fundingDeficitBalanceNis).toBeCloseTo(dm.fundingDeficitBalanceNis, 6);
      expect(fm.facilityBreachNis).toBeCloseTo(dm.facilityBreachNis, 6);
      expect(fm.guaranteeExpenseNis).toBe(0);
    });
    expect(financed.totalInterestExpenseNis).toBeCloseTo(direct.totalInterestExpenseNis, 6);
    expect(financed.totalGuaranteeExpenseNis).toBe(0);
  });
});

describe("הוצאת ערבות מגדילה את משיכת האשראי", () => {
  it("אותו תזרים תפעולי, עם ערבות מושכת יותר אשראי מאשר בלי", () => {
    const operatingMonths = [operatingMonth(0, 0, 100_000), operatingMonth(1, 0, 0), operatingMonth(2, 0, 0)];
    const assumptions: InterestCashFlowAssumptions = { ...BASE_ASSUMPTIONS, creditFacilityLimitNis: 5_000_000 };

    const withoutGuarantee = computeFinancedCashFlow({
      operatingMonths: operatingMonths.map((m) => ({ ...m, monthIndex: m.monthIndex })),
      guaranteeSchedule: computeGuaranteeSchedule({ monthIndices: [0, 1, 2], instances: [] }),
      interestAssumptions: assumptions,
    });

    const withGuarantee = computeFinancedCashFlow({
      operatingMonths,
      guaranteeSchedule: computeGuaranteeSchedule({
        monthIndices: [0, 1, 2],
        instances: [
          {
            kind: "buyerSaleLaw",
            mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 },
            monthlyEligibleBuyerReceiptsNis: [200_000, 0, 0],
            releaseMonthIndex: 3,
          },
        ],
      }),
      interestAssumptions: assumptions,
    });

    expect(withGuarantee.months[0].creditDrawNis).toBeGreaterThan(withoutGuarantee.months[0].creditDrawNis);
  });
});

describe("כאשר נותר הון עצמי, הוצאת הערבות משתמשת בו לפני אשראי", () => {
  it("equityInjectionNis>0 ו-creditDrawNis=0 כשההון מכסה את הוצאת הערבות", () => {
    const operatingMonths = [operatingMonth(0, 0, 0)];
    const guaranteeSchedule = guaranteeScheduleWithMonths([0], [
      {
        kind: "kombinatsiaOwner",
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 6 },
        ownerUnitsMarketValueNis: 2_000_000,
        startMonthIndex: 0,
      },
    ]);
    const assumptions: InterestCashFlowAssumptions = { ...BASE_ASSUMPTIONS, equityCapNis: 50_000, minimumCashBalanceNis: 0 };

    const financed = computeFinancedCashFlow({ operatingMonths, guaranteeSchedule, interestAssumptions: assumptions });

    expect(financed.months[0].guaranteeExpenseNis).toBeGreaterThan(0);
    expect(financed.months[0].guaranteeExpenseNis).toBeLessThanOrEqual(50_000);
    expect(financed.months[0].equityInjectionNis).toBeGreaterThan(0);
    expect(financed.months[0].creditDrawNis).toBe(0);
  });
});

describe("הוצאת ערבות יכולה ליצור גירעון מימון כאשר המסגרת מוצתה", () => {
  it("fundingDeficitBalanceNis>0 ו-facilityExceeded=true כשהמסגרת קטנה מדי", () => {
    const operatingMonths = [operatingMonth(0, 0, 0)];
    const guaranteeSchedule = guaranteeScheduleWithMonths([0], [
      {
        kind: "kombinatsiaOwner",
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 6 },
        ownerUnitsMarketValueNis: 2_000_000,
        startMonthIndex: 0,
      },
    ]);
    const assumptions: InterestCashFlowAssumptions = { equityCapNis: 0, minimumCashBalanceNis: 10_000, creditFacilityLimitNis: 1_000, annualInterestRate: 0.06 };

    const financed = computeFinancedCashFlow({ operatingMonths, guaranteeSchedule, interestAssumptions: assumptions });

    expect(financed.months[0].fundingDeficitBalanceNis).toBeGreaterThan(0);
    expect(financed.facilityExceeded).toBe(true);
  });
});

describe("הוצאת הערבות משפיעה על הריבית דרך הגדלת החוב", () => {
  it("אותה עסקה עם ערבות מייצרת ריבית גבוהה יותר מבלי ערבות", () => {
    const operatingMonths = [operatingMonth(0, 0, 500_000), operatingMonth(1, 0, 0)];
    const assumptions: InterestCashFlowAssumptions = { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 5_000_000, annualInterestRate: 0.06 };

    const withoutGuarantee = computeFinancedCashFlow({
      operatingMonths,
      guaranteeSchedule: computeGuaranteeSchedule({ monthIndices: [0, 1], instances: [] }),
      interestAssumptions: assumptions,
    });
    const withGuarantee = computeFinancedCashFlow({
      operatingMonths,
      guaranteeSchedule: guaranteeScheduleWithMonths([0, 1], [
        {
          kind: "kombinatsiaOwner",
          mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 6 },
          ownerUnitsMarketValueNis: 1_000_000,
          startMonthIndex: 0,
        },
      ]),
      interestAssumptions: assumptions,
    });

    expect(withGuarantee.months[1].interestExpenseNis).toBeGreaterThan(withoutGuarantee.months[1].interestExpenseNis);
  });
});

describe("אין חיוב כפול של אותה הוצאת ערבות", () => {
  it("totalCashOutflowsNis = operatingOutflowsNis + guaranteeExpenseNis בדיוק, לא כפול", () => {
    const operatingMonths = [operatingMonth(0, 0, 100_000)];
    const guaranteeSchedule = guaranteeScheduleWithMonths([0], [
      {
        kind: "buyerSaleLaw",
        mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 },
        monthlyEligibleBuyerReceiptsNis: [500_000],
        releaseMonthIndex: 1,
      },
    ]);
    const financed = computeFinancedCashFlow({ operatingMonths, guaranteeSchedule, interestAssumptions: BASE_ASSUMPTIONS });
    const m0 = financed.months[0];
    expect(m0.totalCashOutflowsNis).toBeCloseTo(m0.operatingOutflowsNis + m0.guaranteeExpenseNis, 6);
    expect(m0.guaranteeExpenseNis).toBeCloseTo(500_000 * (0.0085 / 12), 6);
  });
});

describe("שני מנגנוני ערבות באותו חודש נכנסים פעם אחת בלבד", () => {
  it("guaranteeExpenseNis = סכום שני המנגנונים, לא כל אחד בנפרד ולא כפול", () => {
    const operatingMonths = [operatingMonth(0, 0, 0)];
    const guaranteeSchedule = guaranteeScheduleWithMonths([0], [
      {
        kind: "buyerSaleLaw",
        mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 },
        monthlyEligibleBuyerReceiptsNis: [300_000],
        releaseMonthIndex: 1,
      },
      {
        kind: "kombinatsiaOwner",
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 6 },
        ownerUnitsMarketValueNis: 2_000_000,
        startMonthIndex: 0,
      },
    ]);
    const financed = computeFinancedCashFlow({ operatingMonths, guaranteeSchedule, interestAssumptions: { ...BASE_ASSUMPTIONS, creditFacilityLimitNis: 5_000_000 } });
    const expectedExpense = 300_000 * (0.0085 / 12) + 2_000_000 * (0.01 / 12);
    expect(financed.months[0].guaranteeExpenseNis).toBeCloseTo(expectedExpense, 6);
  });
});

describe("לוח חודשים חסר/עודף/כפול נדחה", () => {
  it("חודש חסר בלוח הערבויות נדחה", () => {
    const operatingMonths = [operatingMonth(0, 0, 0), operatingMonth(1, 0, 0)];
    const guaranteeSchedule = zeroGuaranteeSchedule();
    const truncated: GuaranteeScheduleResult = { ...guaranteeSchedule, months: guaranteeSchedule.months.filter((m) => m.monthIndex !== 1).slice(0, 2) };
    expect(() =>
      computeFinancedCashFlow({ operatingMonths, guaranteeSchedule: truncated, interestAssumptions: BASE_ASSUMPTIONS })
    ).toThrow();
  });

  it("חודש עודף בלוח הערבויות נדחה", () => {
    const operatingMonths = [operatingMonth(0, 0, 0)];
    const full = zeroGuaranteeSchedule(); // מכסה חודשים 0-5, יותר מדי ביחס ל-operatingMonths של חודש 0 בלבד
    expect(() =>
      computeFinancedCashFlow({ operatingMonths, guaranteeSchedule: full, interestAssumptions: BASE_ASSUMPTIONS })
    ).toThrow();
  });

  it("חודש כפול בלוח הערבויות נדחה", () => {
    const operatingMonths = [operatingMonth(0, 0, 0), operatingMonth(1, 0, 0)];
    const base = zeroGuaranteeSchedule();
    const duplicated: GuaranteeScheduleResult = {
      ...base,
      months: [base.months[0], base.months[0]], // אותו monthIndex=0 פעמיים
    };
    expect(() =>
      computeFinancedCashFlow({ operatingMonths, guaranteeSchedule: duplicated, interestAssumptions: BASE_ASSUMPTIONS })
    ).toThrow();
  });

  it("ציר operatingMonths לא רציף נדחה", () => {
    const operatingMonths = [operatingMonth(0, 0, 0), operatingMonth(2, 0, 0)];
    expect(() =>
      computeFinancedCashFlow({ operatingMonths, guaranteeSchedule: zeroGuaranteeSchedule(), interestAssumptions: BASE_ASSUMPTIONS })
    ).toThrow();
  });
});

describe("התאמה לפי monthIndex, לא לפי מיקום במערך", () => {
  it("guaranteeSchedule.months בסדר הפוך מפיק תוצאה זהה לסדר הרגיל", () => {
    const operatingMonths = [operatingMonth(0, 0, 100_000), operatingMonth(1, 0, 50_000), operatingMonth(2, 0, 0)];
    const guaranteeSchedule = guaranteeScheduleWithMonths([0, 1, 2], [
      {
        kind: "buyerSaleLaw",
        mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 },
        monthlyEligibleBuyerReceiptsNis: [200_000, 100_000, 0],
        releaseMonthIndex: 3,
      },
    ]);
    const reversed: GuaranteeScheduleResult = { ...guaranteeSchedule, months: [...guaranteeSchedule.months].reverse() };

    const normal = computeFinancedCashFlow({ operatingMonths, guaranteeSchedule, interestAssumptions: BASE_ASSUMPTIONS });
    const withReversed = computeFinancedCashFlow({ operatingMonths, guaranteeSchedule: reversed, interestAssumptions: BASE_ASSUMPTIONS });

    expect(withReversed.months.map((m) => m.monthIndex)).toEqual([0, 1, 2]); // סדר הפלט = סדר operatingMonths
    withReversed.months.forEach((m, i) => {
      expect(m.guaranteeExpenseNis).toBeCloseTo(normal.months[i].guaranteeExpenseNis, 6);
      expect(m.closingCashBalanceNis).toBeCloseTo(normal.months[i].closingCashBalanceNis, 6);
    });
  });
});

describe("activeBeyondForecast מועבר לסיכום", () => {
  it("activeGuaranteesBeyondForecast משקף את guaranteeSchedule.activeBeyondForecast", () => {
    const operatingMonths = [operatingMonth(0, 0, 0), operatingMonth(1, 0, 0)];
    const guaranteeSchedule = guaranteeScheduleWithMonths([0, 1], [
      {
        kind: "kombinatsiaOwner",
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 36 }, // חורג מציר [0,1]
        ownerUnitsMarketValueNis: 1_000_000,
        startMonthIndex: 0,
      },
    ]);
    expect(guaranteeSchedule.activeBeyondForecast).toBe(true); // הנחת יסוד של הבדיקה

    const financed = computeFinancedCashFlow({ operatingMonths, guaranteeSchedule, interestAssumptions: BASE_ASSUMPTIONS });
    expect(financed.activeGuaranteesBeyondForecast).toBe(true);
  });
});

describe("התאמות המזומן והחוב מתקיימות", () => {
  it("closingCash/closingDebt לפי הנוסחאות המדויקות, opening נגזר מהחודש הקודם", () => {
    const operatingMonths = [
      operatingMonth(0, 0, 400_000),
      operatingMonth(1, 100_000, 150_000),
      operatingMonth(2, 400_000, 50_000),
      operatingMonth(3, 0, 0),
      operatingMonth(4, 300_000, 10_000),
    ];
    const guaranteeSchedule = guaranteeScheduleWithMonths([0, 1, 2, 3, 4], [
      {
        kind: "buyerSaleLaw",
        mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 },
        monthlyEligibleBuyerReceiptsNis: [50_000, 0, 100_000, 0, 0],
        releaseMonthIndex: 5,
      },
    ]);
    const assumptions: InterestCashFlowAssumptions = { equityCapNis: 200_000, minimumCashBalanceNis: 10_000, creditFacilityLimitNis: 300_000, annualInterestRate: 0.06 };

    const result = computeFinancedCashFlow({ operatingMonths, guaranteeSchedule, interestAssumptions: assumptions });

    let openingCash = 0;
    let openingDebt = 0;
    for (const m of result.months) {
      const expectedClosingCash =
        openingCash + m.operatingInflowsNis + m.equityInjectionNis + m.creditDrawNis - m.operatingOutflowsNis - m.guaranteeExpenseNis - m.creditRepaymentNis;
      expect(m.closingCashBalanceNis).toBeCloseTo(expectedClosingCash, 6);

      const expectedClosingDebt = openingDebt + m.creditDrawNis + m.interestExpenseNis - m.creditRepaymentNis;
      expect(m.closingDebtBalanceNis).toBeCloseTo(expectedClosingDebt, 6);

      openingCash = m.closingCashBalanceNis;
      openingDebt = m.closingDebtBalanceNis;
    }
  });
});

describe("אין מוטציה של הקלט", () => {
  it("operatingMonths ו-guaranteeSchedule לא משתנים אחרי הקריאה", () => {
    const operatingMonths = [operatingMonth(0, 100_000, 50_000), operatingMonth(1, 0, 0)];
    const guaranteeSchedule = guaranteeScheduleWithMonths([0, 1], [
      {
        kind: "kombinatsiaOwner",
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 6 },
        ownerUnitsMarketValueNis: 1_000_000,
        startMonthIndex: 0,
      },
    ]);
    const input: FinancedCashFlowInput = { operatingMonths, guaranteeSchedule, interestAssumptions: BASE_ASSUMPTIONS };
    const snapshot = JSON.parse(JSON.stringify(input));

    computeFinancedCashFlow(input);

    expect(input).toEqual(snapshot);
  });
});

describe("אין NaN/Infinity, בתרחיש מלא", () => {
  it("כל השדות המספריים סופיים", () => {
    const operatingMonths = [
      operatingMonth(0, 0, 400_000),
      operatingMonth(1, 100_000, 150_000),
      operatingMonth(2, 400_000, 50_000),
    ];
    const guaranteeSchedule = guaranteeScheduleWithMonths([0, 1, 2], [
      {
        kind: "buyerSaleLaw",
        mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 },
        monthlyEligibleBuyerReceiptsNis: [50_000, 100_000, 0],
        releaseMonthIndex: 3,
      },
      {
        kind: "kombinatsiaOwner",
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 2 },
        ownerUnitsMarketValueNis: 1_000_000,
        startMonthIndex: 0,
      },
    ]);
    const result = computeFinancedCashFlow({
      operatingMonths,
      guaranteeSchedule,
      interestAssumptions: { equityCapNis: 50_000, minimumCashBalanceNis: 10_000, creditFacilityLimitNis: 200_000, annualInterestRate: 0.08 },
    });

    for (const m of result.months) {
      for (const value of Object.values(m)) {
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(Number.isFinite(result.totalOperatingOutflowsNis)).toBe(true);
    expect(Number.isFinite(result.totalGuaranteeExpenseNis)).toBe(true);
    expect(Number.isFinite(result.totalInterestExpenseNis)).toBe(true);
    expect(Number.isFinite(result.peakClosingDebtBalanceNis)).toBe(true);
    expect(Number.isFinite(result.peakFundingDeficitNis)).toBe(true);
  });
});

// עוזר: בונה GuaranteeScheduleResult אמיתי (דרך computeGuaranteeSchedule עצמו, לא בנייה ידנית) על
// ציר monthIndices נתון - נוח לתרחישים עם ציר קצר יותר מ-MONTH_INDICES המלא
function guaranteeScheduleWithMonths(monthIndices: number[], instances: GuaranteeInstanceInput[]): GuaranteeScheduleResult {
  return computeGuaranteeSchedule({ monthIndices, instances });
}
