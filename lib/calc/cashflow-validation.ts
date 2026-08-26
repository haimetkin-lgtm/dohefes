// ולידציה טהורה למבני התזרים (commit 1). אין כאן לוגיקת חישוב תזרים בפועל - רק בדיקות מבניות
// על טיפוסים שכבר מולאו, לשימוש עתידי גם בתוך computeCashFlow (commit 4+) וגם כבדיקות vitest.

import { CASH_FLOW_COST_ITEM_IDS, PROJECT_PHASES } from "./cashflow-types";
import type { CashFlowCostItemId, GuaranteeMechanism, PaymentTranche, ProjectPhase, SaleScheduleModel } from "./cashflow-types";

const FRACTION_SUM_TOLERANCE = 1e-6;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(errors: string[]): ValidationResult {
  return { valid: false, errors };
}

/**
 * מוודאת שסכום המנות של לוח תקבולים אחד (קטגוריית יחידות אחת) תקין: כל fraction סופי, בטווח [0,1]
 * (דוחה במפורש ערך כמו 15 במקום 0.15 - זו בדיוק הטעות שהיחידה fraction נועדה למנוע), ואין ערך שלילי.
 * הסכום הכולל חייב להיות קרוב ל-1 בסבילות FRACTION_SUM_TOLERANCE, לא שוויון מדויק (floating point).
 * בודקת רק את האחוזים - ר' validatePaymentSchedule לבדיקת התזמון בהקשר ציר הפרויקט.
 */
export function validatePaymentTranches(tranches: PaymentTranche[]): ValidationResult {
  if (tranches.length === 0) return fail(["לוח תקבולים ריק"]);

  const errors: string[] = [];
  let sum = 0;

  for (const [i, tranche] of tranches.entries()) {
    const { fraction } = tranche;
    if (!Number.isFinite(fraction)) {
      errors.push(`מנה ${i} ("${tranche.label}"): fraction אינו מספר סופי (${fraction})`);
      continue;
    }
    if (fraction < 0) {
      errors.push(`מנה ${i} ("${tranche.label}"): fraction שלילי (${fraction})`);
    }
    if (fraction > 1) {
      errors.push(`מנה ${i} ("${tranche.label}"): fraction גדול מ-1 (${fraction}) - האם הוזן אחוז (15) במקום שבר (0.15)?`);
    }
    sum += fraction;
  }

  if (Math.abs(sum - 1) > FRACTION_SUM_TOLERANCE) {
    errors.push(`סכום ה-fraction הוא ${sum}, אמור להיות קרוב ל-1 (סבילות ${FRACTION_SUM_TOLERANCE})`);
  }

  return errors.length === 0 ? ok() : fail(errors);
}

/**
 * ולידציה מלאה של לוח תקבולים בהקשר ציר הפרויקט: לא רק האחוזים (ר' validatePaymentTranches, נקראת
 * פנימית), אלא גם שכל PaymentTiming נופל בתוך הציר בפועל, ושימוש נכון בסוגי התזמון לפי מודל הלוח.
 */
