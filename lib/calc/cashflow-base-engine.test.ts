import { describe, expect, it } from "vitest";
import { computeBaseCashFlow } from "./cashflow-base-engine";
import type { BaseCashFlowAssumptions, BaseCashFlowMonthInput } from "./cashflow-base-engine";

function month(monthIndex: number, inflowsNis: number, outflowsNis: number): BaseCashFlowMonthInput {
  return { monthIndex, inflowsNis, outflowsNis, phases: ["construction"] };
}

/** בודקת את שתי משוואות ההתאמה (מזומן+חוב) בכל חודש, בדיוק כמו שהוגדרו בביקורת */
function assertReconciliation(months: ReturnType<typeof computeBaseCashFlow>["months"]) {
  for (const m of months) {
    expect(m.openingCashBalanceNis + m.inflowsNis + m.equityInjectionNis + m.creditDrawNis - m.outflowsNis - m.creditRepaymentNis).toBeCloseTo(
      m.closingCashBalanceNis,
      9
    );
    expect(m.openingDebtBalanceNis + m.creditDrawNis - m.creditRepaymentNis).toBeCloseTo(m.closingDebtBalanceNis, 9);
  }
}

describe("דוגמה מספרית של שלושה חודשים (הון עצמי מוצה -> אשראי -> תקבול גדול פורע)", () => {
  const assumptions: BaseCashFlowAssumptions = { equityCapNis: 200_000, minimumCashBalanceNis: 0, creditFacilityLimitNis: 300_000 };
  const monthlyInputs: BaseCashFlowMonthInput[] = [month(0, 0, 400_000), month(1, 100_000, 150_000), month(2, 400_000, 50_000)];
  const result = computeBaseCashFlow(monthlyInputs, assumptions);

  it("חודש 0: הון עצמי מוזרם עד לתקרה (200,000), השארית (200,000) נמשכת מהמסגרת", () => {
    const m0 = result.months[0];
    expect(m0.equityInjectionNis).toBe(200_000);
    expect(m0.creditDrawNis).toBe(200_000);
    expect(m0.closingCashBalanceNis).toBe(0);
    expect(m0.closingDebtBalanceNis).toBe(200_000);
    expect(m0.fundingShortfallNis).toBe(0);
  });

  it("חודש 1: תקרת ההון העצמי מוצתה, כל החוסר נמשך מהמסגרת שנותרה", () => {
    const m1 = result.months[1];
    expect(m1.openingDebtBalanceNis).toBe(200_000);
    expect(m1.equityInjectionNis).toBe(0); // אין עוד תקרה
    expect(m1.creditDrawNis).toBe(50_000); // 100,000-150,000=-50,000 מחסור, מסגרת שנותרה=300,000-200,000=100,000
    expect(m1.closingDebtBalanceNis).toBe(250_000);
    expect(m1.fundingShortfallNis).toBe(0);
  });

  it("חודש 2: תקבול גדול פורע את מלוא החוב הקיים, לא יותר", () => {
    const m2 = result.months[2];
    expect(m2.creditRepaymentNis).toBe(250_000); // כל החוב, לא כל העודף (350,000)
    expect(m2.closingDebtBalanceNis).toBe(0);
    expect(m2.closingCashBalanceNis).toBe(100_000); // 350,000 עודף - 250,000 פירעון
  });

  it("התאמות מזומן וחוב מתקיימות בכל שלושת החודשים", () => {
    assertReconciliation(result.months);
  });

  it("totalEquityInjectedNis, peakDebtBalanceNis, peakDebtMonthIndex נכונים", () => {
    expect(result.totalEquityInjectedNis).toBe(200_000);
    expect(result.peakDebtBalanceNis).toBe(250_000);
    expect(result.peakDebtMonthIndex).toBe(1);
    expect(result.facilityExceeded).toBe(false);
  });
});

describe("ללא הון עצמי (equityCapNis=0)", () => {
  it("כל הצורך נמשך מהמסגרת, אין הזרמת הון בכלל", () => {
    const result = computeBaseCashFlow([month(0, 0, 100_000)], { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 500_000 });
    expect(result.months[0].equityInjectionNis).toBe(0);
    expect(result.months[0].creditDrawNis).toBe(100_000);
    expect(result.months[0].fundingShortfallNis).toBe(0);
  });
});

describe("מימון מלא מהון עצמי (מסגרת גדולה מספיק, אבל בפועל לא נדרש אשראי)", () => {
  it("הון עצמי מכסה הכל, אין משיכת אשראי", () => {
    const result = computeBaseCashFlow([month(0, 0, 100_000)], { equityCapNis: 500_000, minimumCashBalanceNis: 0, creditFacilityLimitNis: 500_000 });
    expect(result.months[0].equityInjectionNis).toBe(100_000);
    expect(result.months[0].creditDrawNis).toBe(0);
    expect(result.months[0].closingDebtBalanceNis).toBe(0);
  });
});

