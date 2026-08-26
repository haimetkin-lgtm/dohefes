import { describe, expect, it } from "vitest";
import { computeGuaranteeSchedule } from "./cashflow-guarantees";
import type {
  BuyerSaleLawGuaranteeInput,
  GuaranteeInstanceInput,
  GuaranteeScheduleInput,
  KombinatsiaOwnerGuaranteeInput,
  UnitCompensationOwnerGuaranteeInput,
} from "./cashflow-guarantees";

const MONTH_INDICES = [0, 1, 2, 3, 4, 5];

function buyer(overrides: Partial<BuyerSaleLawGuaranteeInput> = {}): BuyerSaleLawGuaranteeInput {
  return {
    kind: "buyerSaleLaw",
    mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.0085 },
    monthlyEligibleBuyerReceiptsNis: [0, 0, 0, 0, 0, 0],
    releaseMonthIndex: 6,
    ...overrides,
  };
}

// commit 6b: אין releaseMonthIndex נפרד - נגזר מ-startMonthIndex+mechanism.durationMonths.
// ברירת המחדל כאן (durationMonths=6, startMonthIndex=0) מכסה בדיוק את כל הציר [0,6).
function kombinatsia(overrides: Partial<KombinatsiaOwnerGuaranteeInput> = {}): KombinatsiaOwnerGuaranteeInput {
  return {
    kind: "kombinatsiaOwner",
    mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 6 },
    ownerUnitsMarketValueNis: 2_000_000,
    startMonthIndex: 0,
    ...overrides,
  };
}

function unitCompensation(overrides: Partial<UnitCompensationOwnerGuaranteeInput> = {}): UnitCompensationOwnerGuaranteeInput {
  return {
    kind: "unitCompensationOwner",
    mechanism: { kind: "unitCompensationOwner", annualRateFraction: 0.0085 },
    compensationUnitValueNis: 1_500_000,
    startMonthIndex: 0,
    releaseMonthIndex: 6,
    ...overrides,
  };
}

function run(instances: GuaranteeInstanceInput[]) {
  const input: GuaranteeScheduleInput = { monthIndices: MONTH_INDICES, instances };
  return computeGuaranteeSchedule(input);
}

describe("אפס תקבולי רוכשים -> אפס ערבות רוכשים", () => {
  it("כל החודשים 0 כשכל תקבולי הרוכשים 0", () => {
    const result = run([buyer()]);
    for (const m of result.months) {
      expect(m.buyerGuaranteeBalanceNis).toBe(0);
      expect(m.buyerGuaranteeExpenseNis).toBe(0);
    }
  });
});

describe("תקבולים מצטברים מגדילים את יתרת ערבות הרוכשים", () => {
  it("היתרה מצטברת חודש אחר חודש (יתרת סגירה, כולל תקבול אותו חודש)", () => {
    const result = run([
      buyer({ monthlyEligibleBuyerReceiptsNis: [100_000, 200_000, 0, 0, 0, 0], releaseMonthIndex: 6 }),
    ]);
    expect(result.months[0].buyerGuaranteeBalanceNis).toBe(100_000);
    expect(result.months[1].buyerGuaranteeBalanceNis).toBe(300_000);
    expect(result.months[2].buyerGuaranteeBalanceNis).toBe(300_000); // אין תקבול נוסף, יתרה נשארת
    const monthlyRate = 0.0085 / 12;
    expect(result.months[1].buyerGuaranteeExpenseNis).toBeCloseTo(300_000 * monthlyRate, 6);
  });
});

describe("תקבולי יחידות תמורה אינם נכנסים לערבות הרוכשים", () => {
  it("היתרה תלויה רק ב-monthlyEligibleBuyerReceiptsNis, לא ב'הכנסה כללית' גדולה יותר", () => {
    // תרחיש: פרויקט עם הכנסה כוללת מרומזת של 5,000,000 (כולל יחידות תמורה בשווי 0 בפועל),
    // אבל תקבולי הרוכשים הזכאים בפועל מסתכמים רק ב-1,200,000 - היתרה חייבת להישאר 1,200,000,
    // לא לגלוש לכיוון המספר הגדול יותר
    const result = run([
      buyer({ monthlyEligibleBuyerReceiptsNis: [400_000, 400_000, 400_000, 0, 0, 0], releaseMonthIndex: 6 }),
    ]);
    expect(result.months[2].buyerGuaranteeBalanceNis).toBe(1_200_000);
    expect(result.months[5].buyerGuaranteeBalanceNis).toBe(1_200_000);
  });
});

