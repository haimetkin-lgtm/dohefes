// ולידציה טהורה למבני התזרים (commit 1). אין כאן לוגיקת חישוב תזרים בפועל - רק בדיקות מבניות
// על טיפוסים שכבר מולאו, לשימוש עתידי גם בתוך computeCashFlow (commit 4+) וגם כבדיקות vitest (commit 6).

import type { CashFlowCostItemId, PaymentTranche } from "./cashflow-types";

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
 * מוודאת שסכום המנות של לוח תקבולים אחת (קטגוריית יחידות אחת) תקין: כל fraction סופי, בטווח [0,1]
 * (דוחה במפורש ערך כמו 15 במקום 0.15 - זו בדיוק הטעות שהיחידה fraction נועדה למנוע), ואין ערך שלילי.
 * הסכום הכולל חייב להיות קרוב ל-1 בסבילות FRACTION_SUM_TOLERANCE, לא שוויון מדויק (floating point).
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

const CASH_FLOW_COST_ITEM_IDS: readonly CashFlowCostItemId[] = [
  "landPurchase",
  "bettermentLevy",
  "brokerage",
  "purchaseTax",
  "electricConnection",
  "planningFlat",
  "planningConsultants",
  "engineeringInspection",
  "marketing",
  "legal",
  "legalRefund",
  "financialSupervision",
  "overhead",
  "managementFee",
  "contingency",
  "municipalFees",
  "organizerFee",
  "relocationRent",
  "demolition",
  "constructionResidential",
  "constructionResidentialPremium",
  "constructionCommercial",
  "constructionOffice",
  "constructionPublicBuilding",
  "constructionExistingStructure",
  "constructionUnderground",
  "constructionDevelopment",
  "accountOpeningCommission",
];

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
