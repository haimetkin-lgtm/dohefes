// commit 7a: מנוע תזמון עלויות טהור. משתמש ב-CashFlowCostItemId/CostTimingRule הקיימים
// (cashflow-types.ts) כמו שהם - לא נוצר union מקביל. עדיין לא מחובר ל-computeCompleteFinancing,
// ל-ProjectInputs או למסכים. אין כאן ריבית, ערבויות, עמלת אי-ניצול או עמלת פתיחת תיק - אלה
// מחוץ לתחום (accountOpeningCommission הוסר מ-CashFlowCostItemId ב-7-prep בדיוק בשביל זה).

import { isCashFlowCostItemId, validateCumulativePercentByMonth } from "./cashflow-validation";
import type { CashFlowCostItemId, CostTimingRule } from "./cashflow-types";

/**
 * עוגני הזמנים ש-CostTimingRule הקיים דורש. CostTimingRule.rule הוא רק תג (איזה כלל) - הערך
 * המספרי בפועל (איזה חודש, איזה חלון) מגיע מכאן, קלט מפורש נפרד, באותו דפוס בדיוק כמו
 * cashflow-guarantees.ts/cashflow-financing-fees.ts (בסיס/עיתוי לעולם לא נגזרים בשקט מהמנגנון עצמו).
 * כל שדה אופציונלי - נדרש (ומאומת) רק אם איזשהו פריט עלות בפועל משתמש בכלל התואם.
 */
export interface CostScheduleAnchors {
  landPurchaseMonthIndex?: number;
  permitMonthIndex?: number;
  escortStartMonthIndex?: number;
  /** גבול לא-כולל, כמו שאר "חלונות" במנועי התזרים */
  escortEndMonthIndexExclusive?: number;
  constructionStartMonthIndex?: number;
  preCompletionMonthIndex?: number;
  relocationStartMonthIndex?: number;
  /** גבול לא-כולל */
  relocationEndMonthIndexExclusive?: number;
}

export interface CostScheduleInput {
  /** ציר החודשים המפורש - רציף, ממוין, בלי כפילויות */
  monthIndices: number[];
  /** כל סכום משויך למזהה CashFlowCostItemId מפורש. פריטים שלא הוזנו נחשבים לא-רלוונטיים (לא 0 שגוי) */
  costAmountsByItemId: Partial<Record<CashFlowCostItemId, number>>;
  timingRulesByItemId: Partial<Record<CashFlowCostItemId, CostTimingRule>>;
  /**
   * עקומת בנייה **כבר מנורמלת** - תוצאת resolveConstructionCurve (cashflow-construction-curve.ts),
   * לא מחושבת כאן מחדש. אורך = מספר חודשי הבנייה, ממוקמת על ציר הפרויקט החל מ-
   * anchors.constructionStartMonthIndex.
   */
  constructionCurve: number[];
  anchors: CostScheduleAnchors;
}

export interface CostScheduleMonth {
  monthIndex: number;
  costsByItemId: Partial<Record<CashFlowCostItemId, number>>;
  totalCostOutflowsNis: number;
}

export interface CostScheduleResult {
  months: CostScheduleMonth[];
  totalsByItemId: Partial<Record<CashFlowCostItemId, number>>;
  totalCostOutflowsNis: number;
  warnings: string[];
  /** פריט בעל סכום חיובי בלי כלל עיתוי, או עם כלל שדורש הסכם/נתון פרויקט לא-זמין (salesCurve,
   *  requiresProjectAgreement) - תרומתו 0 בכל חודש, לא ניחוש שקט */
  missingAssumptions: string[];
  /** false אם missingAssumptions לא ריק */
  isComplete: boolean;
}

function validateFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} חייב להיות מספר סופי לא-שלילי (התקבל ${value})`);
  }
}

function validateMonthIndices(monthIndices: number[]): void {
  if (monthIndices.length === 0) {
    throw new Error("monthIndices ריק");
  }
  for (const [i, m] of monthIndices.entries()) {
    if (!Number.isFinite(m) || !Number.isInteger(m)) {
      throw new Error(`monthIndices[${i}] אינו מספר שלם סופי (${m})`);
    }
  }
  const first = monthIndices[0];
  for (const [i, m] of monthIndices.entries()) {
    const expected = first + i;
    if (m !== expected) {
      throw new Error(
        `monthIndices חייב להיות רציף, ממוין, בלי כפילויות: באינדקס ${i} צפוי monthIndex=${expected}, התקבל ${m}`
      );
    }
  }
}

function validateAnchorMonth(value: number | undefined, name: string, firstMonth: number, lastMonth: number): number {
  if (value === undefined) {
    throw new Error(`${name} חסר - נדרש עבור כלל עיתוי שבפועל בשימוש`);
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${name} אינו מספר שלם סופי (${value})`);
  }
  if (value < firstMonth || value > lastMonth) {
    throw new Error(`${name} (${value}) מחוץ לציר הפרויקט [${firstMonth}, ${lastMonth}]`);
  }
  return value;
}

/** מפזרת amount על פני [startMonthIndex, endMonthIndexExclusive) בפריסה אחידה, עם תיקון שארית
 *  בחודש האחרון בחלון כדי להבטיח sum(תוצאה) === amount בדיוק (לא רק בקירוב) */
function evenSpreadAmounts(amount: number, startMonthIndex: number, endMonthIndexExclusive: number): Map<number, number> {
  const monthCount = endMonthIndexExclusive - startMonthIndex;
  const perMonth = amount / monthCount;
  const result = new Map<number, number>();
  let running = 0;
  for (let i = 0; i < monthCount; i++) {
    const monthIndex = startMonthIndex + i;
    if (i === monthCount - 1) {
      result.set(monthIndex, amount - running); // תיקון שארית - לא perMonth שוב
    } else {
      result.set(monthIndex, perMonth);
      running += perMonth;
    }
  }
  return result;
}

/** מפזרת amount לפי עקומת בנייה מנורמלת (אחוז מצטבר), ממוקמת על ציר הפרויקט החל מ-constructionStartMonthIndex.
 *  ערך חודש i = amount * (curve[i] - curve[i-1]), עם תיקון שארית בחודש האחרון של העקומה (לא בהכרח
 *  1.0 בדיוק, ר' FRACTION_SUM_TOLERANCE ב-validateCumulativePercentByMonth) כדי ש-sum(תוצאה) === amount בדיוק */
function constructionCurveAmounts(amount: number, constructionCurve: number[], constructionStartMonthIndex: number): Map<number, number> {
  const result = new Map<number, number>();
  let previousCumulative = 0;
  let running = 0;
  for (const [i, cumulative] of constructionCurve.entries()) {
    const monthIndex = constructionStartMonthIndex + i;
    if (i === constructionCurve.length - 1) {
      result.set(monthIndex, amount - running); // תיקון שארית לחודש האחרון של העקומה
    } else {
      const value = amount * (cumulative - previousCumulative);
      result.set(monthIndex, value);
      running += value;
    }
    previousCumulative = cumulative;
  }
  return result;
}

/**
 * מנוע תזמון עלויות טהור: לכל פריט CashFlowCostItemId, פורס את הסכום שלו על פני ציר הפרויקט לפי
 * CostTimingRule.rule שלו. לא כולל ריבית/ערבויות/עמלות מימון - אלה מנועים ייעודיים נפרדים.
 *
 * כלל | התנהגות:
 * - landPurchaseMonth/permitMonth/escortStart/constructionStart/preCompletion: כל הסכום בחודש
 *   העוגן המתאים (מ-anchors), חד-פעמי.
 * - spreadOverConstruction: לפי constructionCurve (כבר מנורמלת, קלט) ממוקמת החל מ-
 *   constructionStartMonthIndex, עם תיקון שארית בחודש האחרון של העקומה.
 * - spreadOverEscort/spreadOverRelocation: פריסה אחידה על פני [start, endExclusive) המתאים
 *   מ-anchors, עם תיקון שארית בחודש האחרון בחלון.
 * - salesCurve/requiresProjectAgreement: לא מחושב במודול הזה (salesCurve דורש נתוני לוח מכירות
 *   שאינם קלט כאן; requiresProjectAgreement דורש הסכם ספציפי לפרויקט מעצם הגדרתו) - תרומה 0,
 *   מדווח ב-missingAssumptions, לא ניחוש שקט.
 * - פריט בעל סכום חיובי בלי CostTimingRule כלל: תרומה 0, מדווח ב-missingAssumptions - לא נזרק
 *   בשקט לחודש 0.
 * - פריט בעל סכום 0: לגיטימי בלי CostTimingRule כלל, אינו יוצר missingAssumptions.
 */
