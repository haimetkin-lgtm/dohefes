// טיפוסי מנוע התזרים החודשי (דור 2, שלב תזרים ומימון).
// תכנון מלא ב-GEN2_CASHFLOW_DESIGN.md (גרסה 4, מאושרת). קובץ זה הוא commit 1 בלבד מתוך היישום:
// טיפוסים + קבועים + ולידציה. אין כאן computeCashFlow, אין שינוי למסכים, ואין שינוי לתוצאת
// computeProject/ProjectResult הקיימים - זו שכבה תוספתית לגמרי, לא נקראת מהמנוע הקיים בשום מקום.

import type { UnitCategory } from "./types";

export const CASH_FLOW_SCHEMA_VERSION = 1;

// --- לוח תקבולים (מפרט §3) ---

export type PaymentTiming =
  | { kind: "relativeToSale"; monthsAfterSale: number }
  | { kind: "projectMonth"; monthIndex: number }
  /** קצוות קבועים יחסית למכירה - שימושי לחוזה עם תאריך סיום פריסה ספציפי, לא תלוי-מסירה */
  | { kind: "evenSpread"; fromMonthsAfterSale: number; toMonthsAfterSale: number }
  /**
   * פרוסה אחיד מתחילה יחסית למכירה ועד חודש המסירה עצמו (handoverMonth, נגזר בזמן ריצה, לא קבוע
   * מראש) - preset ה-15/70/15 הכללי צריך את זה, לא evenSpread עם toMonthsAfterSale קשיח: batch
   * שנמכר מאוחר יותר עדיין מסתיים בדיוק במסירה, לא חורג ממנה. אם fromMonthsAfterSale מביא את
   * תחילת הפריסה בדיוק לחודש המסירה, כל המנה מתקבלת באותו חודש (טווח של חודש יחיד).
   */
  | { kind: "evenSpreadToHandover"; fromMonthsAfterSale: number }
  /** לצורך legacyConstructionLinked בלבד, ר' §3.1 */
  | { kind: "constructionProgress"; cumulativeProgress: number }
  | { kind: "handover" };

export interface PaymentTranche {
  /** 0-1, לא מצטבר. סכום כל המנות של אותה קטגוריה = 1 בדיוק (בסבילות, ר' validatePaymentTranches) */
  fraction: number;
  timing: PaymentTiming;
  /** לתצוגה בלבד, למשל "בחתימה" / "בהתקדמות" / "במסירה" */
  label: string;
}

export type SaleScheduleModel = "explicitSchedule" | "legacyConstructionLinked";

export interface SalesScheduleAssumptions {
  model: SaleScheduleModel;
  byCategory: Partial<Record<UnitCategory, PaymentTranche[]>>;
  /** מועד חתימת חוזה המכר, נפרד ממועד קבלת כל תשלום */
  saleMonthByCategory: Partial<Record<UnitCategory, number>>;
}

// --- עקומת בנייה (מפרט §7) ---

/**
 * union מבחין: linear/sCurve/legacy מחשבים את הפילוג בזמן ריצה (אין מערך מאוחסן), custom הוא היחיד
 * עם מערך קלט אמיתי מהמשתמש. חייב לסכם בדיוק ל-100% בחודש האחרון בכל המודלים.
 */
export type ConstructionCurveAssumptions =
  | { model: "linear" }
  | { model: "sCurve"; shapeParameter?: number }
  | { model: "legacy" }
  | { model: "custom"; cumulativePercentByMonth: number[] };

// --- ערבויות (מפרט §6) ---

/**
 * annualRateFraction, לא ratePct: אחיד עם שאר המנוע (guaranteeCommissionRate וכו' ב-CostInputs
 * הקיים, וגם PaymentTranche.fraction) - ערך 0-1, למשל 0.0085 = 0.85%. שם "ratePct" קודם היה עמום
 * (85 או 0.85?), בדיוק אותה סכנה שכבר תוקנה ב-PaymentTranche.fraction.
 */
export type GuaranteeMechanism =
  | { kind: "buyerSaleLaw"; annualRateFraction: number }
  | { kind: "kombinatsiaOwner"; annualRateFraction: number; durationMonths: number }
  | { kind: "unitCompensationOwner"; annualRateFraction: number | "requiresVerification" };

// --- עיתוי עלויות (מפרט §2) ---

/**
 * לא keyof CostInputs: מכסה גם סעיפי קרקע (LandInputs, נפרד מ-CostInputs) וגם ערכים מחושבים
 * (תיווך, מס רכישה) שאינם שדה קלט גולמי. במפורש לא כולל guaranteeCommission, unusedCreditCommission,
 * interest - אלה תוצרי הלולאה החודשית עצמה, אין להם timing חיצוני.
 *
 * commit 7-prep: **גם `accountOpeningCommission` הוסר מכאן** (הוסרה שורה `"accountOpeningCommission"`
 * שהייתה כאן) - היה מקור אמת כפול מול `FacilityOpeningFee` (`cashflow-financing-fees.ts`, commit 6d),
 * שכבר מחשבת עמלת פתיחת תיק/הקמת מסגרת עם עיתוי מפורש (`chargeMonthIndex`) משלה. עמלת פתיחת תיק
 * מתוזמנת **אך ורק** דרך `FacilityOpeningFee` מעכשיו, לא כפריט עלות מתוזמן כאן.
 */
/** מקור האמת היחיד למזהי העלות - הטיפוס נגזר מהמערך, לא מוגדר בנפרד (מונע סטייה בין השניים) */
export const CASH_FLOW_COST_ITEM_IDS = [
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
] as const;

export type CashFlowCostItemId = (typeof CASH_FLOW_COST_ITEM_IDS)[number];

export type CostTimingRuleKind =
  | "landPurchaseMonth"
  | "permitMonth"
  | "escortStart"
  | "constructionStart"
  | "preCompletion"
  | "spreadOverConstruction"
  | "spreadOverEscort"
  | "spreadOverRelocation"
  | "salesCurve"
  | "requiresProjectAgreement";

export interface CostTimingRule {
  /** גלוי תמיד למשתמש, לא קבור בנוסחה */
  rule: CostTimingRuleKind;
  /** הסבר חופשי, בעיקר לסעיפים "דורש התאמה לפרויקט" */
  note?: string;
}

// --- תוצאה חודשית ---

/** מקור האמת היחיד לשלבי הפרויקט - הטיפוס נגזר מהמערך, בדיוק כמו CASH_FLOW_COST_ITEM_IDS למעלה.
 *  חודש בפועל יכול להשתייך למספר שלבים בו-זמנית (מערך, לא ערך יחיד) - שיווק חופף לבנייה, שכירות
 *  לדיירים חופפת להיתר/ביצוע, ליווי בנקאי חוצה כמה שלבים */
export const PROJECT_PHASES = ["permit", "demolition", "construction", "marketing", "handover"] as const;

export type ProjectPhase = (typeof PROJECT_PHASES)[number];
