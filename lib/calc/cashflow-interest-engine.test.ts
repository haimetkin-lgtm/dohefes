import { describe, expect, it } from "vitest";
import { computeInterestCashFlow } from "./cashflow-interest-engine";
import type { InterestCashFlowAssumptions, InterestCashFlowMonthInput } from "./cashflow-interest-engine";

function month(monthIndex: number, inflowsNis: number, outflowsNis: number): InterestCashFlowMonthInput {
  return { monthIndex, inflowsNis, outflowsNis, phases: ["construction"] };
}

/** התאמת מזומן (כמו commit 4, בלי ריבית) והתאמת חוב (כולל ריבית, ר' דרישת הביקורת) */
function assertReconciliation(months: ReturnType<typeof computeInterestCashFlow>["months"]) {
  for (const m of months) {
    expect(m.openingCashBalanceNis + m.inflowsNis + m.equityInjectionNis + m.creditDrawNis - m.outflowsNis - m.creditRepaymentNis).toBeCloseTo(
      m.closingCashBalanceNis,
      6
    );
    expect(m.openingDebtBalanceNis + m.creditDrawNis + m.interestExpenseNis - m.creditRepaymentNis).toBeCloseTo(m.closingDebtBalanceNis, 6);
  }
}

describe("ריבית חודשית: 6% שנתי = 0.5% לחודש", () => {
  it("monthlyInterestRate מחושב נכון ומוצג בכל חודש", () => {
    const result = computeInterestCashFlow([month(0, 0, 0)], {
      equityCapNis: 0,
      minimumCashBalanceNis: 0,
      creditFacilityLimitNis: 1_000_000,
      annualInterestRate: 0.06,
    });
    expect(result.months[0].annualInterestRate).toBe(0.06);
    expect(result.months[0].monthlyInterestRate).toBeCloseTo(0.005, 10);
  });
});

describe("חוב אפס -> ריבית אפס", () => {
  it("אין ריבית כשאין חוב בכלל", () => {
    const result = computeInterestCashFlow([month(0, 100_000, 0)], {
      equityCapNis: 0,
      minimumCashBalanceNis: 0,
      creditFacilityLimitNis: 1_000_000,
      annualInterestRate: 0.06,
    });
    expect(result.months[0].closingDebtBeforeInterestNis).toBe(0);
    expect(result.months[0].interestExpenseNis).toBe(0);
  });
});

describe("הדוגמה המתועדת: 1,000,000 חוב + 300,000 משיכה -> 6,500 ריבית", () => {
  it("מתאים בדיוק לחישוב היד במסמך התכנון", () => {
    // המנוע מתחיל תמיד מחוב 0 בחודש הראשון, ומחשב ריבית על אותו חודש שבו הוא נמשך - אין דרך
    // "להזריק" יתרת פתיחה נקייה של 1,000,000 בלי שגם עליה כבר חלה ריבית בחודש שנוצרה בו.
    // לכן בונים את שני המרכיבים (1,000,000 הקיים + 300,000 המשיכה החדשה) כמשיכה אחת מצטברת
    // של 1,300,000 בתוך אותו חודש - זה בדיוק הבסיס לחישוב הריבית שהדוגמה מתארת.
    const assumptions: InterestCashFlowAssumptions = {
      equityCapNis: 0,
      minimumCashBalanceNis: 0,
      creditFacilityLimitNis: 5_000_000,
      annualInterestRate: 0.06,
    };
    const result = computeInterestCashFlow([month(0, 0, 1_300_000)], assumptions);
    const m0 = result.months[0];
    expect(m0.creditDrawNis).toBe(1_300_000);
    expect(m0.closingDebtBeforeInterestNis).toBe(1_300_000);
    expect(m0.interestExpenseNis).toBe(6_500);
    expect(m0.closingDebtBalanceNis).toBe(1_306_500);
  });
});

describe("פירעון מלא לפני חישוב הריבית -> ריבית אפס", () => {
  it("כשתקבול גדול פורע את כל החוב, אין ריבית על מה שכבר נפרע", () => {
    const result = computeInterestCashFlow(
      [month(0, 0, 200_000), month(1, 500_000, 0)],
      { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 300_000, annualInterestRate: 0.06 }
    );
    const m1 = result.months[1];
    expect(m1.creditRepaymentNis).toBe(m1.openingDebtBalanceNis); // פירעון מלא
    expect(m1.closingDebtBeforeInterestNis).toBe(0);
    expect(m1.interestExpenseNis).toBe(0);
    expect(m1.closingDebtBalanceNis).toBe(0);
  });
});

