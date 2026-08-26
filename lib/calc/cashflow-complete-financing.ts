// commit 6e/6f: שכבת orchestration סופית - משלבת עמלות מימון (cashflow-financing-fees.ts) לתוך
// התזרים הממומן (cashflow-financed-engine.ts) באמצעות חישוב חוזר עד התכנסות, כי עמלות הן תשלום
// מזומן שעשוי להגדיל אשראי/ריבית ולשנות את בסיס עמלת אי-הניצול עצמו (מעגליות). אין שכפול של מנועי
// הערבויות/הריבית/העמלות - המודול הזה רק מרכיב אותם. עדיין בלי ProjectInputs, מסכים, Supabase,
// Excel, IRR/NPV.
//
// commit 6f (תיקון): הפרדה מפורשת בין appliedFeeSchedule (לוח העמלות שבאמת הוזן ל-
// computeFinancedCashFlow והפיק את financed המוחזר) לבין recalculatedFeeSchedule (לוח שמחושב טרי
// מהיתרות של financed, לבדיקת שארית/התכנסות בלבד). התוצאה הסופית משתמשת אך ורק ב-appliedFeeSchedule
// - לעולם לא ב-recalculatedFeeSchedule - כדי ששני האובייקטים המוחזרים (financed ולוח העמלות)
// יתארו תמיד את אותה איטרציה בדיוק, לא שילוב של שתיים.

import { computeFinancedCashFlow } from "./cashflow-financed-engine";
import type { FinancedCashFlowResult, OperatingMonthInput } from "./cashflow-financed-engine";
import { computeFinancingFeeSchedule } from "./cashflow-financing-fees";
import type {
  DebtBalanceMonthInput,
  FacilityOpeningFee,
  FinancingFeeScheduleResult,
  UnusedFacilityCommissionAssumptions,
} from "./cashflow-financing-fees";
import type { InterestCashFlowAssumptions } from "./cashflow-interest-engine";
import type { GuaranteeScheduleResult } from "./cashflow-guarantees";

/** ר' cashflow-interest-engine.ts commit 5b - אותו עיקרון. כאן משמש **רק** להכרעת התכנסות ולאימות
 *  פנימי מול סיכומי appliedFeeSchedule - **לא** להעברת ערך מעוגל בין איטרציות. */
const MONEY_EPSILON_NIS = 0.01;

const DEFAULT_MAX_ITERATIONS = 60;

export interface FinancingFeeAssumptions {
  openingFee?: FacilityOpeningFee;
  unusedFacilityCommission?: UnusedFacilityCommissionAssumptions;
}

export interface CompleteFinancingInput {
  operatingMonths: OperatingMonthInput[];
  guaranteeSchedule: GuaranteeScheduleResult;
  interestAssumptions: InterestCashFlowAssumptions;
  financingFeeAssumptions: FinancingFeeAssumptions;
  /**
   * **לבדיקות בלבד** - לא לחשוף כברירת מחדל לממשק המשתמש (עדיין אין ממשק בכלל ב-commit הזה).
   * ברירת המחדל 60. קיים כדי לאפשר בדיקה דטרמיניסטית של מצב אי-התכנסות בלי לבנות תרחיש קיצון
   * ידני שמתנהג באופן לא-יציב.
   */
  maxIterations?: number;
}

