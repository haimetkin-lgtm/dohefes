// commit 7b: לוח תפעולי חודשי מאוחד - תקבולי מכירות (cashflow-sales-schedule.ts) + לוח עלויות
// (cashflow-cost-schedule.ts). לא משכפל אף אחד מהם, רק מרכיב. עדיין לא מחובר ל-computeCompleteFinancing,
// ל-ProjectInputs, למסכים או ל-Supabase. אין כאן ריבית, ערבויות או עמלות מימון.

import { computeUnitRowMonthlyReceipts } from "./cashflow-sales-schedule";
import type { ReceiptRowInput, UnitSalesBatch } from "./cashflow-sales-schedule";
import type { CashFlowCostItemId, SalesScheduleAssumptions } from "./cashflow-types";
import type { CostScheduleMonth, CostScheduleResult } from "./cashflow-cost-schedule";
import type { UnitCategory } from "./types";

/**
 * עטיפת שורת מכירה עם מזהה יציב (7b: מעכשיו שכבה רב-שורתית - כמה שורות תמהיל בו-זמנית, לא שורה
 * בודדת). `unit` הוא ReceiptRowInput (הטיפוס הקיים שכבר צורך computeUnitRowMonthlyReceipts בפועל,
 * לא UnitType המלא - שדות כמו name/areaSqm אינם רלוונטיים למנוע תקבולים טהור).
 */
export interface SalesUnitRowInput {
  unitRowId: string;
  unit: ReceiptRowInput;
  batches: UnitSalesBatch[];
  /** מפורש - אינו מוסק אוטומטית מהקטגוריה. יחידת תמורה/מבנה קיים ממילא לא מייצרת תקבול כלל (ר'
   *  computeUnitRowMonthlyReceipts), כך שהדגל כאן לא "מתקן" את זה - הוא קובע רק אילו תקבולים
   *  אמיתיים נכנסים לבסיס ערבות חוק המכר. */
  isBuyerSaleLawEligible: boolean;
}

export interface OperatingScheduleInput {
  /** ציר החודשים הסמכותי - רציף, ממוין, בלי כפילויות. סדר הפלט נשמר לפי הסדר הזה */
  monthIndices: number[];
  salesUnitRows: SalesUnitRowInput[];
  salesScheduleAssumptions: SalesScheduleAssumptions;
  /** עוגן ל-computeUnitRowMonthlyReceipts - תחילת שיווק, גבול תחתון ל-batch.saleMonth */
  marketingStartMonthIndex: number;
  constructionStartMonthIndex: number;
  handoverMonthIndex: number;
  /** עקומת בנייה כבר מנורמלת - נדרשת רק אם קיימת מנת constructionProgress בלוח התקבולים של קטגוריה כלשהי */
  constructionCurve?: number[];
  /** תוצאת computeCostSchedule - לא מחושב כאן מחדש. אם costSchedule.isComplete===false, החוסרים
   *  מועברים ל-missingAssumptions כאן, לא ממציאים עיתוי חלופי */
  costSchedule: CostScheduleResult;
}

export interface OperatingScheduleMonth {
  monthIndex: number;
  receiptsByUnitRowId: Record<string, number>;
  receiptsByUnitCategory: Partial<Record<UnitCategory, number>>;
  /** כולל את כל תקבולי המכירות בפועל, זכאים ולא-זכאים כאחד */
  totalOperatingInflowsNis: number;
  /** רק שורות שסומנו isBuyerSaleLawEligible===true במפורש */
  eligibleBuyerReceiptsNis: number;
  /** מ-costSchedule ישירות - לא מחושב מחדש */
  costsByItemId: Partial<Record<CashFlowCostItemId, number>>;
  /** מ-costSchedule ישירות - לא מחושב מחדש */
  totalOperatingOutflowsNis: number;
}

export interface OperatingScheduleResult {
  months: OperatingScheduleMonth[];
  totalOperatingInflowsNis: number;
  totalEligibleBuyerReceiptsNis: number;
  totalOperatingOutflowsNis: number;
  receiptsTotalsByUnitRowId: Record<string, number>;
  receiptsTotalsByUnitCategory: Partial<Record<UnitCategory, number>>;
  /** מ-costSchedule.totalsByItemId ישירות */
  costTotalsByItemId: Partial<Record<CashFlowCostItemId, number>>;
  warnings: string[];
  /** כולל את costSchedule.missingAssumptions (מועבר, לא מומצא מחדש) + חוסרים שנמצאו בשכבה הזו */
  missingAssumptions: string[];
  isComplete: boolean;
}