describe("מימון משולב (הון עצמי חלקי + אשראי לשארית)", () => {
  it("הזרמת הון בדיוק עד לתקרה, השארית מהמסגרת", () => {
    const result = computeBaseCashFlow([month(0, 0, 100_000)], { equityCapNis: 40_000, minimumCashBalanceNis: 0, creditFacilityLimitNis: 500_000 });
    expect(result.months[0].equityInjectionNis).toBe(40_000);
    expect(result.months[0].creditDrawNis).toBe(60_000);
  });
});

describe("מסגרת אשראי קטנה מדי -> חוסר מימון גלוי, לא מומצא כסף", () => {
  it("fundingShortfallNis > 0 כשההון+המסגרת לא מספיקים, יתרת מזומן שלילית משקפת זאת ישירות", () => {
    const result = computeBaseCashFlow([month(0, 0, 100_000)], { equityCapNis: 10_000, minimumCashBalanceNis: 0, creditFacilityLimitNis: 20_000 });
    const m0 = result.months[0];
    expect(m0.equityInjectionNis).toBe(10_000);
    expect(m0.creditDrawNis).toBe(20_000);
    expect(m0.fundingShortfallNis).toBe(70_000); // 100,000 - 10,000 - 20,000
    expect(m0.closingCashBalanceNis).toBe(-70_000); // לא אופס באופן מלאכותי
    expect(result.facilityExceeded).toBe(true);
  });
});

describe("חוסר מימון מצטבר עובר לחודש הבא", () => {
  it("יתרת המזומן השלילית של חודש 0 היא יתרת הפתיחה של חודש 1", () => {
    const result = computeBaseCashFlow(
      [month(0, 0, 100_000), month(1, 0, 0)],
      { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 0 }
    );
    expect(result.months[0].closingCashBalanceNis).toBe(-100_000);
    expect(result.months[1].openingCashBalanceNis).toBe(-100_000);
    expect(result.months[1].fundingShortfallNis).toBe(100_000); // עדיין באותו חוסר, כי אין תקבולים חדשים
  });
});

describe("תקבולים מאוחרים שסוגרים חוסר ומאפשרים פירעון (ר' דוגמת 3 החודשים למעלה)", () => {
  it("חוב שנוצר מוקדם נפרע במלואו כשמגיע תקבול גדול מספיק", () => {
    const result = computeBaseCashFlow(
      [month(0, 0, 200_000), month(1, 300_000, 0)],
      { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 200_000 }
    );
    expect(result.months[0].closingDebtBalanceNis).toBe(200_000);
    expect(result.months[1].creditRepaymentNis).toBe(200_000);
    expect(result.months[1].closingDebtBalanceNis).toBe(0);
    expect(result.months[1].closingCashBalanceNis).toBe(100_000); // 300,000-200,000 פירעון
  });
});

describe("תקבולים מוקדמים שמונעים חוב מלכתחילה", () => {
  it("אין משיכת אשראי כשהתקבולים המוקדמים מכסים את התשלומים", () => {
    const result = computeBaseCashFlow(
      [month(0, 500_000, 100_000), month(1, 0, 100_000)],
      { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 1_000_000 }
    );
    expect(result.months[0].creditDrawNis).toBe(0);
    expect(result.months[1].creditDrawNis).toBe(0); // יתרת המזומן מחודש 0 (400,000) מכסה
    expect(result.peakDebtBalanceNis).toBe(0);
  });
});

describe("שמירת כרית מזומן מינימלית", () => {
  it("הזרמת הון/אשראי מביאה למינימום בדיוק, לא לאפס", () => {
    const result = computeBaseCashFlow([month(0, 0, 100_000)], { equityCapNis: 200_000, minimumCashBalanceNis: 50_000, creditFacilityLimitNis: 0 });
    expect(result.months[0].equityInjectionNis).toBe(150_000); // 100,000 גירעון + 50,000 כרית
    expect(result.months[0].closingCashBalanceNis).toBe(50_000);
  });

  it("פירעון עוצר בדיוק במינימום, לא מרוקן את הכרית", () => {
    const result = computeBaseCashFlow(
      [month(0, 0, 100_000), month(1, 300_000, 0)],
      { equityCapNis: 100_000, minimumCashBalanceNis: 20_000, creditFacilityLimitNis: 0 }
    );
    // חודש 0: גירעון 100,000+20,000 כרית=120,000, אך התקרה 100,000 -> הון 100,000, שארית 20,000 fundingShortfall (אין מסגרת)
    expect(result.months[0].fundingShortfallNis).toBe(20_000);
    const m1 = result.months[1];
    expect(m1.closingCashBalanceNis).toBeGreaterThanOrEqual(20_000 - 1e-6);
  });
});

