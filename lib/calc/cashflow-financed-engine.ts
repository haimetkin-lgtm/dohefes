// commit 6c: שכבת orchestration שמשלבת הוצאות ערבות (cashflow-guarantees.ts) לתוך התזרים הממומן -
// בלי לשכפל את לוגיקת computeInterestCashFlow (cashflow-interest-engine.ts): השכבה הזו רק מרכיבה
// את התזרים המשולב (תפעולי + ערבויות) ומעבירה אותו למנוע הריבית הקיים כמו שהוא. עדיין בלי עמלת
// אי-ניצול, עמלת פתיחת תיק, IRR/NPV, מסכים, ProjectInputs, Supabase או Excel.

import { computeInterestCashFlow } from "./cashflow-interest-engine";
import type { InterestCashFlowAssumptions, InterestCashFlowMonthInput } from "./cashflow-interest-engine";
import { validatePhases } from "./cashflow-validation";
import type { GuaranteeMonth, GuaranteeScheduleResult } from "./cashflow-guarantees";
import type { ProjectPhase } from "./cashflow-types";

/** ר' cashflow-interest-engine.ts commit 5b / cashflow-guarantees.ts commit 6a - אותו עיקרון:
 *  מוחל רק על השוואת סכומים מול סף (אימות פנימי), לא עיגול כללי של תוצאה כלשהי. */
const MONEY_EPSILON_NIS = 0.01;

export interface OperatingMonthInput {
  monthIndex: number;
  operatingInflowsNis: number;
  /**
   * operatingOutflowsNis כולל עלויות פרויקט תפעוליות בלבד, ואינו כולל ערבויות, ריבית, עמלת פתיחת
   * תיק או עמלת אי-ניצול - ארבעתם תוצרי שכבות מימון ייעודיות במורד הזרימה (guaranteeSchedule
   * כאן; ריבית ב-computeInterestCashFlow; שתי העמלות ב-computeFinancingFeeSchedule, נכנסות רק
   * דרך computeCompleteFinancing), לא קלט לשכבה הזו. **אין לכלול כאן הוצאות ערבות בפרט** - מקור
   * האמת היחיד להוצאות ערבות הוא guaranteeSchedule (GuaranteeScheduleResult), המתווסף על ידי
   * השכבה הזו בעצמה. הזנת הוצאת ערבות גם כאן וגם דרך guaranteeSchedule תגרום לחיוב כפול - השכבה
   * הזו אינה יכולה לזהות זאת אוטומטית (אין לה דרך להבחין בין תשלום תפעולי "אמיתי" לבין הוצאת
   * ערבות שהוזנה כאן בטעות), האחריות על הקוד הקורא. באופן דומה, ריבית/עמלות מימון לעולם אינן
   * מגיעות מכאן - הן תמיד מחושבות במורד הזרימה על בסיס יתרות שהמנוע הזה עצמו מפיק.
   *
   * חסימה מבנית תואמת קיימת גם בקצה השני של השרשרת: CashFlowCostItemId (cashflow-types.ts)
   * מגדיר במפורש אילו סעיפי עלות מותר לתזמן דרך costSchedule - הרשימה **אינה כוללת** guaranteeCommission/
   * unusedCreditCommission/interest/accountOpeningCommission בשום צורה, ו-computeCostSchedule
   * זורק שגיאה על כל מפתח שאינו ברשימה. משתמש קצה לא יכול, גם דרך שכבת ה-UI העתידית, להזין רכיב
   * מימון כלשהו כ"סעיף עלות" בטעות - השדה שהיה מכיל אותו פשוט לא קיים בטיפוס.
   */
  operatingOutflowsNis: number;
  phases: ProjectPhase[];
}