describe("שחרור ערבות מפסיק את החיוב במועד הנכון (buyerSaleLaw, releaseMonthIndex מפורש)", () => {
  it("releaseMonthIndex=3 -> חודשים 0-2 צוברים, 3-5 אפס", () => {
    const result = run([
      buyer({ monthlyEligibleBuyerReceiptsNis: [100_000, 100_000, 100_000, 100_000, 100_000, 100_000], releaseMonthIndex: 3 }),
    ]);
    expect(result.months[2].buyerGuaranteeBalanceNis).toBe(300_000);
    expect(result.months[2].buyerGuaranteeExpenseNis).toBeGreaterThan(0);
    expect(result.months[3].buyerGuaranteeBalanceNis).toBe(0);
    expect(result.months[3].buyerGuaranteeExpenseNis).toBe(0);
    expect(result.months[5].buyerGuaranteeBalanceNis).toBe(0);
  });
});

describe("קומבינציה: מקור אמת יחיד לעיתוי - durationMonths, לא releaseMonthIndex נפרד (commit 6b)", () => {
  it("durationMonths אכן קובע את חודש השחרור", () => {
    const result = run([
      kombinatsia({
        ownerUnitsMarketValueNis: 2_000_000,
        startMonthIndex: 1,
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 3 },
      }),
    ]);
    // start=1, duration=3 -> פעיל בחודשים 1,2,3 (עד 1+3=4, לא כולל)
    expect(result.months[0].ownerGuaranteeBalanceNis).toBe(0);
    expect(result.months[1].ownerGuaranteeBalanceNis).toBe(2_000_000);
    expect(result.months[3].ownerGuaranteeBalanceNis).toBe(2_000_000);
    expect(result.months[4].ownerGuaranteeBalanceNis).toBe(0);
  });

  it("off-by-one: חודש ההתחלה פעיל, חודש השחרור (start+duration) אינו פעיל", () => {
    const result = run([
      kombinatsia({ startMonthIndex: 2, mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 1 } }),
    ]);
    // start=2, duration=1 -> חודש 2 פעיל, חודש 3 (=2+1) כבר לא
    expect(result.months[2].ownerGuaranteeBalanceNis).toBe(2_000_000);
    expect(result.months[3].ownerGuaranteeBalanceNis).toBe(0);
  });

  it("durationMonths=0 נדחה (חייב חיובי ממש, לא רק לא-שלילי)", () => {
    expect(() =>
      run([kombinatsia({ mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 0 } })])
    ).toThrow();
  });
  it("durationMonths שלילי נדחה", () => {
    expect(() =>
      run([kombinatsia({ mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: -1 } })])
    ).toThrow();
  });
  it("durationMonths לא שלם נדחה", () => {
    expect(() =>
      run([kombinatsia({ mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 2.5 } })])
    ).toThrow();
  });
  it("durationMonths לא סופי (NaN) נדחה", () => {
    expect(() =>
      run([kombinatsia({ mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: NaN } })])
    ).toThrow();
  });

  it("ערבות שנמשכת מעבר לציר מסומנת activeBeyondForecast, לא נזרקת שגיאה", () => {
    const result = run([
      kombinatsia({
        startMonthIndex: 4,
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 36 }, // 4+36=40, מעבר ל-lastMonth+1=6
      }),
    ]);
    expect(result.activeBeyondForecast).toBe(true);
  });

  it("סוף התחזית אינו מאפס את הערבות - החודש האחרון בציר עדיין מציג יתרה מלאה", () => {
    const result = run([
      kombinatsia({
        startMonthIndex: 0,
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 36 },
      }),
    ]);
    expect(result.months[5].ownerGuaranteeBalanceNis).toBe(2_000_000); // לא אופס בגלל סוף הציר
    expect(result.months[5].ownerGuaranteeExpenseNis).toBeGreaterThan(0);
    expect(result.activeBeyondForecast).toBe(true);
  });

  it("שחרור בדיוק ב-lastMonth+1 אינו מסומן activeBeyondForecast (בתוך הציר בדיוק, לא חורג ממנו)", () => {
    const result = run([
      kombinatsia({ startMonthIndex: 0, mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 6 } }),
    ]);
    expect(result.activeBeyondForecast).toBe(false);
    expect(result.months[5].ownerGuaranteeBalanceNis).toBe(2_000_000);
  });

  it("אין שני מקורות זמן סותרים ב-API: הטיפוס אינו כולל releaseMonthIndex עבור kombinatsiaOwner", () => {
    // בדיקת-קומפילציה, לא ריצה: אם היה עדיין קיים שדה releaseMonthIndex נפרד, השורה הבאה הייתה
    // עוברת type-check גם עם ערך סותר את durationMonths - היא לא קיימת יותר בטיפוס בכלל.
    const instance = kombinatsia({ startMonthIndex: 0 });
    expect("releaseMonthIndex" in instance).toBe(false);
  });
});