describe("הריבית מצטברת לחוב בחודשים עוקבים (ריבית-דריבית)", () => {
  it("יתרת הפתיחה של החודש הבא כוללת את הריבית שהתווספה בחודש הקודם", () => {
    const result = computeInterestCashFlow(
      [month(0, 0, 1_000_000), month(1, 0, 0), month(2, 0, 0)],
      { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 5_000_000, annualInterestRate: 0.06 }
    );
    const m0 = result.months[0];
    const m1 = result.months[1];
    expect(m1.openingDebtBalanceNis).toBe(m0.closingDebtBalanceNis); // כולל את הריבית מחודש 0
    expect(m1.interestExpenseNis).toBeGreaterThan(0);
    expect(m1.closingDebtBalanceNis).toBeGreaterThan(m1.openingDebtBalanceNis); // ריבית-דריבית: גדל עוד
  });
});

describe("המסגרת מגבילה מראש את המשיכה כדי להשאיר מקום לריבית", () => {
  it("המשיכה לא מגיעה לתקרה הגולמית - יש רזרבה בדיוק לריבית שתתווסף", () => {
    const facilityLimit = 300_000;
    const annualInterestRate = 0.06;
    const result = computeInterestCashFlow([month(0, 0, 10_000_000)], {
      equityCapNis: 0,
      minimumCashBalanceNis: 0,
      creditFacilityLimitNis: facilityLimit,
      annualInterestRate,
    });
    const m0 = result.months[0];
    // אחרי הריבית, יתרת הסגירה בדיוק שווה למסגרת (לא חורגת, גם לא משאירה רזרבה מיותרת)
    expect(m0.closingDebtBalanceNis).toBeCloseTo(facilityLimit, 6);
    expect(m0.creditDrawNis).toBeLessThan(facilityLimit); // המשיכה עצמה קטנה מהמסגרת הגולמית
    expect(m0.facilityBreachNis).toBeCloseTo(0, 6); // עלול לצבור שארית זניחה מנקודה צפה, לא חריגה אמיתית
  });
});

describe("ריבית מהוונת אינה גורמת לחריגה שקטה מהמסגרת (משיכה חדשה)", () => {
  it("closingDebtBalanceNis לעולם לא עולה על המסגרת כשהחריגה מקורה במשיכה חדשה", () => {
    const facilityLimit = 500_000;
    const result = computeInterestCashFlow([month(0, 0, 2_000_000)], {
      equityCapNis: 0,
      minimumCashBalanceNis: 0,
      creditFacilityLimitNis: facilityLimit,
      annualInterestRate: 0.12,
    });
    expect(result.months[0].closingDebtBalanceNis).toBeLessThanOrEqual(facilityLimit + 1e-6);
  });
});

describe("ריבית על חוב פתיחה קרוב מדי למסגרת -> חריגה מדווחת, לא מוסתרת", () => {
  it("facilityBreachNis>0 כשריבית לבדה (בלי משיכה חדשה) דוחפת מעל המסגרת", () => {
    // חודש 0: משיכה שממצה את התקרה המותאמת-ריבית (facility=300,000, קרוב לתקרה בפועל)
    // חודש 1: בלי פעילות תפעולית כלל, אבל הריבית על יתרת הפתיחה כשלעצמה עלולה לדחוף מעל 300,000
    const assumptions: InterestCashFlowAssumptions = {
      equityCapNis: 0,
      minimumCashBalanceNis: 0,
      creditFacilityLimitNis: 300_000,
      annualInterestRate: 0.06,
    };
    const result = computeInterestCashFlow([month(0, 0, 10_000_000), month(1, 0, 0)], assumptions);
    const m0 = result.months[0];
    const m1 = result.months[1];
    // חודש 0 כבר מגיע בדיוק לתקרה (300,000) אחרי ריבית - חודש 1 בלי פעילות: יתרת הפתיחה כבר במקסימום,
    // הריבית עליה (עוד כ-1,500) חייבת לדחוף את יתרת הסגירה מעל 300,000 - זו בדיוק חריגת-ריבית-בלבד
    expect(m0.closingDebtBalanceNis).toBeCloseTo(300_000, 6);
    expect(m1.creditDrawNis).toBe(0); // אין משיכה חדשה כלל
    expect(m1.interestExpenseNis).toBeGreaterThan(0);
    expect(m1.closingDebtBalanceNis).toBeGreaterThan(300_000);
    expect(m1.facilityBreachNis).toBeGreaterThan(0);
    expect(result.facilityExceeded).toBe(true);
    // לא NaN, לא "מוצג כתקין" - הערך חשוף וסופי
    expect(Number.isFinite(m1.facilityBreachNis)).toBe(true);
  });
});

