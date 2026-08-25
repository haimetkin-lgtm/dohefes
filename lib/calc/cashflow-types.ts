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
  | { kind: "evenSpread"; fromMonthsAfterSale: number; toMonthsAfterSale: number }
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

// --- מימון (מפרט §4) ---

/**
 * "closingDebtBeforeInterest": ריבית מחושבת על יתרת החוב אחרי משיכה/פירעון של אותו חודש, לפני
 * הוספת הריבית של אותו חודש עצמו - פותר מעגליות (יתרה→ריבית→אשראי→יתרה חדשה).
 */
export type InterestBalanceBasis = "closingDebtBeforeInterest" | "averageOpeningAndPreInterestClosing";

/** יחיד בגרסה הראשונה: מבוסס על יתרת פתיחת החודש, לא על יתרה אחרי משיכה - פותר מעגליות נפרדת מזו של הריבית */
export type UnusedCreditCommissionBalanceBasis = "openingDebt";

export type EquityInjectionMode = "asNeededUpToCap" | "proRata";

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
  "accountOpeningCommission",
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

// --- הנחות מלאות ---

export interface CashFlowAssumptions {
  schemaVersion: number;
  salesSchedule: SalesScheduleAssumptions;
  constructionCurve: ConstructionCurveAssumptions;
  /** ברירת מחדל "closingDebtBeforeInterest" */
  interestBalanceBasis: InterestBalanceBasis;
  /** "openingDebt", יחיד לעת עתה */
  unusedCreditCommissionBalanceBasis: UnusedCreditCommissionBalanceBasis;
  /** ברירת מחדל "asNeededUpToCap" */
  equityInjectionMode: EquityInjectionMode;
  equityCapNis: number;
  /** ברירת מחדל 0 */
  minimumCashBalanceNis: number;
  /** "auto" מותר רק בתרחישי דמו/דוגמה, ר' §4.1. פרויקט אמיתי מחייב ערך מפורש */
  creditFacilityLimitNis: number | "auto";
  guarantees: GuaranteeMechanism[];
  costTimingOverrides?: Partial<Record<CashFlowCostItemId, CostTimingRule>>;
}

// --- תוצאה חודשית ---

/** בשונה מ-CashFlowMonth.phase (יחיד) הקודם: חודש בפועל יכול להשתייך למספר שלבים בו-זמנית -
 *  שיווק חופף לבנייה, שכירות לדיירים חופפת להיתר/ביצוע, ליווי בנקאי חוצה כמה שלבים */
export type ProjectPhase = "permit" | "demolition" | "construction" | "marketing" | "handover";

export interface CashFlowMonth {
  monthIndex: number;
  /** לפחות שלב אחד, בלי כפילויות - ר' validatePhases */
  phases: ProjectPhase[];

  openingCashBalanceNis: number;
  openingDebtBalanceNis: number;
  closingCashBalanceNis: number;
  closingDebtBalanceNis: number;

  operatingInflowsNis: number;
  operatingOutflowsNis: number;
  equityInjectionNis: number;

  /** מה שנשאר מהמסגרת בפועל, לפני המשיכה של אותו חודש */
  availableFacilityNis: number;
  creditDrawNis: number;
  creditRepaymentNis: number;
  /** כשל מימון גלוי - כשהמסגרת לא הספיקה. לא מומצא כסף, ר' §4.3 */
  fundingShortfallNis: number;

  interestNis: number;
  buyerGuaranteeCommissionNis: number;
  kombinatsiaOwnerGuaranteeCommissionNis: number;
  unitCompensationGuaranteeCommissionNis: number;
  unusedCreditCommissionNis: number;
}

export interface FinancingSummary {
  peakDebtBalanceNis: number;
  peakDebtMonthIndex: number;
  totalInterestNis: number;
  totalBuyerGuaranteeCommissionNis: number;
  totalKombinatsiaOwnerGuaranteeCommissionNis: number;
  totalUnitCompensationGuaranteeCommissionNis: number;
  totalUnusedCreditCommissionNis: number;
  interestBalanceBasisUsed: InterestBalanceBasis;
  unusedCreditCommissionBalanceBasisUsed: UnusedCreditCommissionBalanceBasis;
  creditFacilityLimitNisUsed: number;
  peakFacilityUtilizationRatio: number | null;
  /** הכי גדול שחסר בחודש בודד כלשהו, 0 אם אין כשל מימון */
  maximumFundingShortfallNis: number;
  /** true אם יש חודש כלשהו עם fundingShortfallNis > 0 */
  facilityExceeded: boolean;
}

/**
 * שתי התאמות נפרדות לתרחיש הבסיס (ר' §2.1): עלויות תפעוליות (scheduledOperatingCostsNis מול
 * baseOperatingCostsNis, אמור להיות ≈0 הפרש) לעומת עמלות מימון (לא נדרש שוויון לקירוב הסטטי הישן,
 * זה בדיוק מה שדור 2 בא לתקן, לא לשחזר).
 */
export interface CashFlowReconciliation {
  scheduledOperatingCostsNis: number;
  /** = indirectNis + directConstructionNis + landNis, מהמנוע הקיים (computeCosts) */
  baseOperatingCostsNis: number;
  accountOpeningCommissionNis: number;
  totalGuaranteeCommissionsNis: number;
  totalUnusedCreditCommissionNis: number;
  totalInterestNis: number;
  operatingCostDifferenceNis: number;
}

export interface CashFlowResult {
  months: CashFlowMonth[];
  financing: FinancingSummary;
  reconciliation: CashFlowReconciliation;
  warnings: string[];
  missingAssumptions: string[];
  /** false אם missingAssumptions לא ריק, או אם financing.facilityExceeded=true */
  isComplete: boolean;
}