describe("ערבות בעלי קומבינציה משתמשת בבסיס שלה בלבד, לא מושפעת מתקבולי רוכשים", () => {
  it("שינוי תקבולי הרוכשים לא משפיע על יתרת הבעלים ולהפך", () => {
    const result = run([
      kombinatsia({
        ownerUnitsMarketValueNis: 2_000_000,
        startMonthIndex: 1,
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 3 },
      }),
      buyer({ monthlyEligibleBuyerReceiptsNis: [50_000, 50_000, 50_000, 50_000, 50_000, 50_000], releaseMonthIndex: 6 }),
    ]);
    expect(result.months[2].ownerGuaranteeBalanceNis).toBe(2_000_000);
    expect(result.months[2].buyerGuaranteeBalanceNis).toBe(150_000);
  });
});

describe("ערבות יחידות תמורה ללא שיעור מפורש נכשלת באופן גלוי", () => {
  it("requiresVerification -> תרומה 0 בכל חודש, מדווח ב-missingAssumptions, לא נזרקת שגיאה", () => {
    const result = run([
      unitCompensation({ mechanism: { kind: "unitCompensationOwner", annualRateFraction: "requiresVerification" }, compensationUnitValueNis: 1_500_000 }),
    ]);
    for (const m of result.months) {
      expect(m.unitCompensationGuaranteeBalanceNis).toBe(0);
      expect(m.unitCompensationGuaranteeExpenseNis).toBe(0);
    }
    expect(result.missingAssumptions).toHaveLength(1);
    expect(result.missingAssumptions[0]).toContain("requiresVerification");
    expect(result.totalGuaranteeExpenseNis).toBe(0);
  });

  it("compensationUnitValueNis חסר/לא תקין נדחה גם כש-requiresVerification (לא מוחלף ב-0 שקט)", () => {
    expect(() =>
      run([
        unitCompensation({
          mechanism: { kind: "unitCompensationOwner", annualRateFraction: "requiresVerification" },
          compensationUnitValueNis: NaN,
        }),
      ])
    ).toThrow();
  });

  it("releaseMonthIndex קודם ל-startMonthIndex נדחה (unitCompensationOwner נשאר מפורש בשני השדות)", () => {
    expect(() => run([unitCompensation({ startMonthIndex: 4, releaseMonthIndex: 2 })])).toThrow();
  });
});

describe("preset קבוצת רכישה מחזיר אפס", () => {
  it("מערך instances ריק -> כל החודשים אפס, אין missingAssumptions, אין activeBeyondForecast", () => {
    const result = run([]);
    for (const m of result.months) {
      expect(m.totalGuaranteeBalanceNis).toBe(0);
      expect(m.totalGuaranteeExpenseNis).toBe(0);
    }
    expect(result.totalGuaranteeExpenseNis).toBe(0);
    expect(result.peakGuaranteeBalanceNis).toBe(0);
    expect(result.peakGuaranteeBalanceMonthIndex).toBeNull();
    expect(result.missingAssumptions).toEqual([]);
    expect(result.activeBeyondForecast).toBe(false);
  });
});

describe("שני מנגנונים פעילים באותו חודש מסוכמים נכון אך נשארים נפרדים", () => {
  it("buyerSaleLaw + kombinatsiaOwner יחד: כל שדה נכון בנפרד, הסך = הסכום", () => {
    const result = run([
      buyer({ monthlyEligibleBuyerReceiptsNis: [100_000, 100_000, 100_000, 100_000, 100_000, 100_000], releaseMonthIndex: 6 }),
      kombinatsia({ ownerUnitsMarketValueNis: 2_000_000, startMonthIndex: 0 }),
    ]);
    const m2 = result.months[2];
    const buyerRate = 0.0085 / 12;
    const ownerRate = 0.01 / 12;
    expect(m2.buyerGuaranteeBalanceNis).toBe(300_000);
    expect(m2.ownerGuaranteeBalanceNis).toBe(2_000_000);
    expect(m2.unitCompensationGuaranteeBalanceNis).toBe(0);
    expect(m2.totalGuaranteeBalanceNis).toBe(2_300_000);
    expect(m2.buyerGuaranteeExpenseNis).toBeCloseTo(300_000 * buyerRate, 6);
    expect(m2.ownerGuaranteeExpenseNis).toBeCloseTo(2_000_000 * ownerRate, 6);
    expect(m2.totalGuaranteeExpenseNis).toBeCloseTo(m2.buyerGuaranteeExpenseNis + m2.ownerGuaranteeExpenseNis, 6);
  });
});