describe("תקבול מאוחר פורע חוב הכולל ריבית שנצברה", () => {
  it("הפירעון מכסה גם את הקרן וגם את הריבית שהתווספה", () => {
    const result = computeInterestCashFlow(
      [month(0, 0, 1_000_000), month(1, 0, 0), month(2, 2_000_000, 0)],
      { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 5_000_000, annualInterestRate: 0.06 }
    );
    const m2 = result.months[2];
    expect(m2.openingDebtBalanceNis).toBeGreaterThan(1_000_000); // כולל ריבית שהצטברה
    expect(m2.creditRepaymentNis).toBe(m2.openingDebtBalanceNis + 0); // כל היתרה נפרעת (אין משיכה החודש)
    expect(m2.closingDebtBalanceNis).toBe(0);
  });
});

describe("שיעור ריבית 0", () => {
  it("אין ריבית בשום חודש", () => {
    const result = computeInterestCashFlow([month(0, 0, 1_000_000), month(1, 0, 0)], {
      equityCapNis: 0,
      minimumCashBalanceNis: 0,
      creditFacilityLimitNis: 5_000_000,
      annualInterestRate: 0,
    });
    expect(result.totalInterestExpenseNis).toBe(0);
    for (const m of result.months) expect(m.interestExpenseNis).toBe(0);
  });
});

describe("ולידציית annualInterestRate", () => {
  const base: InterestCashFlowAssumptions = { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 100_000, annualInterestRate: 0.06 };

  it("דוחה שיעור שלילי", () => {
    expect(() => computeInterestCashFlow([month(0, 0, 0)], { ...base, annualInterestRate: -0.01 })).toThrow();
  });

  it("דוחה שיעור לא סופי (NaN/Infinity)", () => {
    expect(() => computeInterestCashFlow([month(0, 0, 0)], { ...base, annualInterestRate: NaN })).toThrow();
    expect(() => computeInterestCashFlow([month(0, 0, 0)], { ...base, annualInterestRate: Infinity })).toThrow();
  });

  it("דוחה שיעור שנכתב כ-6 במקום 0.06 (טעות אחוז-במקום-שבר)", () => {
    expect(() => computeInterestCashFlow([month(0, 0, 0)], { ...base, annualInterestRate: 6 })).toThrow(/אחוז/);
  });

  it("מקבל שיעור 0 (תקין, לא נדחה כ'לא הוזן')", () => {
    expect(() => computeInterestCashFlow([month(0, 0, 0)], { ...base, annualInterestRate: 0 })).not.toThrow();
  });
});

describe("אין NaN/Infinity בשום שדה מוחזר, על פני תרחיש מגוון", () => {
  it("כל השדות המספריים סופיים בתרחיש עם חוסר, משיכה, ריבית ופירעון", () => {
    const result = computeInterestCashFlow(
      [month(0, 0, 500_000), month(1, 100_000, 50_000), month(2, 900_000, 20_000)],
      { equityCapNis: 50_000, minimumCashBalanceNis: 10_000, creditFacilityLimitNis: 400_000, annualInterestRate: 0.08 }
    );
    for (const m of result.months) {
      for (const value of Object.values(m)) {
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe("אי-מוטציה של הקלט", () => {
  it("monthlyInputs ו-assumptions לא משתנים אחרי הקריאה", () => {
    const monthlyInputs: InterestCashFlowMonthInput[] = [month(0, 100, 200), month(1, 300, 100)];
    const assumptions: InterestCashFlowAssumptions = { equityCapNis: 50, minimumCashBalanceNis: 0, creditFacilityLimitNis: 100, annualInterestRate: 0.06 };
    const inputsSnapshot = JSON.parse(JSON.stringify(monthlyInputs));
    const assumptionsSnapshot = JSON.parse(JSON.stringify(assumptions));

    computeInterestCashFlow(monthlyInputs, assumptions);

    expect(monthlyInputs).toEqual(inputsSnapshot);
    expect(assumptions).toEqual(assumptionsSnapshot);
  });
});

describe("משוואות ההתאמה נשארות תקינות אחרי הוספת הריבית", () => {
  it("התאמת מזומן (בלי ריבית) והתאמת חוב (עם ריבית) מתקיימות בכל חודש, בתרחיש מגוון", () => {
    const result = computeInterestCashFlow(
      [month(0, 0, 400_000), month(1, 100_000, 150_000), month(2, 400_000, 50_000), month(3, 0, 0), month(4, 300_000, 10_000)],
      { equityCapNis: 200_000, minimumCashBalanceNis: 10_000, creditFacilityLimitNis: 300_000, annualInterestRate: 0.06 }
    );
    assertReconciliation(result.months);
  });
});