export interface CompleteFinancingMonth {
  monthIndex: number;
  operatingInflowsNis: number;
  operatingOutflowsNis: number;
  guaranteeExpenseNis: number;
  /** מהעמלה **שהוחלה בפועל** (appliedFeeSchedule) - לא מהחישוב-מחדש */
  openingFeeExpenseNis: number;
  /** מהעמלה **שהוחלה בפועל** (appliedFeeSchedule) - לא מהחישוב-מחדש */
  unusedFacilityCommissionNis: number;
  /** = openingFeeExpenseNis + unusedFacilityCommissionNis, שתיהן מ-appliedFeeSchedule */
  totalFinancingFeeExpenseNis: number;
  /** = operatingOutflowsNis + guaranteeExpenseNis + totalFinancingFeeExpenseNis - זהה בדיוק (לא בסבילות)
   *  ל-outflowsNis שהוזן בפועל ל-computeInterestCashFlow עבור החודש הזה */
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

export interface CompleteFinancingResult {
  months: CompleteFinancingMonth[];
  totalOperatingOutflowsNis: number;
  totalGuaranteeExpenseNis: number;
  /** מ-appliedFeeSchedule.totalOpeningFeeExpenseNis - לא מהחישוב-מחדש */
  totalOpeningFeeExpenseNis: number;
  /** מ-appliedFeeSchedule.totalUnusedFacilityCommissionNis - לא מהחישוב-מחדש */
  totalUnusedFacilityCommissionNis: number;
  /** מ-appliedFeeSchedule.totalFinancingFeeExpenseNis - לא מהחישוב-מחדש */
  totalFinancingFeeExpenseNis: number;
  totalInterestExpenseNis: number;
  totalEquityInjectedNis: number;
  peakClosingDebtBalanceNis: number;
  /** commit 8a: מ-financed (ובסופו של דבר מ-computeInterestCashFlow) ישירות - לא מחושב מחדש כאן */
  peakClosingDebtBalanceMonthIndex: number | null;
  peakFundingDeficitNis: number;
  /** commit 8a: מ-financed ישירות - לא מחושב מחדש כאן */
  firstFundingDeficitMonthIndex: number | null;
  facilityExceeded: boolean;
  activeGuaranteesBeyondForecast: boolean;
  isConverged: boolean;
  iterationsUsed: number;
  /** ההפרש החודשי המקסימלי בין recalculatedFeeSchedule ל-appliedFeeSchedule, באיטרציה המוחזרת - זה שקבע את ההתכנסות */
  maxFeeDifferenceNis: number;
  maxDebtDifferenceNis: number;
  /**
   * = recalculatedFeeSchedule.totalFinancingFeeExpenseNis - appliedFeeSchedule.totalFinancingFeeExpenseNis
   * (הפרש **פרויקטלי כולל**, לא חודשי-מקסימלי כמו maxFeeDifferenceNis) - עמלה שהחישוב-מחדש מצא אך
   * לא הוחלה בפועל (למשל כי הייתה קטנה מדי מכדי להצדיק עוד איטרציה). לתיעוד/שקיפות בלבד - **לעולם
   * לא** מוזן לשדות הכספיים המוחזרים (months, total*Nis) - אלה תמיד appliedFeeSchedule בלבד.
   */
  fixedPointResidualFeeNis: number;
  warnings: string[];
  // הערה: אין כאן requiresCashFlowRecalculation - זה בכוונה. שדה זה שייך לתוצאה הזמנית/לא-סופית של
  // cashflow-financing-fees.ts (commit 6d, "לפני עמלות"). התוצאה כאן, מכוח הבנייה שלה (לולאה עד
  // התכנסות), *היא* התזרים המחושב-מחדש - אין עוד "צורך בחישוב חוזר" לבטא כשדה נפרד.
}

/** לוח עמלות "אפס אמיתי" - לא מפה של מספרים אלא FinancingFeeScheduleResult מלא (כדי לדווח
 *  openingFeeExpenseNis/unusedFacilityCommissionNis בפירוט, לא רק סכום), משמש כ-appliedFeeSchedule
 *  ההתחלתי לפני שהופעלה כל עמלה. facilityLimitNis/openingDebt/closingDebt לא רלוונטיים כאן (אין
 *  openingFee/unusedFacilityCommission בקריאה) - 0 בכל השדות מספיק. */
function buildZeroFeeSchedule(monthIndices: number[]): FinancingFeeScheduleResult {
  const monthlyDebtBalances: DebtBalanceMonthInput[] = monthIndices.map((monthIndex) => ({
    monthIndex,
    facilityLimitNis: 0,
    openingDebtBalanceNis: 0,
    closingDebtBalanceNis: 0,
  }));
  return computeFinancingFeeSchedule({ monthlyDebtBalances });
}

/**
 * שכבת orchestration סופית: מריצה איטרציות של computeFinancedCashFlow + computeFinancingFeeSchedule
 * עד שהעמלה החודשית ויתרת הסגירה החודשית מתייצבות שתיהן בסבילות MONEY_EPSILON_NIS, או עד
 * maxIterations (ברירת מחדל 60).
 *
 * אלגוריתם:
 * 1. `appliedFeeSchedule` מתחיל כלוח אפס אמיתי (buildZeroFeeSchedule) - עדיין לא הופעלה שום עמלה.
 * 2. בכל איטרציה:
 *    א. בונה outflowsNis לכל חודש = operatingOutflowsNis + appliedFeeSchedule[monthIndex] (לא כולל
 *       guaranteeExpenseNis - זה מתווסף בתוך computeFinancedCashFlow עצמו, מהצד השני).
 *    ב. מריצה computeFinancedCashFlow על התזרים המורחב הזה - **התוצאה `financed` הזו ו-
 *       `appliedFeeSchedule` שהזין אותה תמיד מתארים את אותה איטרציה בדיוק**, בכל שלב באלגוריתם.
 *    ג. בונה monthlyDebtBalances מ-`financed` (ב) - openingDebtBalanceNis נגזר מיתרת הסגירה של
 *       החודש הקודם (0 בחודש הראשון), closingDebtBalanceNis מ-(ב) ישירות.
 *    ד. מריצה computeFinancingFeeSchedule על יתרות (ג) - זו `recalculatedFeeSchedule`, **לבדיקת
 *       שארית/התכנסות בלבד** - לא נכנסת לשום שדה כספי מוחזר.
 *    ה. בודקת התכנסות: maxFeeDifferenceNis = ההפרש המקסימלי בין (ד) ל-appliedFeeSchedule (א);
 *       maxDebtDifferenceNis = ההפרש המקסימלי בין יתרת הסגירה של (ב) לזו של האיטרציה הקודמת
 *       (באיטרציה הראשונה: 0 במפורש, אין "קודמת" אמיתית - ר' הערה בקוד).
 *    ו. **אם מתכנסת**: עוצרת מיד. `financed` ו-`appliedFeeSchedule` **נשארים כפי שהם** מהאיטרציה
 *       הזו - לא מוחלפים ב-`recalculatedFeeSchedule` (זו בדיוק התקלה שתוקנה ב-6f: לפני התיקון,
 *       הפלט חיבר את ה-`financed` הישן עם `recalculatedFeeSchedule` החדש - שני אובייקטים
 *       שמתארים שתי איטרציות שונות, לא מצב קוהרנטי אחד).
 *    ז. **אם לא מתכנסת וזו לא האיטרציה האחרונה המותרת** (`iteration < maxIterations`):
 *       `appliedFeeSchedule = recalculatedFeeSchedule` (מוחלף, לא מצטבר) - האיטרציה הבאה תזין את
 *       זה בפועל. **אם זו כבר האיטרציה האחרונה המותרת** - אין עדכון, כי אין עוד איטרציה שתשתמש
 *       בו; עדכון כזה היה משאיר את `appliedFeeSchedule` "צעד קדימה" מ-`financed` שכבר חושב - אותה
 *       תקלת ערבוב-איטרציות בדיוק, רק בנתיב אי-ההתכנסות.
 * 3. ללא התכנסות אחרי maxIterations: isConverged=false, אזהרה מפורשת מתווספת, **אין** לולאה
 *    אינסופית (עוצרת בדיוק ב-maxIterations), והתוצאה המוחזרת היא זו של האיטרציה האחרונה - עדיין
 *    קוהרנטית (financed+appliedFeeSchedule מאותה איטרציה בדיוק, ר' (ז)), רק מסומנת כלא-סופית
 *    דרך isConverged.
 *
 * מכוח (ו), משוואות ההתאמה של האובייקט המוחזר (`totalCashOutflowsNis`, `closingCashBalanceNis`,
 * `closingDebtBalanceNis`) מתקיימות **תמיד עד דיוק floating-point רגיל** - לא רק בסבילות
 * MONEY_EPSILON_NIS - כי כל השדות המוחזרים מגיעים מ-`financed` ומ-`appliedFeeSchedule` שהזין
 * אותו, שני אובייקטים שמתארים בדיוק את אותו מעבר יחיד. MONEY_EPSILON_NIS משמש אך ורק להכרעת
 * ההתכנסות עצמה (כמה קרוב `recalculatedFeeSchedule` ל-`appliedFeeSchedule`), לא לדיוק הפלט.
 */
export function computeCompleteFinancing(input: CompleteFinancingInput): CompleteFinancingResult {
  const { operatingMonths, guaranteeSchedule, interestAssumptions, financingFeeAssumptions } = input;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error(`maxIterations חייב להיות מספר שלם חיובי (התקבל ${maxIterations})`);
  }

