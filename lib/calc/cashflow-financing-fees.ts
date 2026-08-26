// commit 6d: לוח עמלות מימון טהור בלבד (עמלת פתיחת תיק + עמלת אי-ניצול מסגרת). עדיין לא מחובר
// לתזרים המזומן, להון, לאשראי או לריבית - אין מסכים ואין חיבור למערכת הקיימת. ר' GEN2_CASHFLOW_DESIGN.md
// §4 (עדכון 6d מתעד את שלוש אפשרויות בסיס עמלת אי-הניצול, בלי לבחור ביניהן כברירת מחדל).

const MONEY_EPSILON_NIS = 0.01; // ר' cashflow-interest-engine.ts commit 5b - אותו עיקרון

/**
 * שתי צורות מפורשות, לא נוסחה כללית: סכום קבוע (fixedAmount) או שבר מפורש ממסגרת שמצוינת במפורש
 * (facilityFraction) - facilityBaseNis אינו נגזר בשקט ממסגרת אחרת (creditFacilityLimitNis וכו')
 * בשום מקום במודול הזה, גם כשהוא יחובר בעתיד לתזרים.
 */
export type FacilityOpeningFee =
  | { kind: "fixedAmount"; amountNis: number; chargeMonthIndex: number }
  | { kind: "facilityFraction"; fraction: number; facilityBaseNis: number; chargeMonthIndex: number };

export type UnusedFacilityBalanceBasis =
  | "openingAvailableFacility"
  | "closingAvailableFacility"
  | "averageOpeningClosingAvailableFacility";

export interface UnusedFacilityCommissionAssumptions {
  annualRateFraction: number;
  /** אין ברירת מחדל שקטה - שדה חובה, לא Optional */
  balanceBasis: UnusedFacilityBalanceBasis;
  startMonthIndex: number;
  /** גבול לא-כולל, כמו releaseMonthIndex ב-cashflow-guarantees.ts - עד lastMonth+1 מותר (פעיל עד סוף הציר) */
  endMonthIndexExclusive: number;
}

export interface DebtBalanceMonthInput {
  monthIndex: number;
  facilityLimitNis: number;
  openingDebtBalanceNis: number;
  closingDebtBalanceNis: number;
}

export interface FinancingFeeScheduleInput {
  /** ציר החודשים המפורש - רציף, ממוין, בלי כפילויות, עם יתרות המסגרת/החוב הרלוונטיות לכל חודש */
  monthlyDebtBalances: DebtBalanceMonthInput[];
  /** אופציונלי - פרויקט בלי עמלת פתיחת תיק לגמרי הוא קלט לגיטימי (undefined, לא ערך "0" מלאכותי) */
  openingFee?: FacilityOpeningFee;
  /** אופציונלי - כנ"ל */
  unusedFacilityCommission?: UnusedFacilityCommissionAssumptions;
}

export interface FinancingFeeMonth {
  monthIndex: number;
  openingFeeExpenseNis: number;
  unusedFacilityBalanceBasisNis: number;
  unusedFacilityCommissionNis: number;
  totalFinancingFeeExpenseNis: number;
}

export interface FinancingFeeScheduleResult {
  months: FinancingFeeMonth[];
  totalOpeningFeeExpenseNis: number;
  totalUnusedFacilityCommissionNis: number;
  totalFinancingFeeExpenseNis: number;
  /**
   * commit 6d: התוצאה כאן מחושבת על תזרים "לפני עמלות" (לא סופי - ר' תיעוד computeFinancingFeeSchedule).
   * true כשקיימת עמלה חיובית כלשהי (פתיחת תיק ו/או אי-ניצול) שתצטרך להשתלב בחזרה לתזרים בהמשך -
   * לא רק כשבסיס אי-הניצול עצמו תלוי ביתרת סגירה (המקרה המעגלי המובהק), אלא בכל מקרה שיש עמלה
   * ממשית שעדיין לא נכנסה להוצאות המזומן בפועל.
   */
  requiresCashFlowRecalculation: boolean;
}

function validateFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} חייב להיות מספר סופי לא-שלילי (התקבל ${value})`);
  }
}

function validateMonthlyDebtBalances(months: DebtBalanceMonthInput[]): void {
  if (months.length === 0) {
    throw new Error("monthlyDebtBalances ריק");
  }
  for (const [i, m] of months.entries()) {
    if (!Number.isFinite(m.monthIndex) || !Number.isInteger(m.monthIndex)) {
      throw new Error(`monthlyDebtBalances[${i}].monthIndex אינו מספר שלם סופי (${m.monthIndex})`);
    }
    validateFiniteNonNegative(m.facilityLimitNis, `monthlyDebtBalances[monthIndex=${m.monthIndex}].facilityLimitNis`);
    // "יתרת חוב שלילית נדחית" - גם פתיחה וגם סגירה
    validateFiniteNonNegative(m.openingDebtBalanceNis, `monthlyDebtBalances[monthIndex=${m.monthIndex}].openingDebtBalanceNis`);
    validateFiniteNonNegative(m.closingDebtBalanceNis, `monthlyDebtBalances[monthIndex=${m.monthIndex}].closingDebtBalanceNis`);
  }
  // "אין חודשים כפולים או חסרים" - רציף, ממוין, בלי כפילויות (אותו דפוס כמו שאר מנועי התזרים)
  const first = months[0].monthIndex;
  for (const [i, m] of months.entries()) {
    const expected = first + i;
    if (m.monthIndex !== expected) {
      throw new Error(
        `monthlyDebtBalances חייב להיות רציף, ממוין, בלי כפילויות: באינדקס ${i} צפוי monthIndex=${expected}, התקבל ${m.monthIndex}`
      );
    }
  }
}

/**
 * עמלת פתיחת תיק בפועל היא בדרך כלל שברירי אחוזים בודדים מהמסגרת. תקרה נדיבה בכוונה שעדיין תופסת
 * טעות אחוז-במקום-שבר (0.05 = 5% מהמסגרת, הרבה מעל מקובל בפועל).
 */
const MAX_PLAUSIBLE_OPENING_FEE_FRACTION = 0.05;

function validateOpeningFee(fee: FacilityOpeningFee, firstMonth: number, lastMonth: number): void {
  if (!Number.isFinite(fee.chargeMonthIndex) || !Number.isInteger(fee.chargeMonthIndex)) {
    throw new Error(`openingFee.chargeMonthIndex אינו מספר שלם סופי (${fee.chargeMonthIndex})`);
  }
  if (fee.chargeMonthIndex < firstMonth || fee.chargeMonthIndex > lastMonth) {
    throw new Error(`openingFee.chargeMonthIndex (${fee.chargeMonthIndex}) מחוץ לציר הפרויקט [${firstMonth}, ${lastMonth}]`);
  }

  if (fee.kind === "fixedAmount") {
    validateFiniteNonNegative(fee.amountNis, "openingFee.amountNis");
    return;
  }

  // facilityFraction
  if (!Number.isFinite(fee.fraction) || fee.fraction < 0) {
    throw new Error(`openingFee.fraction חייב להיות מספר סופי לא-שלילי (התקבל ${fee.fraction})`);
  }
  if (fee.fraction > MAX_PLAUSIBLE_OPENING_FEE_FRACTION) {
    throw new Error(
      `openingFee.fraction (${fee.fraction}) גבוה בהרבה מעמלות פתיחת תיק מקובלות - האם הוזן אחוז (למשל 1) במקום שבר (0.01)?`
    );
  }
  validateFiniteNonNegative(fee.facilityBaseNis, "openingFee.facilityBaseNis");
}

/**
 * שיעורי עמלת אי-ניצול אמיתיים הם תמיד קטנים (בדרך כלל מתחת ל-1%-2% שנתי). תקרה נדיבה בכוונה
 * (10% שנתי) שעדיין תופסת בבירור טעות אחוז-במקום-שבר כמו 0.85 (=85%, כנראה הוזן במקום 0.0085).
 */
const MAX_PLAUSIBLE_UNUSED_FACILITY_RATE = 0.1;

function validateUnusedFacilityCommission(
  assumptions: UnusedFacilityCommissionAssumptions,
  firstMonth: number,
  lastMonth: number
): void {
  const { annualRateFraction, startMonthIndex, endMonthIndexExclusive } = assumptions;

  if (!Number.isFinite(annualRateFraction) || annualRateFraction < 0) {
    throw new Error(`unusedFacilityCommission.annualRateFraction חייב להיות מספר סופי לא-שלילי (התקבל ${annualRateFraction})`);
  }
  if (annualRateFraction > MAX_PLAUSIBLE_UNUSED_FACILITY_RATE) {
    throw new Error(
      `unusedFacilityCommission.annualRateFraction (${annualRateFraction}) גבוה בהרבה משיעורי עמלת אי-ניצול מקובלים - ` +
        `האם הוזן אחוז (למשל 0.85) במקום שבר (0.0085)?`
    );
  }

  if (!Number.isFinite(startMonthIndex) || !Number.isInteger(startMonthIndex)) {
    throw new Error(`unusedFacilityCommission.startMonthIndex אינו מספר שלם סופי (${startMonthIndex})`);
  }
  if (startMonthIndex < firstMonth || startMonthIndex > lastMonth) {
    throw new Error(`unusedFacilityCommission.startMonthIndex (${startMonthIndex}) מחוץ לציר הפרויקט [${firstMonth}, ${lastMonth}]`);
  }

  if (!Number.isFinite(endMonthIndexExclusive) || !Number.isInteger(endMonthIndexExclusive)) {
    throw new Error(`unusedFacilityCommission.endMonthIndexExclusive אינו מספר שלם סופי (${endMonthIndexExclusive})`);
  }
  if (endMonthIndexExclusive <= startMonthIndex) {
    throw new Error(
      `unusedFacilityCommission.endMonthIndexExclusive (${endMonthIndexExclusive}) חייב להיות גדול מ-startMonthIndex (${startMonthIndex})`
    );
  }
  if (endMonthIndexExclusive > lastMonth + 1) {
    throw new Error(
      `unusedFacilityCommission.endMonthIndexExclusive (${endMonthIndexExclusive}) מחוץ לטווח האפשרי [${startMonthIndex + 1}, ${lastMonth + 1}]`
    );
  }
}

function computeUnusedFacilityBasis(
  basis: UnusedFacilityBalanceBasis,
  facilityLimitNis: number,
  openingDebtBalanceNis: number,
  closingDebtBalanceNis: number
): number {
  // Math.max(0, ...) - חוב מעל המסגרת לא יוצר בסיס שלילי, החריגה עצמה נשארת עניין של מנוע התזרים
  const openingAvailableFacilityNis = Math.max(0, facilityLimitNis - openingDebtBalanceNis);
  const closingAvailableFacilityNis = Math.max(0, facilityLimitNis - closingDebtBalanceNis);

  switch (basis) {
    case "openingAvailableFacility":
      return openingAvailableFacilityNis;
    case "closingAvailableFacility":
      return closingAvailableFacilityNis;
    case "averageOpeningClosingAvailableFacility":
      return (openingAvailableFacilityNis + closingAvailableFacilityNis) / 2;
  }
}

/**
 * מנוע לוח עמלות מימון טהור: עמלת פתיחת תיק (חד-פעמית, שתי צורות מפורשות) + עמלת אי-ניצול מסגרת
 * (חודשית, בסיס נבחר מפורשות מבין שלוש אפשרויות). **תוצאה זמנית, לא תזרים סופי** - מחושבת על יתרות
 * חוב/מסגרת שכבר קיימות (מ-computeInterestCashFlow, "לפני עמלות"), לא מזינה את עצמה בחזרה לתזרים.
 * כשבסיס העמלה תלוי ביתרת סגירה, שילוב העמלה בפועל לתזרים (commit עתידי) עשוי לשנות את משיכת
 * האשראי ואת יתרת הסגירה עצמה - תלות מעגלית שלא נפתרת כאן, רק מסומנת ב-requiresCashFlowRecalculation.
 *
 * לכל חודש: openingFeeExpenseNis מחויב פעם אחת בדיוק, ב-openingFee.chargeMonthIndex בלבד (לא לפני
 * ולא אחרי). unusedFacilityCommissionNis מחושב רק בחלון [startMonthIndex, endMonthIndexExclusive)
 * מ-unusedFacilityCommissionNis = בסיס נבחר * annualRateFraction / 12.
 */
export function computeFinancingFeeSchedule(input: FinancingFeeScheduleInput): FinancingFeeScheduleResult {
  const { monthlyDebtBalances, openingFee, unusedFacilityCommission } = input;

  validateMonthlyDebtBalances(monthlyDebtBalances);
  const firstMonth = monthlyDebtBalances[0].monthIndex;
  const lastMonth = monthlyDebtBalances[monthlyDebtBalances.length - 1].monthIndex;

  if (openingFee) validateOpeningFee(openingFee, firstMonth, lastMonth);
  if (unusedFacilityCommission) validateUnusedFacilityCommission(unusedFacilityCommission, firstMonth, lastMonth);

  const months: FinancingFeeMonth[] = monthlyDebtBalances.map((m) => {
    let openingFeeExpenseNis = 0;
    if (openingFee && m.monthIndex === openingFee.chargeMonthIndex) {
      openingFeeExpenseNis =
        openingFee.kind === "fixedAmount" ? openingFee.amountNis : openingFee.facilityBaseNis * openingFee.fraction;
    }

    let unusedFacilityBalanceBasisNis = 0;
    let unusedFacilityCommissionNis = 0;
    if (
      unusedFacilityCommission &&
      m.monthIndex >= unusedFacilityCommission.startMonthIndex &&
      m.monthIndex < unusedFacilityCommission.endMonthIndexExclusive
    ) {
      unusedFacilityBalanceBasisNis = computeUnusedFacilityBasis(
        unusedFacilityCommission.balanceBasis,
        m.facilityLimitNis,
        m.openingDebtBalanceNis,
        m.closingDebtBalanceNis
      );
      unusedFacilityCommissionNis = (unusedFacilityBalanceBasisNis * unusedFacilityCommission.annualRateFraction) / 12;
    }

    const totalFinancingFeeExpenseNis = openingFeeExpenseNis + unusedFacilityCommissionNis;

    return {
      monthIndex: m.monthIndex,
      openingFeeExpenseNis,
      unusedFacilityBalanceBasisNis,
      unusedFacilityCommissionNis,
      totalFinancingFeeExpenseNis,
    };
  });

  let totalOpeningFeeExpenseNis = 0;
  let totalUnusedFacilityCommissionNis = 0;
  let totalFinancingFeeExpenseNis = 0;
  for (const month of months) {
    totalOpeningFeeExpenseNis += month.openingFeeExpenseNis;
    totalUnusedFacilityCommissionNis += month.unusedFacilityCommissionNis;
    totalFinancingFeeExpenseNis += month.totalFinancingFeeExpenseNis;
  }

  const requiresCashFlowRecalculation = totalFinancingFeeExpenseNis > MONEY_EPSILON_NIS;

  return {
    months,
    totalOpeningFeeExpenseNis,
    totalUnusedFacilityCommissionNis,
    totalFinancingFeeExpenseNis,
    requiresCashFlowRecalculation,
  };
}