const MONEY_EPSILON_NIS = 0.01;

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

function validateSalesUnitRows(rows: SalesUnitRowInput[]): void {
  const seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    if (!row.unitRowId || row.unitRowId.trim() === "") {
      throw new Error(`salesUnitRows[${i}]: unitRowId ריק`);
    }
    if (seen.has(row.unitRowId)) {
      throw new Error(`salesUnitRows: unitRowId כפול ("${row.unitRowId}")`);
    }
    seen.add(row.unitRowId);
  }
}

/** מתאימה בין ציר monthIndices (הסמכותי) ל-costSchedule.months, **לפי monthIndex בלבד** - לעולם
 *  לא לפי מיקום במערך (אותו דפוס בדיוק כמו matchGuaranteeMonths ב-cashflow-financed-engine.ts).
 *  דוחה חודש כפול/חסר/עודף. */
function matchCostScheduleMonths(monthIndices: number[], costMonths: CostScheduleMonth[]): Map<number, CostScheduleMonth> {
  const byIndex = new Map<number, CostScheduleMonth>();
  for (const cm of costMonths) {
    if (byIndex.has(cm.monthIndex)) {
      throw new Error(`costSchedule.months: חודש כפול (monthIndex=${cm.monthIndex})`);
    }
    byIndex.set(cm.monthIndex, cm);
  }
  const monthIndicesSet = new Set(monthIndices);
  for (const m of monthIndices) {
    if (!byIndex.has(m)) {
      throw new Error(`costSchedule.months: חודש חסר עבור monthIndex=${m} (קיים ב-monthIndices, לא בלוח העלויות)`);
    }
  }
  for (const cm of costMonths) {
    if (!monthIndicesSet.has(cm.monthIndex)) {
      throw new Error(`costSchedule.months: חודש עודף (monthIndex=${cm.monthIndex}) שלא קיים ב-monthIndices`);
    }
  }
  return byIndex;
}

/**
 * שכבת orchestration תפעולית: מרכיבה תקבולי מכירות (computeUnitRowMonthlyReceipts, לכל שורה
 * בנפרד לפי unitRowId) עם לוח עלויות (costSchedule, קלט מוכן - לא מחושב כאן) ללוח תפעולי חודשי
 * אחד. בלי ריבית/ערבויות/עמלות מימון - אלה מנועים ייעודיים נפרדים במורד הזרימה.
 *
 * לכל שורת מכירה: tranches נגזרים מ-salesScheduleAssumptions.byCategory לפי הקטגוריה של השורה
 * (ברירת מחדל "residential" אם לא צוינה - אותה מוסכמה כמו computeUnitRowMonthlyReceipts עצמו).
 * קטגוריה בלי tranches מוגדרים: אם לשורה יש בפועל batches (מוכרת), זו הנחה מקצועית חסרה - מדווח
 * ב-missingAssumptions, תרומת השורה 0, לא נזרקת שגיאה (לוח תשלומים לא הוגדר עדיין לקטגוריה הזו הוא
 * פער תיעוד, לא קלט פגום). שורה שאינה מוכרת (batches ריק) לא מייצרת חוסר גם בלי tranches - אין צורך.
 *
 * תקבול שמופיע מחוץ לציר monthIndices נדחה במפורש (לא נחתך/מוזז בשקט).
 */