export function computeCostSchedule(input: CostScheduleInput): CostScheduleResult {
  const { monthIndices, costAmountsByItemId, timingRulesByItemId, constructionCurve, anchors } = input;

  validateMonthIndices(monthIndices);
  const firstMonth = monthIndices[0];
  const lastMonth = monthIndices[monthIndices.length - 1];

  const unknownCostKeys = Object.keys(costAmountsByItemId).filter((k) => !isCashFlowCostItemId(k));
  if (unknownCostKeys.length > 0) {
    throw new Error(`costAmountsByItemId מכיל מזהים לא מוכרים: ${unknownCostKeys.join(", ")}`);
  }
  const unknownRuleKeys = Object.keys(timingRulesByItemId).filter((k) => !isCashFlowCostItemId(k));
  if (unknownRuleKeys.length > 0) {
    throw new Error(`timingRulesByItemId מכיל מזהים לא מוכרים: ${unknownRuleKeys.join(", ")}`);
  }

  for (const [itemId, amount] of Object.entries(costAmountsByItemId)) {
    validateFiniteNonNegative(amount as number, `costAmountsByItemId["${itemId}"]`);
  }

  const missingAssumptions: string[] = [];
  const perItemMonthly = new Map<CashFlowCostItemId, Map<number, number>>();

  for (const [itemIdRaw, amountRaw] of Object.entries(costAmountsByItemId)) {
    const itemId = itemIdRaw as CashFlowCostItemId;
    const amount = amountRaw as number;
    if (amount === 0) continue; // סכום 0 בלי timing הוא תקין - אין מה לתזמן

    const rule = timingRulesByItemId[itemId];
    if (!rule) {
      missingAssumptions.push(`${itemId}: סכום חיובי (${amount}) בלי כלל עיתוי (CostTimingRule) - לא תוזמן`);
      continue;
    }

    switch (rule.rule) {
      case "landPurchaseMonth": {
        const month = validateAnchorMonth(anchors.landPurchaseMonthIndex, "anchors.landPurchaseMonthIndex", firstMonth, lastMonth);
        perItemMonthly.set(itemId, new Map([[month, amount]]));
        break;
      }
      case "permitMonth": {
        const month = validateAnchorMonth(anchors.permitMonthIndex, "anchors.permitMonthIndex", firstMonth, lastMonth);
        perItemMonthly.set(itemId, new Map([[month, amount]]));
        break;
      }
      case "escortStart": {
        const month = validateAnchorMonth(anchors.escortStartMonthIndex, "anchors.escortStartMonthIndex", firstMonth, lastMonth);
        perItemMonthly.set(itemId, new Map([[month, amount]]));
        break;
      }
      case "constructionStart": {
        const month = validateAnchorMonth(anchors.constructionStartMonthIndex, "anchors.constructionStartMonthIndex", firstMonth, lastMonth);
        perItemMonthly.set(itemId, new Map([[month, amount]]));
        break;
      }
      case "preCompletion": {
        const month = validateAnchorMonth(anchors.preCompletionMonthIndex, "anchors.preCompletionMonthIndex", firstMonth, lastMonth);
        perItemMonthly.set(itemId, new Map([[month, amount]]));
        break;
      }
      case "spreadOverConstruction": {
        const curveCheck = validateCumulativePercentByMonth(constructionCurve);
        if (!curveCheck.valid) {
          throw new Error(`constructionCurve לא תקינה: ${curveCheck.errors.join("; ")}`);
        }
        const startMonth = validateAnchorMonth(
          anchors.constructionStartMonthIndex,
          "anchors.constructionStartMonthIndex",
          firstMonth,
          lastMonth
        );
        const endMonthExclusive = startMonth + constructionCurve.length;
        if (endMonthExclusive - 1 > lastMonth) {
          throw new Error(
            `${itemId}: spreadOverConstruction חורג מציר הפרויקט (חודש אחרון ${endMonthExclusive - 1} > ${lastMonth}) - אין העברה שקטה מחוץ לציר`
          );
        }
        perItemMonthly.set(itemId, constructionCurveAmounts(amount, constructionCurve, startMonth));
        break;
      }
      case "spreadOverEscort": {
        const startMonth = validateAnchorMonth(anchors.escortStartMonthIndex, "anchors.escortStartMonthIndex", firstMonth, lastMonth);
        if (anchors.escortEndMonthIndexExclusive === undefined) {
          throw new Error("anchors.escortEndMonthIndexExclusive חסר - נדרש עבור spreadOverEscort");
        }
        const endExclusive = anchors.escortEndMonthIndexExclusive;
        if (!Number.isInteger(endExclusive) || endExclusive <= startMonth) {
          throw new Error(`anchors.escortEndMonthIndexExclusive (${endExclusive}) חייב להיות שלם וגדול מ-escortStartMonthIndex (${startMonth})`);
        }
        if (endExclusive - 1 > lastMonth) {
          throw new Error(`${itemId}: spreadOverEscort חורג מציר הפרויקט (חודש אחרון ${endExclusive - 1} > ${lastMonth})`);
        }
        perItemMonthly.set(itemId, evenSpreadAmounts(amount, startMonth, endExclusive));
        break;
      }
      case "spreadOverRelocation": {
        const startMonth = validateAnchorMonth(anchors.relocationStartMonthIndex, "anchors.relocationStartMonthIndex", firstMonth, lastMonth);
        if (anchors.relocationEndMonthIndexExclusive === undefined) {
          throw new Error("anchors.relocationEndMonthIndexExclusive חסר - נדרש עבור spreadOverRelocation");
        }
        const endExclusive = anchors.relocationEndMonthIndexExclusive;
        if (!Number.isInteger(endExclusive) || endExclusive <= startMonth) {
          throw new Error(`anchors.relocationEndMonthIndexExclusive (${endExclusive}) חייב להיות שלם וגדול מ-relocationStartMonthIndex (${startMonth})`);
        }
        if (endExclusive - 1 > lastMonth) {
          throw new Error(`${itemId}: spreadOverRelocation חורג מציר הפרויקט (חודש אחרון ${endExclusive - 1} > ${lastMonth})`);
        }
        perItemMonthly.set(itemId, evenSpreadAmounts(amount, startMonth, endExclusive));
        break;
      }
      case "salesCurve":
        missingAssumptions.push(`${itemId}: salesCurve דורש נתוני לוח מכירות שאינם קלט למודול הזה - לא תוזמן`);
        break;
      case "requiresProjectAgreement":
        missingAssumptions.push(`${itemId}: requiresProjectAgreement דורש הסכם ספציפי לפרויקט - לא תוזמן${rule.note ? ` (${rule.note})` : ""}`);
        break;
    }
  }

  const months: CostScheduleMonth[] = monthIndices.map((monthIndex) => {
    const costsByItemId: Partial<Record<CashFlowCostItemId, number>> = {};
    let totalCostOutflowsNis = 0;
    for (const [itemId, monthly] of perItemMonthly.entries()) {
      const value = monthly.get(monthIndex);
      if (value !== undefined) {
        costsByItemId[itemId] = value;
        totalCostOutflowsNis += value;
      }
    }
    return { monthIndex, costsByItemId, totalCostOutflowsNis };
  });

  const totalsByItemId: Partial<Record<CashFlowCostItemId, number>> = {};
  let totalCostOutflowsNis = 0;
  for (const [itemId, monthly] of perItemMonthly.entries()) {
    let itemTotal = 0;
    for (const value of monthly.values()) itemTotal += value;
    totalsByItemId[itemId] = itemTotal;
    totalCostOutflowsNis += itemTotal;
  }
  // פריטים בסכום 0 (או שלא תוזמנו כלל בגלל missingAssumptions) עדיין מדווחים ב-totalsByItemId כ-0,
  // לשקיפות מלאה מול costAmountsByItemId המקורי
  for (const itemIdRaw of Object.keys(costAmountsByItemId)) {
    const itemId = itemIdRaw as CashFlowCostItemId;
    if (!(itemId in totalsByItemId)) {
      totalsByItemId[itemId] = 0;
    }
  }

  return {
    months,
    totalsByItemId,
    totalCostOutflowsNis,
    warnings: [],
    missingAssumptions,
    isComplete: missingAssumptions.length === 0,
  };
}