  const monthIndices = operatingMonths.map((m) => m.monthIndex);

  let appliedFeeSchedule: FinancingFeeScheduleResult = buildZeroFeeSchedule(monthIndices);
  let previousClosingDebtByMonth: Map<number, number> | null = null;

  let financed: FinancedCashFlowResult | null = null;
  let recalculatedFeeSchedule: FinancingFeeScheduleResult | null = null;
  let isConverged = false;
  let iterationsUsed = 0;
  let maxFeeDifferenceNis = Infinity;
  let maxDebtDifferenceNis = Infinity;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterationsUsed = iteration;

    const appliedFeeByMonth = new Map(appliedFeeSchedule.months.map((m) => [m.monthIndex, m.totalFinancingFeeExpenseNis]));
    const combinedOperatingMonths: OperatingMonthInput[] = operatingMonths.map((m) => ({
      ...m,
      operatingOutflowsNis: m.operatingOutflowsNis + (appliedFeeByMonth.get(m.monthIndex) ?? 0),
    }));

    financed = computeFinancedCashFlow({ operatingMonths: combinedOperatingMonths, guaranteeSchedule, interestAssumptions });

    const monthlyDebtBalances: DebtBalanceMonthInput[] = [];
    let openingDebt = 0;
    for (const m of financed.months) {
      monthlyDebtBalances.push({
        monthIndex: m.monthIndex,
        facilityLimitNis: interestAssumptions.creditFacilityLimitNis,
        openingDebtBalanceNis: openingDebt,
        closingDebtBalanceNis: m.closingDebtBalanceNis,
      });
      openingDebt = m.closingDebtBalanceNis;
    }