export function validatePaymentSchedule(
  tranches: PaymentTranche[],
  saleMonth: number,
  handoverMonth: number,
  scheduleModel: SaleScheduleModel
): ValidationResult {
  const errors: string[] = [];

  if (!Number.isFinite(saleMonth) || !Number.isInteger(saleMonth)) {
    errors.push(`saleMonth אינו מספר שלם סופי (${saleMonth})`);
  }
  if (!Number.isFinite(handoverMonth) || !Number.isInteger(handoverMonth)) {
    errors.push(`handoverMonth אינו מספר שלם סופי (${handoverMonth})`);
  }
  if (errors.length > 0) return fail(errors);

  if (handoverMonth < saleMonth) {
    errors.push(`handoverMonth (${handoverMonth}) לפני saleMonth (${saleMonth})`);
  }

  errors.push(...validatePaymentTranches(tranches).errors);

  for (const [i, tranche] of tranches.entries()) {
    const { timing } = tranche;
    const ref = `מנה ${i} ("${tranche.label}")`;

    switch (timing.kind) {
      case "relativeToSale": {
        if (!Number.isFinite(timing.monthsAfterSale)) {
          errors.push(`${ref}: monthsAfterSale אינו סופי`);
          break;
        }
        if (!Number.isInteger(timing.monthsAfterSale)) {
          errors.push(`${ref}: monthsAfterSale אינו מספר שלם (${timing.monthsAfterSale}) - המנוע חודשי`);
          break;
        }
        const resolvedMonth = saleMonth + timing.monthsAfterSale;
        if (resolvedMonth < 0) errors.push(`${ref}: monthsAfterSale גורם לחודש לפני 0 (${resolvedMonth})`);
        if (resolvedMonth > handoverMonth) errors.push(`${ref}: monthsAfterSale גורם לחודש אחרי המסירה (${resolvedMonth} > ${handoverMonth})`);
        break;
      }
      case "projectMonth": {
        if (!Number.isFinite(timing.monthIndex)) {
          errors.push(`${ref}: monthIndex אינו סופי`);
          break;
        }
        if (!Number.isInteger(timing.monthIndex)) {
          errors.push(`${ref}: monthIndex אינו מספר שלם (${timing.monthIndex}) - המנוע חודשי`);
          break;
        }
        if (timing.monthIndex < 0 || timing.monthIndex > handoverMonth) {
          errors.push(`${ref}: monthIndex (${timing.monthIndex}) מחוץ לטווח [0, ${handoverMonth}]`);
        }
        break;
      }
      case "evenSpread": {
        const { fromMonthsAfterSale, toMonthsAfterSale } = timing;
        if (!Number.isFinite(fromMonthsAfterSale) || !Number.isFinite(toMonthsAfterSale)) {
          errors.push(`${ref}: evenSpread מכיל ערך לא סופי`);
          break;
        }
        if (!Number.isInteger(fromMonthsAfterSale) || !Number.isInteger(toMonthsAfterSale)) {
          errors.push(`${ref}: evenSpread מכיל ערך שאינו מספר שלם (${fromMonthsAfterSale}, ${toMonthsAfterSale}) - המנוע חודשי`);
          break;
        }
        if (fromMonthsAfterSale > toMonthsAfterSale) {
          errors.push(`${ref}: evenSpread.fromMonthsAfterSale (${fromMonthsAfterSale}) אחרי toMonthsAfterSale (${toMonthsAfterSale})`);
        }
        const resolvedFrom = saleMonth + fromMonthsAfterSale;
        const resolvedTo = saleMonth + toMonthsAfterSale;
        if (resolvedFrom < 0) errors.push(`${ref}: evenSpread מתחיל לפני חודש 0 (${resolvedFrom})`);
        if (resolvedTo > handoverMonth) errors.push(`${ref}: evenSpread מסתיים אחרי המסירה (${resolvedTo} > ${handoverMonth})`);
        break;
      }
      case "evenSpreadToHandover": {
        const { fromMonthsAfterSale } = timing;
        if (!Number.isFinite(fromMonthsAfterSale)) {
          errors.push(`${ref}: evenSpreadToHandover.fromMonthsAfterSale אינו סופי`);
          break;
        }
        if (!Number.isInteger(fromMonthsAfterSale)) {
          errors.push(`${ref}: evenSpreadToHandover.fromMonthsAfterSale אינו מספר שלם (${fromMonthsAfterSale}) - המנוע חודשי`);
          break;
        }
        const resolvedFrom = saleMonth + fromMonthsAfterSale;
        if (resolvedFrom < 0) errors.push(`${ref}: evenSpreadToHandover מתחיל לפני חודש 0 (${resolvedFrom})`);
        if (resolvedFrom > handoverMonth) {
          errors.push(`${ref}: evenSpreadToHandover.fromMonthsAfterSale (${fromMonthsAfterSale}) מתחיל אחרי המסירה (${resolvedFrom} > ${handoverMonth})`);
        }
        break;
      }
      case "constructionProgress": {
        if (!Number.isFinite(timing.cumulativeProgress)) {
          errors.push(`${ref}: cumulativeProgress אינו סופי`);
          break;
        }
        if (timing.cumulativeProgress < 0 || timing.cumulativeProgress > 1) {
          errors.push(`${ref}: cumulativeProgress (${timing.cumulativeProgress}) מחוץ לטווח [0,1]`);
        }
        if (scheduleModel !== "legacyConstructionLinked") {
          errors.push(`${ref}: timing.kind="constructionProgress" מותר רק כש-scheduleModel="legacyConstructionLinked" (בפועל: "${scheduleModel}")`);
        }
        break;
      }
      case "handover":
        // מתורגם תמיד בדיוק לחודש המסירה - אין מה לוודא מעבר לכך
        break;
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

/**
 * מוודאת פילוג עקומת בנייה מחושב/מוזן (אחוז מצטבר, 0-1, לכל חודש): כל ערך סופי ובטווח [0,1],
 * לא-יורד (מצטבר אמיתי, לא יכול "לרדת" בין חודשים), והערך האחרון קרוב ל-1 (100%) בסבילות.
 */
export function validateCumulativePercentByMonth(values: number[]): ValidationResult {
  if (values.length === 0) return fail(["עקומת בנייה ריקה"]);

  const errors: string[] = [];
  let previous = 0;

  for (const [i, value] of values.entries()) {
    if (!Number.isFinite(value)) {
      errors.push(`חודש ${i}: ערך אינו סופי (${value})`);
      continue;
    }
    if (value < 0 || value > 1) {
      errors.push(`חודש ${i}: ערך מחוץ לטווח [0,1] (${value})`);
    }
    if (value < previous - FRACTION_SUM_TOLERANCE) {
      errors.push(`חודש ${i}: הערך המצטבר (${value}) קטן מהחודש הקודם (${previous}) - עקומה חייבת להיות לא-יורדת`);
    }
    previous = value;
  }

  const last = values[values.length - 1];
  if (Number.isFinite(last) && Math.abs(last - 1) > FRACTION_SUM_TOLERANCE) {
    errors.push(`הערך המצטבר בחודש האחרון הוא ${last}, אמור להיות קרוב ל-1 (100%)`);
  }

  return errors.length === 0 ? ok() : fail(errors);
}

/** שומר גלוי: guaranteeCommission/unusedCreditCommission/interest אסורים כמזהי עלות מתוזמנים - הם תוצרי
 *  הלולאה החודשית עצמה (ר' cashflow-types.ts), לא סעיפי קלט. */
export function isCashFlowCostItemId(id: string): id is CashFlowCostItemId {
  return (CASH_FLOW_COST_ITEM_IDS as readonly string[]).includes(id);
}

/** ולידציית טעינה: מזהה מפתחות לא-חוקיים ב-costTimingOverrides שהגיעו ממקור לא-מוקלד (JSON חיצוני וכו') */
export function validateCostTimingOverrideKeys(keys: string[]): ValidationResult {
  const invalid = keys.filter((k) => !isCashFlowCostItemId(k));
  return invalid.length === 0 ? ok() : fail(invalid.map((k) => `מזהה עלות לא מוכר: "${k}"`));
}

/**
 * שיעורי ערבות אמיתיים (evidenced: 0.85%, 1%) הם תמיד קטנים מאוד. בשונה מ-PaymentTranche.fraction
 * (שם ערכים כמו 0.15/0.70 טבעיים), טווח [0,1] גרידא לא תופס טעות אחוז-במקום-שבר כאן: 0.85 (=85%,
 * כנראה הוזן במקום 0.0085) הוא עדיין "בטווח [0,1]". תקרה נדיבה בכוונה (20% שנתי) שעדיין תופסת את
 * הטעות הנפוצה בלי לפסול שיעור חריג אך אמיתי.
 */
const MAX_PLAUSIBLE_GUARANTEE_RATE = 0.2;

/**
 * מוודאת מנגנון ערבות בודד: annualRateFraction סופי, לא שלילי, ומתחת לתקרה סבירה (או
 * "requiresVerification" כשמותר), durationMonths (kombinatsiaOwner בלבד) שלם ולא-שלילי.
 */
export function validateGuaranteeMechanism(mechanism: GuaranteeMechanism): ValidationResult {
  const errors: string[] = [];

  const rate = mechanism.annualRateFraction;
  const rateIsVerificationPlaceholder = mechanism.kind === "unitCompensationOwner" && rate === "requiresVerification";
  if (!rateIsVerificationPlaceholder) {
    if (typeof rate !== "number" || !Number.isFinite(rate)) {
      errors.push(`annualRateFraction אינו מספר סופי (${rate})`);
    } else if (rate < 0) {
      errors.push(`annualRateFraction (${rate}) שלילי`);
    } else if (rate > MAX_PLAUSIBLE_GUARANTEE_RATE) {
      errors.push(
        `annualRateFraction (${rate}) גבוה בהרבה משיעורי ערבות מוכרים (0.85%-1%) - האם הוזן אחוז (למשל 0.85) במקום שבר (0.0085)?`
      );
    }
  }

  if (mechanism.kind === "kombinatsiaOwner") {
    if (!Number.isInteger(mechanism.durationMonths) || mechanism.durationMonths < 0) {
      errors.push(`durationMonths חייב להיות מספר שלם לא-שלילי (${mechanism.durationMonths})`);
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

/** מוודאת שמערך השלבים של חודש תזרים תקין: לפחות שלב אחד, כל ערך מוכר, בלי כפילויות */
export function validatePhases(phases: ProjectPhase[]): ValidationResult {
  const errors: string[] = [];

  if (phases.length === 0) {
    errors.push("מערך השלבים ריק - חייב לפחות שלב אחד");
  }

  const unknown = phases.filter((p) => !(PROJECT_PHASES as readonly string[]).includes(p));
  if (unknown.length > 0) {
    errors.push(...unknown.map((p) => `שלב לא מוכר: "${p}"`));
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const p of phases) {
    if (seen.has(p)) duplicates.add(p);
    seen.add(p);
  }
  if (duplicates.size > 0) {
    errors.push(...Array.from(duplicates).map((p) => `שלב כפול: "${p}"`));
  }

  return errors.length === 0 ? ok() : fail(errors);
}