describe("שיא יתרת הערבויות ומועדו נכונים", () => {
  it("השיא לא בהכרח בחודש האחרון - קומבינציה משתחררת באמצע, רוכשים ממשיכים לצבור", () => {
    const result = run([
      buyer({ monthlyEligibleBuyerReceiptsNis: [500_000, 0, 0, 0, 0, 0], releaseMonthIndex: 6 }),
      kombinatsia({
        ownerUnitsMarketValueNis: 2_000_000,
        startMonthIndex: 0,
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 2 }, // release=0+2=2
      }),
    ]);
    // חודש 0-1: רוכשים 500,000 + בעלים 2,000,000 = 2,500,000. חודש 2 ואילך: רק רוכשים 500,000
    expect(result.months[0].totalGuaranteeBalanceNis).toBe(2_500_000);
    expect(result.months[1].totalGuaranteeBalanceNis).toBe(2_500_000);
    expect(result.months[2].totalGuaranteeBalanceNis).toBe(500_000);
    expect(result.peakGuaranteeBalanceNis).toBe(2_500_000);
    expect(result.peakGuaranteeBalanceMonthIndex).toBe(0); // הראשון שמגיע לשיא (stable, לא האחרון)
  });
});

describe("שיעורים לא תקינים נדחים", () => {
  it("שיעור שלילי נדחה", () => {
    expect(() => run([buyer({ mechanism: { kind: "buyerSaleLaw", annualRateFraction: -0.001 } })])).toThrow();
  });
  it("שיעור גבוה מדי (טעות אחוז-במקום-שבר) נדחה", () => {
    expect(() => run([buyer({ mechanism: { kind: "buyerSaleLaw", annualRateFraction: 0.85 } })])).toThrow();
  });
  it("שיעור לא סופי נדחה", () => {
    expect(() => run([buyer({ mechanism: { kind: "buyerSaleLaw", annualRateFraction: NaN } })])).toThrow();
  });
});

describe("תקבול רוכשים שלילי נדחה (commit 6b - אין מנגנון החזר/הפחתת יתרה חלקית)", () => {
  it("ערך שלילי יחיד ב-monthlyEligibleBuyerReceiptsNis נדחה", () => {
    expect(() =>
      run([buyer({ monthlyEligibleBuyerReceiptsNis: [100_000, -5_000, 0, 0, 0, 0] })])
    ).toThrow();
  });
});

describe("ולידציית ציר וחלונות זמן", () => {
  it("monthIndices לא רציף נדחה", () => {
    expect(() => computeGuaranteeSchedule({ monthIndices: [0, 1, 3], instances: [] })).toThrow();
  });
  it("kombinatsiaOwner: startMonthIndex לא שלם נדחה", () => {
    expect(() => run([kombinatsia({ startMonthIndex: 1.5 })])).toThrow();
  });
  it("kombinatsiaOwner: startMonthIndex מחוץ לציר נדחה", () => {
    expect(() => run([kombinatsia({ startMonthIndex: 99 })])).toThrow();
  });
  it("unitCompensationOwner: releaseMonthIndex=lastMonth+1 מותר במפורש (עדיין פעיל עד סוף הציר)", () => {
    expect(() => run([unitCompensation({ startMonthIndex: 0, releaseMonthIndex: 6 })])).not.toThrow();
  });
  it("אורך monthlyEligibleBuyerReceiptsNis שלא תואם לציר נדחה", () => {
    expect(() => run([buyer({ monthlyEligibleBuyerReceiptsNis: [1, 2, 3] })])).toThrow();
  });
});