describe("פירעון שאינו עולה על יתרת החוב", () => {
  it("עודף מזומן גדול בהרבה מהחוב פורע רק את החוב, לא מעבר", () => {
    const result = computeBaseCashFlow(
      [month(0, 0, 100_000), month(1, 10_000_000, 0)],
      { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 100_000 }
    );
    const m1 = result.months[1];
    expect(m1.creditRepaymentNis).toBe(100_000); // לא 10,000,000
    expect(m1.closingDebtBalanceNis).toBe(0);
    expect(m1.closingCashBalanceNis).toBe(9_900_000);
  });
});

describe("מסגרת אשראי 0", () => {
  it("אין משיכת אשראי בשום חודש, כל הפער עובר ל-fundingShortfallNis", () => {
    const result = computeBaseCashFlow([month(0, 0, 50_000)], { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 0 });
    expect(result.months[0].creditDrawNis).toBe(0);
    expect(result.months[0].fundingShortfallNis).toBe(50_000);
  });
});

describe("חודשים לא רציפים/כפולים/לא ממוינים - נדחים, לא מתוקנים בשקט", () => {
  const assumptions: BaseCashFlowAssumptions = { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 0 };

  it("דוחה חודשים לא רציפים (פער)", () => {
    expect(() => computeBaseCashFlow([month(0, 0, 0), month(2, 0, 0)], assumptions)).toThrow();
  });

  it("דוחה חודשים כפולים", () => {
    expect(() => computeBaseCashFlow([month(0, 0, 0), month(0, 0, 0)], assumptions)).toThrow();
  });

  it("דוחה חודשים לא ממוינים", () => {
    expect(() => computeBaseCashFlow([month(1, 0, 0), month(0, 0, 0)], assumptions)).toThrow();
  });
});

describe("ולידציה: NaN/Infinity/סכומים שליליים", () => {
  const assumptions: BaseCashFlowAssumptions = { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 0 };

  it("דוחה inflowsNis לא סופי", () => {
    expect(() => computeBaseCashFlow([month(0, NaN, 0)], assumptions)).toThrow();
    expect(() => computeBaseCashFlow([month(0, Infinity, 0)], assumptions)).toThrow();
  });

  it("דוחה outflowsNis שלילי", () => {
    expect(() => computeBaseCashFlow([month(0, 0, -1)], assumptions)).toThrow();
  });

  it("דוחה assumptions שליליות/לא סופיות", () => {
    expect(() => computeBaseCashFlow([month(0, 0, 0)], { ...assumptions, equityCapNis: -1 })).toThrow();
    expect(() => computeBaseCashFlow([month(0, 0, 0)], { ...assumptions, creditFacilityLimitNis: Infinity })).toThrow();
  });

  it("דוחה מערך קלט ריק", () => {
    expect(() => computeBaseCashFlow([], assumptions)).toThrow();
  });
});

describe("אי-מוטציה של הקלט", () => {
  it("monthlyInputs ו-assumptions לא משתנים אחרי הקריאה", () => {
    const monthlyInputs: BaseCashFlowMonthInput[] = [month(0, 100, 200), month(1, 300, 100)];
    const assumptions: BaseCashFlowAssumptions = { equityCapNis: 50, minimumCashBalanceNis: 0, creditFacilityLimitNis: 100 };
    const inputsSnapshot = JSON.parse(JSON.stringify(monthlyInputs));
    const assumptionsSnapshot = JSON.parse(JSON.stringify(assumptions));

    computeBaseCashFlow(monthlyInputs, assumptions);

    expect(monthlyInputs).toEqual(inputsSnapshot);
    expect(assumptions).toEqual(assumptionsSnapshot);
  });

  it("שינוי ב-phases של הפלט לא משפיע על מערך הקלט (עותק, לא alias)", () => {
    const inputPhases = ["construction"] as const;
    const monthlyInputs: BaseCashFlowMonthInput[] = [{ monthIndex: 0, inflowsNis: 0, outflowsNis: 0, phases: [...inputPhases] }];
    const result = computeBaseCashFlow(monthlyInputs, { equityCapNis: 0, minimumCashBalanceNis: 0, creditFacilityLimitNis: 0 });
    result.months[0].phases.push("marketing");
    expect(monthlyInputs[0].phases).toEqual(["construction"]);
  });
});

describe("התאמות מזומן וחוב בכל חודש, על פני תרחיש מגוון עם חוסר מימון וחזרה לעודף", () => {
  it("שמורות בכל חודש לאורך תרחיש מלא", () => {
    const monthlyInputs: BaseCashFlowMonthInput[] = [
      month(0, 0, 300_000),
      month(1, 50_000, 200_000),
      month(2, 20_000, 20_000),
      month(3, 600_000, 30_000),
      month(4, 10_000, 10_000),
    ];
    const result = computeBaseCashFlow(monthlyInputs, { equityCapNis: 100_000, minimumCashBalanceNis: 10_000, creditFacilityLimitNis: 250_000 });
    assertReconciliation(result.months);
  });
});