export interface FinancedCashFlowInput {
  /** ציר החודשים הסמכותי (התזרים התפעולי) - רציף, ממוין, בלי כפילויות. סדר הפלט נשמר לפי הסדר הזה. */
  operatingMonths: OperatingMonthInput[];
  /** תוצאת cashflow-guarantees.ts. חייבת לכסות בדיוק את אותם monthIndex כמו operatingMonths - לא
   *  פחות, לא יותר. הסדר הפנימי של guaranteeSchedule.months אינו חייב להיות זהה - ההתאמה נעשית
   *  לפי monthIndex, לא לפי מיקום במערך. */
  guaranteeSchedule: GuaranteeScheduleResult;
  interestAssumptions: InterestCashFlowAssumptions;
}

export interface FinancedCashFlowMonth {
  monthIndex: number;
  operatingInflowsNis: number;
  operatingOutflowsNis: number;
  guaranteeExpenseNis: number;
  /** = operatingOutflowsNis + guaranteeExpenseNis. זה, ורק זה, מה שמועבר כ-outflowsNis למנוע הריבית */
  totalCashOutflowsNis: number;
  equityInjectionNis: number;
  creditDrawNis: number;
  creditRepaymentNis: number;
  interestExpenseNis: number;
  closingCashBalanceNis: number;
  closingDebtBalanceNis: number;
  fundingDeficitBalanceNis: number;
  facilityBreachNis: number;
}

export interface FinancedCashFlowResult {
  months: FinancedCashFlowMonth[];
  totalOperatingOutflowsNis: number;
  /** מקור האמת: guaranteeSchedule.totalGuaranteeExpenseNis, לא מחושב מחדש כאן - רק מאומת מול הפירוט החודשי */
  totalGuaranteeExpenseNis: number;
  totalInterestExpenseNis: number;
  totalEquityInjectedNis: number;
  peakClosingDebtBalanceNis: number;
  /** commit 8a: מ-computeInterestCashFlow ישירות - לא מחושב מחדש כאן (ר' §8a) */
  peakClosingDebtBalanceMonthIndex: number | null;
  peakFundingDeficitNis: number;
  /** commit 8a: מ-computeInterestCashFlow ישירות - לא מחושב מחדש כאן */
  firstFundingDeficitMonthIndex: number | null;
  facilityExceeded: boolean;
  /** מקור האמת: guaranteeSchedule.activeBeyondForecast, מועבר כמו שהוא - לא מחושב מחדש */
  activeGuaranteesBeyondForecast: boolean;
}

function validateFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} חייב להיות מספר סופי לא-שלילי (התקבל ${value})`);
  }
}

function validateOperatingMonths(operatingMonths: OperatingMonthInput[]): void {
  if (operatingMonths.length === 0) {
    throw new Error("operatingMonths ריק");
  }
  for (const [i, m] of operatingMonths.entries()) {
    if (!Number.isFinite(m.monthIndex) || !Number.isInteger(m.monthIndex)) {
      throw new Error(`operatingMonths[${i}].monthIndex אינו מספר שלם סופי (${m.monthIndex})`);
    }
    validateFiniteNonNegative(m.operatingInflowsNis, `operatingMonths[monthIndex=${m.monthIndex}].operatingInflowsNis`);
    validateFiniteNonNegative(m.operatingOutflowsNis, `operatingMonths[monthIndex=${m.monthIndex}].operatingOutflowsNis`);
    const phasesCheck = validatePhases(m.phases);
    if (!phasesCheck.valid) {
      throw new Error(`operatingMonths[monthIndex=${m.monthIndex}]: phases לא תקין - ${phasesCheck.errors.join("; ")}`);
    }
  }
  const first = operatingMonths[0].monthIndex;
  for (const [i, m] of operatingMonths.entries()) {
    const expected = first + i;
    if (m.monthIndex !== expected) {
      throw new Error(
        `operatingMonths חייב להיות רציף, ממוין, בלי כפילויות: באינדקס ${i} צפוי monthIndex=${expected}, התקבל ${m.monthIndex}`
      );
    }
  }
}

/**
 * מתאימה בין ציר operatingMonths (הסמכותי) ל-guaranteeSchedule.months, **לפי monthIndex בלבד** -
 * לעולם לא לפי מיקום במערך (guaranteeSchedule.months עשוי להגיע בסדר שונה). דוחה במפורש: חודש
 * כפול בלוח הערבויות, חודש חסר (קיים ב-operatingMonths, לא בלוח הערבויות), חודש עודף (להפך).
 */
function matchGuaranteeMonths(
  operatingMonths: OperatingMonthInput[],
  guaranteeMonths: GuaranteeMonth[]
): Map<number, GuaranteeMonth> {
  const guaranteeByIndex = new Map<number, GuaranteeMonth>();
  for (const gm of guaranteeMonths) {
    if (guaranteeByIndex.has(gm.monthIndex)) {
      throw new Error(`guaranteeSchedule.months: חודש כפול (monthIndex=${gm.monthIndex})`);
    }
    guaranteeByIndex.set(gm.monthIndex, gm);
  }

  const operatingIndices = new Set(operatingMonths.map((m) => m.monthIndex));

  for (const m of operatingMonths) {
    if (!guaranteeByIndex.has(m.monthIndex)) {
      throw new Error(
        `guaranteeSchedule.months: חודש חסר עבור monthIndex=${m.monthIndex} (קיים ב-operatingMonths, לא בלוח הערבויות)`
      );
    }
  }
  for (const gm of guaranteeMonths) {
    if (!operatingIndices.has(gm.monthIndex)) {
      throw new Error(
        `guaranteeSchedule.months: חודש עודף (monthIndex=${gm.monthIndex}) שלא קיים ב-operatingMonths`
      );
    }
  }

  return guaranteeByIndex;
}

/**
 * שכבת orchestration: משלבת הוצאות ערבות (cashflow-guarantees.ts) לתוך התזרים הממומן, בלי לשכפל
 * את לוגיקת המימון/ריבית - זו נשארת אך ורק ב-computeInterestCashFlow (cashflow-interest-engine.ts).
 *
 * סדר חישוב לכל חודש:
 * 1-2. תקבולים/תשלומים תפעוליים (מ-operatingMonths, קלט).
 * 3. הוצאת ערבות (guaranteeSchedule.months[monthIndex].totalGuaranteeExpenseNis, כבר מסוכמת
 *    לכל המנגנונים הפעילים באותו חודש - לא מחושבת מחדש כאן).
 *    -> totalCashOutflowsNis = operatingOutflowsNis + guaranteeExpenseNis, זה בלבד מועבר כ-
 *    outflowsNis למנוע הריבית.
 * 4-8. הזרמת הון, משיכת אשראי (מוגבלת מראש כדי לשמור מקום לריבית), פירעון מעודף, ריבית מהוונת
 *    על יתרת חוב-לפני-ריבית, יתרות סגירה - **כל זה מתבצע בתוך computeInterestCashFlow עצמו, ללא
 *    שינוי, ללא שכפול**. הריבית ממשיכה להיות מהוונת לחוב, לא יוצאת כמזומן.
 *
 * totalGuaranteeExpenseNis ו-activeGuaranteesBeyondForecast בתוצאה **אינם מחושבים מחדש** - הם
 * guaranteeSchedule.totalGuaranteeExpenseNis / guaranteeSchedule.activeBeyondForecast כמו שהם
 * (מקור אמת יחיד), רק מאומתים מול סכום הפירוט החודשי בסבילות MONEY_EPSILON_NIS.
 */
export function computeFinancedCashFlow(input: FinancedCashFlowInput): FinancedCashFlowResult {
  const { operatingMonths, guaranteeSchedule, interestAssumptions } = input;

  validateOperatingMonths(operatingMonths);
  const guaranteeByIndex = matchGuaranteeMonths(operatingMonths, guaranteeSchedule.months);

  const combinedMonthlyInputs: InterestCashFlowMonthInput[] = operatingMonths.map((m) => {
    const guaranteeMonth = guaranteeByIndex.get(m.monthIndex)!;
    return {
      monthIndex: m.monthIndex,
      inflowsNis: m.operatingInflowsNis,
      outflowsNis: m.operatingOutflowsNis + guaranteeMonth.totalGuaranteeExpenseNis,
      phases: m.phases,
    };
  });

  const interestResult = computeInterestCashFlow(combinedMonthlyInputs, interestAssumptions);
  const interestByIndex = new Map(interestResult.months.map((m) => [m.monthIndex, m]));

  let totalOperatingOutflowsNis = 0;
  let sumGuaranteeExpenseNis = 0;

  const months: FinancedCashFlowMonth[] = operatingMonths.map((m) => {
    const guaranteeMonth = guaranteeByIndex.get(m.monthIndex)!;
    const interestMonth = interestByIndex.get(m.monthIndex);
    if (!interestMonth) {
      // לא אמור לקרות: combinedMonthlyInputs נבנה מ-operatingMonths עצמו, ו-computeInterestCashFlow
      // לא משנה/מסנן monthIndex - שומר כהגנה מפורשת, לא כתרחיש צפוי
      throw new Error(`שגיאה פנימית: computeInterestCashFlow לא החזיר חודש עבור monthIndex=${m.monthIndex}`);
    }

    const guaranteeExpenseNis = guaranteeMonth.totalGuaranteeExpenseNis;
    const totalCashOutflowsNis = m.operatingOutflowsNis + guaranteeExpenseNis;

    totalOperatingOutflowsNis += m.operatingOutflowsNis;
    sumGuaranteeExpenseNis += guaranteeExpenseNis;

    return {
      monthIndex: m.monthIndex,
      operatingInflowsNis: m.operatingInflowsNis,
      operatingOutflowsNis: m.operatingOutflowsNis,
      guaranteeExpenseNis,
      totalCashOutflowsNis,
      equityInjectionNis: interestMonth.equityInjectionNis,
      creditDrawNis: interestMonth.creditDrawNis,
      creditRepaymentNis: interestMonth.creditRepaymentNis,
      interestExpenseNis: interestMonth.interestExpenseNis,
      closingCashBalanceNis: interestMonth.closingCashBalanceNis,
      closingDebtBalanceNis: interestMonth.closingDebtBalanceNis,
      fundingDeficitBalanceNis: interestMonth.fundingDeficitBalanceNis,
      facilityBreachNis: interestMonth.facilityBreachNis,
    };
  });

  if (Math.abs(sumGuaranteeExpenseNis - guaranteeSchedule.totalGuaranteeExpenseNis) > MONEY_EPSILON_NIS) {
    throw new Error(
      `שגיאה פנימית: סך הוצאות הערבות מהפירוט החודשי (${sumGuaranteeExpenseNis}) לא תואם ל-` +
        `guaranteeSchedule.totalGuaranteeExpenseNis (${guaranteeSchedule.totalGuaranteeExpenseNis})`
    );
  }

  return {
    months,
    totalOperatingOutflowsNis,
    totalGuaranteeExpenseNis: guaranteeSchedule.totalGuaranteeExpenseNis,
    totalInterestExpenseNis: interestResult.totalInterestExpenseNis,
    totalEquityInjectedNis: interestResult.totalEquityInjectedNis,
    peakClosingDebtBalanceNis: interestResult.peakClosingDebtBalanceNis,
    peakClosingDebtBalanceMonthIndex: interestResult.peakClosingDebtBalanceMonthIndex,
    peakFundingDeficitNis: interestResult.peakFundingDeficitNis,
    firstFundingDeficitMonthIndex: interestResult.firstFundingDeficitMonthIndex,
    facilityExceeded: interestResult.facilityExceeded,
    activeGuaranteesBeyondForecast: guaranteeSchedule.activeBeyondForecast,
  };
}
