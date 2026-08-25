import { describe, expect, it } from "vitest";
import { resolveConstructionCurve } from "./cashflow-construction-curve";
import { validateCumulativePercentByMonth } from "./cashflow-validation";
import type { ConstructionCurveAssumptions } from "./cashflow-types";

const MONTH_COUNTS = [1, 2, 3, 24, 120]; // כולל "חודשי בנייה רבים" (120 = 10 שנים)

describe("resolveConstructionCurve, כל המודלים", () => {
  for (const months of MONTH_COUNTS) {
    describe(`constructionMonths=${months}`, () => {
      const models: ConstructionCurveAssumptions[] = [{ model: "linear" }, { model: "sCurve" }, { model: "legacy" }];

      for (const assumptions of models) {
        it(`${assumptions.model}: אורך נכון, מסתיים בדיוק ב-1, עובר validateCumulativePercentByMonth`, () => {
          const curve = resolveConstructionCurve(months, assumptions);
          expect(curve).toHaveLength(months);
          expect(curve[curve.length - 1]).toBe(1);
          expect(validateCumulativePercentByMonth(curve).valid).toBe(true);
        });

        it(`${assumptions.model}: לא-יורד (מונוטוני) בכל החודשים`, () => {
          const curve = resolveConstructionCurve(months, assumptions);
          for (let i = 1; i < curve.length; i++) {
            expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
          }
        });
      }
    });
  }
});

describe("linear ו-legacy זהים מתמטית (ר' תיעוד בקוד)", () => {
  for (const months of MONTH_COUNTS) {
    it(`constructionMonths=${months}`, () => {
      const linear = resolveConstructionCurve(months, { model: "linear" });
      const legacy = resolveConstructionCurve(months, { model: "legacy" });
      expect(legacy).toEqual(linear);
    });
  }
});

describe("sCurve: סימטריה, shapeParameter מתועד", () => {
  it("סימטרית נקודתית סביב האמצע: לנקודות t ו-(1-t) המרוחקות זהות מהאמצע, הערכים משלימים ל-1", () => {
    // רשת עם months=4: נקודות בדיוק ב-t=0.25/0.5/0.75/1. t=0.25 ו-t=0.75 הם בני-זוג סימטריים אמיתיים
    // (0.25 + 0.75 = 1), לכן אפשר לבדוק ישירות בלי חשבון אינדקסים מסובך.
    const curve = resolveConstructionCurve(4, { model: "sCurve" });
    const at025 = curve[0]; // t=0.25
    const at050 = curve[1]; // t=0.5
    const at075 = curve[2]; // t=0.75
    expect(at025 + at075).toBeCloseTo(1, 9);
    expect(at050).toBeCloseTo(0.5, 9);
  });

  it("שיעור עקומה ברירת מחדל (k=2) שונה מ-linear באמצע התקופה, אבל מתלכד בקצוות", () => {
    const months = 12;
    const linear = resolveConstructionCurve(months, { model: "linear" });
    const sCurve = resolveConstructionCurve(months, { model: "sCurve" });
    // באמצע: ה-S-curve איטית יותר מ-linear בתחילת הדרך (k=2 מאט את ההתחלה)
    expect(sCurve[1]).toBeLessThan(linear[1]);
    // בסוף: שני המודלים מגיעים בדיוק ל-1
    expect(sCurve[sCurve.length - 1]).toBe(1);
    expect(linear[linear.length - 1]).toBe(1);
  });

  it("shapeParameter=1 שקול ל-linear (הענף הליניארי של משפחת ה-power)", () => {
    const months = 12;
    const linear = resolveConstructionCurve(months, { model: "linear" });
    const sCurveFlat = resolveConstructionCurve(months, { model: "sCurve", shapeParameter: 1 });
    for (let i = 0; i < months; i++) {
      expect(sCurveFlat[i]).toBeCloseTo(linear[i], 9);
    }
  });

  it("shapeParameter גבוה יותר מייצר עקומה בולטת יותר (אמצע תלול יותר)", () => {
    const months = 12;
    const mild = resolveConstructionCurve(months, { model: "sCurve", shapeParameter: 2 });
    const steep = resolveConstructionCurve(months, { model: "sCurve", shapeParameter: 5 });
    // בחודש הראשון (תחילת התקופה), עקומה עם k גבוה יותר "איטית" יותר (ערך נמוך יותר)
    expect(steep[0]).toBeLessThan(mild[0]);
  });

  it("דוחה shapeParameter לא חיובי או לא סופי", () => {
    expect(() => resolveConstructionCurve(12, { model: "sCurve", shapeParameter: 0 })).toThrow();
    expect(() => resolveConstructionCurve(12, { model: "sCurve", shapeParameter: -1 })).toThrow();
    expect(() => resolveConstructionCurve(12, { model: "sCurve", shapeParameter: NaN })).toThrow();
  });
});

describe("custom: אורך חייב להתאים בדיוק, בלי חיתוך/השלמה שקטים", () => {
  it("אורך תואם עובר", () => {
    const curve = resolveConstructionCurve(3, { model: "custom", cumulativePercentByMonth: [0.2, 0.6, 1] });
    expect(curve).toEqual([0.2, 0.6, 1]);
  });

  it("נכשל במפורש כשהמערך קצר מדי, לא חותך/משלים", () => {
    expect(() => resolveConstructionCurve(5, { model: "custom", cumulativePercentByMonth: [0.5, 1] })).toThrow(/אורכו/);
  });

  it("נכשל במפורש כשהמערך ארוך מדי", () => {
    expect(() => resolveConstructionCurve(2, { model: "custom", cumulativePercentByMonth: [0.2, 0.5, 0.8, 1] })).toThrow(/אורכו/);
  });

  it("נכשל כש-custom לא מסכם ל-100% (validateCumulativePercentByMonth נכשל)", () => {
    expect(() => resolveConstructionCurve(3, { model: "custom", cumulativePercentByMonth: [0.2, 0.5, 0.8] })).toThrow();
  });

  it("נכשל כש-custom יורד (לא מצטבר תקין)", () => {
    expect(() => resolveConstructionCurve(3, { model: "custom", cumulativePercentByMonth: [0.5, 0.3, 1] })).toThrow();
  });
});

describe("constructionMonths לא תקין", () => {
  it("דוחה 0 חודשים", () => {
    expect(() => resolveConstructionCurve(0, { model: "linear" })).toThrow();
  });

  it("דוחה מספר שלילי", () => {
    expect(() => resolveConstructionCurve(-3, { model: "linear" })).toThrow();
  });

  it("דוחה מספר לא שלם", () => {
    expect(() => resolveConstructionCurve(5.5, { model: "linear" })).toThrow();
  });
});