describe("אין מנגנונים כפולים מאותו סוג אלא אם הטיפוס תומך בכך במפורש", () => {
  it("שני מופעי buyerSaleLaw נדחים", () => {
    expect(() => run([buyer(), buyer()])).toThrow();
  });
  it("שני מופעי kombinatsiaOwner נדחים", () => {
    expect(() => run([kombinatsia(), kombinatsia()])).toThrow();
  });
  it("שני מופעי unitCompensationOwner מותרים במפורש (אחד לכל דייר)", () => {
    expect(() =>
      run([
        unitCompensation({ label: "דייר א", compensationUnitValueNis: 1_500_000, startMonthIndex: 0, releaseMonthIndex: 3 }),
        unitCompensation({ label: "דייר ב", compensationUnitValueNis: 1_800_000, startMonthIndex: 1, releaseMonthIndex: 5 }),
      ])
    ).not.toThrow();
  });
  it("שני מופעי unitCompensationOwner מסוכמים נכון תחת אותו שדה מצרפי", () => {
    const result = run([
      unitCompensation({ label: "דייר א", compensationUnitValueNis: 1_000_000, startMonthIndex: 0, releaseMonthIndex: 6 }),
      unitCompensation({ label: "דייר ב", compensationUnitValueNis: 2_000_000, startMonthIndex: 0, releaseMonthIndex: 6 }),
    ]);
    expect(result.months[0].unitCompensationGuaranteeBalanceNis).toBe(3_000_000);
  });
});

describe("אין NaN/Infinity, בתרחיש מלא עם שלושת המנגנונים (כולל activeBeyondForecast)", () => {
  it("כל השדות המספריים סופיים", () => {
    const result = run([
      buyer({ monthlyEligibleBuyerReceiptsNis: [200_000, 300_000, 0, 400_000, 0, 100_000], releaseMonthIndex: 5 }),
      kombinatsia({
        startMonthIndex: 1,
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 36 },
      }),
      unitCompensation({ label: "דייר א", startMonthIndex: 0, releaseMonthIndex: 3 }),
      unitCompensation({
        label: "דייר ב (טרם אושר שיעור)",
        mechanism: { kind: "unitCompensationOwner", annualRateFraction: "requiresVerification" },
        compensationUnitValueNis: 1_700_000,
      }),
    ]);
    for (const m of result.months) {
      for (const value of Object.values(m)) {
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(Number.isFinite(result.totalGuaranteeExpenseNis)).toBe(true);
    expect(Number.isFinite(result.peakGuaranteeBalanceNis)).toBe(true);
    expect(result.activeBeyondForecast).toBe(true);
  });
});

describe("אין מוטציה של הקלט", () => {
  it("monthIndices ו-instances (כולל אובייקטי mechanism/מערכי תקבולים) לא משתנים אחרי הקריאה", () => {
    const input: GuaranteeScheduleInput = {
      monthIndices: [...MONTH_INDICES],
      instances: [
        buyer({ monthlyEligibleBuyerReceiptsNis: [100_000, 0, 0, 0, 0, 0], releaseMonthIndex: 6 }),
        kombinatsia(),
        unitCompensation(),
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    computeGuaranteeSchedule(input);

    expect(input).toEqual(snapshot);
  });
});

describe("התאמת שקל בין פירוט המנגנונים לסך החודשי ולסך הפרויקט", () => {
  it("total*Nis של כל חודש = סכום שלושת המנגנונים; totalGuaranteeExpenseNis הפרויקטלי = סכום כל החודשים", () => {
    const result = run([
      buyer({ monthlyEligibleBuyerReceiptsNis: [200_000, 300_000, 150_000, 400_000, 0, 100_000], releaseMonthIndex: 5 }),
      kombinatsia({
        startMonthIndex: 1,
        mechanism: { kind: "kombinatsiaOwner", annualRateFraction: 0.01, durationMonths: 3 },
      }),
      unitCompensation({ startMonthIndex: 0, releaseMonthIndex: 3 }),
    ]);

    for (const m of result.months) {
      expect(m.totalGuaranteeBalanceNis).toBeCloseTo(
        m.buyerGuaranteeBalanceNis + m.ownerGuaranteeBalanceNis + m.unitCompensationGuaranteeBalanceNis,
        6
      );
      expect(m.totalGuaranteeExpenseNis).toBeCloseTo(
        m.buyerGuaranteeExpenseNis + m.ownerGuaranteeExpenseNis + m.unitCompensationGuaranteeExpenseNis,
        6
      );
    }

    const sumOfMonths = result.months.reduce((acc, m) => acc + m.totalGuaranteeExpenseNis, 0);
    expect(result.totalGuaranteeExpenseNis).toBeCloseTo(sumOfMonths, 6);
  });
});
