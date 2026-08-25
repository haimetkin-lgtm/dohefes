// commit 2 של מנוע התזרים: פונקציה טהורה בלבד שפותרת ConstructionCurveAssumptions למערך אחוזים
// מצטברים חודשי. אין כאן תזרים, מימון, React, או שינוי ב-computeProject - ר' GEN2_CASHFLOW_DESIGN.md §7.

import { validateCumulativePercentByMonth } from "./cashflow-validation";
import type { ConstructionCurveAssumptions } from "./cashflow-types";

const DEFAULT_S_CURVE_SHAPE_PARAMETER = 2;

/**
 * פריסה אחידה: כל חודש תורם 1/constructionMonths, מצטבר לינארית. (i+1)/months נותן בדיוק 1 בחודש
 * האחרון (months/months), לא קירוב.
 */
function linearCumulativePercentByMonth(constructionMonths: number): number[] {
  return Array.from({ length: constructionMonths }, (_, i) => (i + 1) / constructionMonths);
}

/**
 * פרופיל "legacy", תואם-מקור: קבצי המקור (01-תמא-38.md) מתארים הוצאה מצטברת הדרגתית בלי לתעד צורה
 * מפורשת מעבר לכך - אין עדות לעקומת S-curve או לצורה אחרת. לכן, בשלב זה, הפרשנות הטובה ביותר מהראיות
 * הקיימות היא פריסה אחידה, זהה מתמטית ל-linear. נשמר כזיהוי (model) נפרד מ"linear" כדי לא לקשור בין
 * ברירת המחדל של דוחות חדשים (שעשויה להשתנות) לבין פרופיל האימות מול קבצי המקור (שאסור שישתנה
 * בלי כוונה מפורשת) - אם אחד מהם ישתנה בעתיד, השני לא יושפע רק בגלל שיתוף קוד מקרי.
 */
function legacyCumulativePercentByMonth(constructionMonths: number): number[] {
  return linearCumulativePercentByMonth(constructionMonths);
}

/**
 * S-curve סימטרית ומונוטונית: פונקציית "ease in/out" מבוססת חזקה, סטנדרטית וידועה (משפחת
 * smoothstep מוכללת). לכל t ב-[0,1] (זמן יחסי מתחילת הבנייה):
 *
 *   cumulative(t) = t<0.5 ? 0.5*(2t)^k : 1-0.5*(2*(1-t))^k
 *
 * כאשר k=shapeParameter (ברירת מחדל 2). k=1 שקול ל-linear בדיוק. k>1 מייצר עקומת S בולטת יותר
 * (התחלה/סיום איטיים יותר, אמצע תלול יותר) - ככל ש-k גדול יותר, האפקט חזק יותר. הפונקציה סימטרית
 * נקודתית סביב (0.5, 0.5) לכל k>0 (הוכחה: cumulative(1-t) = 1-cumulative(t)), ורציפה ב-t=0.5
 * (שני הענפים נותנים 0.5 בדיוק שם). cumulative(1)=1 בדיוק לכל k>0 (הענף השני נותן 1-0.5*0^k=1).
 */
function sCurveCumulativePercentByMonth(constructionMonths: number, shapeParameter: number = DEFAULT_S_CURVE_SHAPE_PARAMETER): number[] {
  if (!Number.isFinite(shapeParameter) || shapeParameter <= 0) {
    throw new Error(`sCurve.shapeParameter חייב להיות מספר סופי חיובי (התקבל ${shapeParameter})`);
  }
  const k = shapeParameter;
  const cumulativeAt = (t: number): number => (t < 0.5 ? 0.5 * Math.pow(2 * t, k) : 1 - 0.5 * Math.pow(2 * (1 - t), k));
  return Array.from({ length: constructionMonths }, (_, i) => cumulativeAt((i + 1) / constructionMonths));
}

/**
 * פותרת ConstructionCurveAssumptions למערך אחוזים מצטברים חודשי (אורך = constructionMonths).
 * custom חייב להתאים באורכו בדיוק ל-constructionMonths, אחרת נכשלת במפורש - אין חיתוך/השלמה שקטים.
 * כל תוצאה מאומתת עצמאית מול validateCumulativePercentByMonth לפני ההחזרה (הגנה כפולה, במיוחד
 * חשובה ל-custom שהוא קלט משתמש).
 */
export function resolveConstructionCurve(constructionMonths: number, assumptions: ConstructionCurveAssumptions): number[] {
  if (!Number.isInteger(constructionMonths) || constructionMonths < 1) {
    throw new Error(`constructionMonths חייב להיות מספר שלם חיובי (התקבל ${constructionMonths})`);
  }

  let curve: number[];
  switch (assumptions.model) {
    case "linear":
      curve = linearCumulativePercentByMonth(constructionMonths);
      break;
    case "sCurve":
      curve = sCurveCumulativePercentByMonth(constructionMonths, assumptions.shapeParameter);
      break;
    case "legacy":
      curve = legacyCumulativePercentByMonth(constructionMonths);
      break;
    case "custom": {
      const provided = assumptions.cumulativePercentByMonth;
      if (provided.length !== constructionMonths) {
        throw new Error(
          `custom.cumulativePercentByMonth אורכו ${provided.length}, אמור להתאים בדיוק ל-constructionMonths (${constructionMonths}) - אין חיתוך/השלמה אוטומטיים`
        );
      }
      curve = provided;
      break;
    }
  }

  const validation = validateCumulativePercentByMonth(curve);
  if (!validation.valid) {
    throw new Error(`עקומת בנייה (${assumptions.model}) לא תקינה: ${validation.errors.join("; ")}`);
  }
  return curve;
}