    recalculatedFeeSchedule = computeFinancingFeeSchedule({
      monthlyDebtBalances,
      openingFee: financingFeeAssumptions.openingFee,
      unusedFacilityCommission: financingFeeAssumptions.unusedFacilityCommission,
    });

    maxFeeDifferenceNis = 0;
    for (const m of recalculatedFeeSchedule.months) {
      const applied = appliedFeeByMonth.get(m.monthIndex) ?? 0;
      maxFeeDifferenceNis = Math.max(maxFeeDifferenceNis, Math.abs(m.totalFinancingFeeExpenseNis - applied));
    }

    if (previousClosingDebtByMonth === null) {
      // איטרציה ראשונה: appliedFeeSchedule היה לוח אפס אמיתי לאורך כל האיטרציה הזו - אין "קודמת"
      // אמיתית להשוואת חוב, ובכל מקרה עמלת-אפס לא יכלה לשנות חוב באיטרציה שכבר רצה
      maxDebtDifferenceNis = 0;
    } else {
      maxDebtDifferenceNis = 0;
      for (const m of financed.months) {
        const prevDebt = previousClosingDebtByMonth.get(m.monthIndex) ?? 0;
        maxDebtDifferenceNis = Math.max(maxDebtDifferenceNis, Math.abs(m.closingDebtBalanceNis - prevDebt));
      }
    }