export function computeOperatingSchedule(input: OperatingScheduleInput): OperatingScheduleResult {
  const {
    monthIndices,
    salesUnitRows,
    salesScheduleAssumptions,
    marketingStartMonthIndex,
    constructionStartMonthIndex,
    handoverMonthIndex,
    constructionCurve,
    costSchedule,
  } = input;

  validateMonthIndices(monthIndices);
  validateSalesUnitRows(salesUnitRows);
  const costByMonth = matchCostScheduleMonths(monthIndices, costSchedule.months);

  const firstMonth = monthIndices[0];
  const lastMonth = monthIndices[monthIndices.length - 1];

  const missingAssumptions: string[] = [...costSchedule.missingAssumptions];

  const receiptsByRowId = new Map<string, Map<number, number>>();

  for (const row of salesUnitRows) {
    const category: UnitCategory = row.unit.category ?? "residential";
    const tranches = salesScheduleAssumptions.byCategory[category];

    if (!tranches) {
      if (row.batches.length > 0) {
        missingAssumptions.push(
          `${row.unitRowId}: קטגוריה "${category}" נמכרת (batches לא ריק) אך אין לה lוח תשלומים מוגדר ב-salesScheduleAssumptions.byCategory - לא תוזמן`
        );
      }
      receiptsByRowId.set(row.unitRowId, new Map());
      continue;
    }

    const monthlyReceipts = computeUnitRowMonthlyReceipts(
      row.unit,
      row.batches,
      tranches,
      marketingStartMonthIndex,
      handoverMonthIndex,
      salesScheduleAssumptions.model,
      constructionCurve,
      constructionStartMonthIndex
    );

    for (const r of monthlyReceipts) {
      if (r.monthIndex < firstMonth || r.monthIndex > lastMonth) {
        throw new Error(
          `${row.unitRowId}: תקבול בחודש ${r.monthIndex} מחוץ לציר הפרויקט [${firstMonth}, ${lastMonth}]`
        );
      }
    }

    receiptsByRowId.set(row.unitRowId, new Map(monthlyReceipts.map((r) => [r.monthIndex, r.amountNis])));
  }

  const months: OperatingScheduleMonth[] = monthIndices.map((monthIndex) => {
    const receiptsByUnitRowId: Record<string, number> = {};
    const receiptsByUnitCategory: Partial<Record<UnitCategory, number>> = {};
    let totalOperatingInflowsNis = 0;
    let eligibleBuyerReceiptsNis = 0;

    for (const row of salesUnitRows) {
      const amount = receiptsByRowId.get(row.unitRowId)?.get(monthIndex);
      if (amount === undefined) continue;

      receiptsByUnitRowId[row.unitRowId] = amount;
      const category: UnitCategory = row.unit.category ?? "residential";
      receiptsByUnitCategory[category] = (receiptsByUnitCategory[category] ?? 0) + amount;
      totalOperatingInflowsNis += amount;
      if (row.isBuyerSaleLawEligible) {
        eligibleBuyerReceiptsNis += amount;
      }
    }

    const costMonth = costByMonth.get(monthIndex)!;
    // עותק, לא alias - אסור לשנות את costSchedule המקורי דרך האובייקט המוחזר כאן
    const costsByItemId: Partial<Record<CashFlowCostItemId, number>> = { ...costMonth.costsByItemId };

    return {
      monthIndex,
      receiptsByUnitRowId,
      receiptsByUnitCategory,
      totalOperatingInflowsNis,
      eligibleBuyerReceiptsNis,
      costsByItemId,
      totalOperatingOutflowsNis: costMonth.totalCostOutflowsNis,
    };
  });

  let totalOperatingInflowsNis = 0;
  let totalEligibleBuyerReceiptsNis = 0;
  let totalOperatingOutflowsNis = 0;
  const receiptsTotalsByUnitRowId: Record<string, number> = {};
  const receiptsTotalsByUnitCategory: Partial<Record<UnitCategory, number>> = {};

  for (const m of months) {
    totalOperatingInflowsNis += m.totalOperatingInflowsNis;
    totalEligibleBuyerReceiptsNis += m.eligibleBuyerReceiptsNis;
    totalOperatingOutflowsNis += m.totalOperatingOutflowsNis;
    for (const [rowId, amount] of Object.entries(m.receiptsByUnitRowId)) {
      receiptsTotalsByUnitRowId[rowId] = (receiptsTotalsByUnitRowId[rowId] ?? 0) + amount;
    }
    for (const [cat, amount] of Object.entries(m.receiptsByUnitCategory)) {
      const category = cat as UnitCategory;
      receiptsTotalsByUnitCategory[category] = (receiptsTotalsByUnitCategory[category] ?? 0) + (amount ?? 0);
    }
  }

  // אימות פנימי: הוצאות התפעוליות שסוכמו כאן מהחודשים חייבות לתאום לסכום הרשמי מ-costSchedule
  // (לא מוחלף בו - רק מאומת, ר' תיעוד הפונקציה)
  if (Math.abs(totalOperatingOutflowsNis - costSchedule.totalCostOutflowsNis) > MONEY_EPSILON_NIS) {
    throw new Error(
      `שגיאה פנימית: totalOperatingOutflowsNis (${totalOperatingOutflowsNis}) לא תואם ל-costSchedule.totalCostOutflowsNis (${costSchedule.totalCostOutflowsNis})`
    );
  }

  return {
    months,
    totalOperatingInflowsNis,
    totalEligibleBuyerReceiptsNis,
    totalOperatingOutflowsNis,
    receiptsTotalsByUnitRowId,
    receiptsTotalsByUnitCategory,
    costTotalsByItemId: costSchedule.totalsByItemId,
    warnings: [],
    missingAssumptions,
    isComplete: missingAssumptions.length === 0,
  };
}