    if (maxFeeDifferenceNis <= MONEY_EPSILON_NIS && maxDebtDifferenceNis <= MONEY_EPSILON_NIS) {
      isConverged = true;
      break; // financed ו-appliedFeeSchedule נשארים כפי שהם - קוהרנטיים, לא מוחלפים ב-recalculated
    }

    // מגיעים לכאן רק כשעוד תהיה איטרציה נוספת (iteration < maxIterations, כי אחרת הלולאה הייתה
    // מסתיימת בלאו הכי) - **קריטי** לא לעדכן appliedFeeSchedule כשזו הייתה האיטרציה האחרונה
    // המותרת: זה בדיוק היה מחזיר גרסה "צעד קדימה" מ-financed שכבר חושב, אותה תקלת ערבוב-איטרציות
    // מ-6f, רק בנתיב אי-ההתכנסות. ר' הבדיקה הייעודית "אי-התכנסות מחזירה איטרציה קוהרנטית".
    if (iteration < maxIterations) {
      previousClosingDebtByMonth = new Map(financed.months.map((m) => [m.monthIndex, m.closingDebtBalanceNis]));
      appliedFeeSchedule = recalculatedFeeSchedule;
    }
  }

  if (!financed || !recalculatedFeeSchedule) {
    // maxIterations>=1 מובטח למעלה, אז הלולאה תמיד רצה לפחות פעם אחת - לא אמור לקרות בפועל
    throw new Error("שגיאה פנימית: לא בוצעה אף איטרציה");
  }

  const warnings: string[] = [];
  if (!isConverged) {
    warnings.push(
      `לא הושגה התכנסות אחרי ${iterationsUsed} איטרציות (הפרש עמלה מקסימלי: ${maxFeeDifferenceNis.toFixed(2)} ₪, ` +
        `הפרש חוב מקסימלי: ${maxDebtDifferenceNis.toFixed(2)} ₪) - התוצאה אינה סופית`
    );
  }

  const appliedFeeByMonthFinal = new Map(appliedFeeSchedule.months.map((m) => [m.monthIndex, m]));
  // financed.months[i].operatingOutflowsNis הוא הד של מה שהוזן ל-computeFinancedCashFlow (המקורי +
  // העמלה שהוחלה) - "מנופח" בעמלה, לא ערך תפעולי טהור. מקור האמת ל-operatingOutflowsNis המדווח כאן
  // הוא הקלט המקורי (operatingMonths) בלבד, כדי לא לספור את העמלה פעמיים.
  const originalOperatingByMonth = new Map(operatingMonths.map((m) => [m.monthIndex, m.operatingOutflowsNis]));

  let sumOpeningFee = 0;
  let sumUnusedFacility = 0;
  let sumFinancingFee = 0;
  let totalOperatingOutflowsNis = 0;

  const months: CompleteFinancingMonth[] = financed.months.map((m) => {
    const fee = appliedFeeByMonthFinal.get(m.monthIndex);
    if (!fee) {
      throw new Error(`שגיאה פנימית: appliedFeeSchedule לא כולל monthIndex=${m.monthIndex}`);
    }
    const operatingOutflowsNis = originalOperatingByMonth.get(m.monthIndex);
    if (operatingOutflowsNis === undefined) {
      throw new Error(`שגיאה פנימית: operatingMonths לא כולל monthIndex=${m.monthIndex}`);
    }
    sumOpeningFee += fee.openingFeeExpenseNis;
    sumUnusedFacility += fee.unusedFacilityCommissionNis;
    sumFinancingFee += fee.totalFinancingFeeExpenseNis;
    totalOperatingOutflowsNis += operatingOutflowsNis;

    return {
      monthIndex: m.monthIndex,
      operatingInflowsNis: m.operatingInflowsNis,
      operatingOutflowsNis,
      guaranteeExpenseNis: m.guaranteeExpenseNis,
      openingFeeExpenseNis: fee.openingFeeExpenseNis,
      unusedFacilityCommissionNis: fee.unusedFacilityCommissionNis,
      totalFinancingFeeExpenseNis: fee.totalFinancingFeeExpenseNis,
      totalCashOutflowsNis: operatingOutflowsNis + m.guaranteeExpenseNis + fee.totalFinancingFeeExpenseNis,
      equityInjectionNis: m.equityInjectionNis,
      creditDrawNis: m.creditDrawNis,
      creditRepaymentNis: m.creditRepaymentNis,
      interestExpenseNis: m.interestExpenseNis,
      closingCashBalanceNis: m.closingCashBalanceNis,
      closingDebtBalanceNis: m.closingDebtBalanceNis,
      fundingDeficitBalanceNis: m.fundingDeficitBalanceNis,
      facilityBreachNis: m.facilityBreachNis,
    };
  });

  // אימות פנימי מול הסיכומים של appliedFeeSchedule עצמו (לא recalculatedFeeSchedule!)
  if (Math.abs(sumOpeningFee - appliedFeeSchedule.totalOpeningFeeExpenseNis) > MONEY_EPSILON_NIS) {
    throw new Error("שגיאה פנימית: סך עמלת הפתיחה מהפירוט לא תואם לסיכום appliedFeeSchedule");
  }
  if (Math.abs(sumUnusedFacility - appliedFeeSchedule.totalUnusedFacilityCommissionNis) > MONEY_EPSILON_NIS) {
    throw new Error("שגיאה פנימית: סך עמלת אי-הניצול מהפירוט לא תואם לסיכום appliedFeeSchedule");
  }
  if (Math.abs(sumFinancingFee - appliedFeeSchedule.totalFinancingFeeExpenseNis) > MONEY_EPSILON_NIS) {
    throw new Error("שגיאה פנימית: סך עמלות המימון מהפירוט לא תואם לסיכום appliedFeeSchedule");
  }

  const fixedPointResidualFeeNis = recalculatedFeeSchedule.totalFinancingFeeExpenseNis - appliedFeeSchedule.totalFinancingFeeExpenseNis;

  return {
    months,
    totalOperatingOutflowsNis,
    totalGuaranteeExpenseNis: financed.totalGuaranteeExpenseNis,
    totalOpeningFeeExpenseNis: appliedFeeSchedule.totalOpeningFeeExpenseNis,
    totalUnusedFacilityCommissionNis: appliedFeeSchedule.totalUnusedFacilityCommissionNis,
    totalFinancingFeeExpenseNis: appliedFeeSchedule.totalFinancingFeeExpenseNis,
    totalInterestExpenseNis: financed.totalInterestExpenseNis,
    totalEquityInjectedNis: financed.totalEquityInjectedNis,
    peakClosingDebtBalanceNis: financed.peakClosingDebtBalanceNis,
    peakClosingDebtBalanceMonthIndex: financed.peakClosingDebtBalanceMonthIndex,
    peakFundingDeficitNis: financed.peakFundingDeficitNis,
    firstFundingDeficitMonthIndex: financed.firstFundingDeficitMonthIndex,
    facilityExceeded: financed.facilityExceeded,
    activeGuaranteesBeyondForecast: financed.activeGuaranteesBeyondForecast,
    isConverged,
    iterationsUsed,
    maxFeeDifferenceNis,
    maxDebtDifferenceNis,
    fixedPointResidualFeeNis,
    warnings,
  };
}
