// commit 6e: שכבת orchestration סופית - משלבת עמלות מימון (cashflow-financing-fees.ts) לתוך התזרים
// הממומן (cashflow-financed-engine.ts) באמצעות חישוב חוזר עד התכנסות, כי עמלות הן תשלום מזומן
// שעשוי להגדיל אשראי/ריבית ולשנות את בסיס עמלת אי-הניצול עצמו (מעגליות). אין שכפול של מנועי
// הערבויות/הריבית/העמלות - המודול הזה רק מרכיב אותם. עדיין בלי ProjectInputs, מסכים, Supabase,
// Excel, IRR/NPV.

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

/** ר' cashflow-interest-engine.ts commit 5b - אותו עיקרון. כאן משמש **רק** להכרעת התכנסות (סעיף 2)
 *  ולאימות פנימי מול סיכומי מנועי המשנה - **לא** להעברת ערך מעוגל בין איטרציות (ר' תיעוד הפונקציה). */
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
   * ברירת המחדל 60 (ר' סעיף 2 בהוראת הביצוע). קיים כדי לאפשר בדיקה דטרמיניסטית של מצב אי-התכנסות
   * בלי לבנות תרחיש קיצון ידני שמתנהג באופן לא-יציב.
   */
  maxIterations?: number;
}

export interface CompleteFinancingMonth {
  monthIndex: number;
  operatingInflowsNis: number;
  operatingOutflowsNis: number;
  guaranteeExpenseNis: number;
  openingFeeExpenseNis: number;
  unusedFacilityCommissionNis: number;
  /** = openingFeeExpenseNis + unusedFacilityCommissionNis */
  totalFinancingFeeExpenseNis: number;
  /** = operatingOutflowsNis + guaranteeExpenseNis + totalFinancingFeeExpenseNis */
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
  totalOpeningFeeExpenseNis: number;
  totalUnusedFacilityCommissionNis: number;
  totalFinancingFeeExpenseNis: number;
  totalInterestExpenseNis: number;
  totalEquityInjectedNis: number;
  peakClosingDebtBalanceNis: number;
  peakFundingDeficitNis: number;
  facilityExceeded: boolean;
  activeGuaranteesBeyondForecast: boolean;
  isConverged: boolean;
  iterationsUsed: number;
  maxFeeDifferenceNis: number;
  maxDebtDifferenceNis: number;
  warnings: string[];
  // הערה: אין כאן requiresCashFlowRecalculation - זה בכוונה. שדה זה שייך לתוצאה הזמנית/לא-סופית של
  // cashflow-financing-fees.ts (commit 6d, "לפני עמלות"). התוצאה כאן, מכוח הבנייה שלה (לולאה עד
  // התכנסות), *היא* התזרים המחושב-מחדש - אין עוד "צורך בחישוב חוזר" לבטא כשדה נפרד.
}

/**
 * שכבת orchestration סופית: מריצה איטרציות של computeFinancedCashFlow + computeFinancingFeeSchedule
 * עד שהעמלה החודשית ויתרת הסגירה החודשית מתייצבות שתיהן בסבילות MONEY_EPSILON_NIS, או עד
 * maxIterations (ברירת מחדל 60).
 *
 * אלגוריתם:
 * 1. איטרציה 1 מתחילה מלוח עמלות אפס (feeByMonth=0 לכל חודש) - עדיין לא הופעלה שום עמלה.
 * 2. בכל איטרציה:
 *    א. בונה totalCashOutflowsNis לכל חודש = operatingOutflowsNis + feeByMonth[monthIndex]
 *       (לא כולל guaranteeExpenseNis - זה מתווסף בתוך computeFinancedCashFlow עצמו, מהצד השני).
 *    ב. מריצה computeFinancedCashFlow על התזרים המורחב הזה + guaranteeSchedule + interestAssumptions
 *       - כל שרשרת המימון/ריבית מחושבת מחדש מאפס, ללא שכפול לוגיקה.
 *    ג. בונה monthlyDebtBalances מתוצאת (ב) - facilityLimitNis קבוע (מ-interestAssumptions),
 *       openingDebtBalanceNis נגזר מיתרת הסגירה של החודש הקודם (0 בחודש הראשון), closingDebtBalanceNis
 *       מתוצאת (ב) ישירות.
 *    ד. מריצה computeFinancingFeeSchedule על יתרות (ג) עם אותן הנחות עמלה קבועות (openingFee/
 *       unusedFacilityCommission) - זו "העמלה החדשה", מחושבת מחדש מהיתרות העדכניות.
 *    ה. **מחליפה** את feeByMonth בלוח החדש (ד) - לא מוסיפה אליו.
 *    ו. בודקת התכנסות: maxFeeDifferenceNis = ההפרש המקסימלי בין העמלה החדשה (ד) לעמלה שהוזנה
 *       לאיטרציה הזו (לפני ה); maxDebtDifferenceNis = ההפרש המקסימלי בין יתרת הסגירה של האיטרציה
 *       הזו (ב) לזו של האיטרציה הקודמת (באיטרציה הראשונה, אין "קודמת" אמיתית - מוגדר 0 במפורש, כי
 *       עמלה שכבר לא השתנתה (feeByMonth=0 עדיין) לא יכולה לשנות את החוב באיטרציה הבאה בכל מקרה).
 *    ז. מתכנסת אם שני ההפרשים <= MONEY_EPSILON_NIS. שני התנאים חייבים להתקיים יחד - גם עמלה קבועה
 *       (בלתי-תלויה בחוב) דורשת לפחות שתי איטרציות אחרי זו שהזינה אותה לראשונה, כדי להוכיח שהחוב
 *       עצמו כבר לא משתנה בעקבותיה.
 * 3. ללא התכנסות אחרי maxIterations: isConverged=false, אזהרה מפורשת מתווספת, **אין** לולאה
 *    אינסופית (עוצרת בדיוק ב-maxIterations), והתוצאה המוחזרת היא זו של האיטרציה האחרונה בלבד -
 *    מסומנת בבירור כלא-סופית דרך isConverged, לא מוסתרת מאחורי מספרים "כאילו תקינים".
 */
export function computeCompleteFinancing(input: CompleteFinancingInput): CompleteFinancingResult {
  const { operatingMonths, guaranteeSchedule, interestAssumptions, financingFeeAssumptions } = input;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error(`maxIterations חייב להיות מספר שלם חיובי (התקבל ${maxIterations})`);
  }

  let feeByMonth = new Map<number, number>(operatingMonths.map((m) => [m.monthIndex, 0]));
  let previousClosingDebtByMonth: Map<number, number> | null = null;

  let financed: FinancedCashFlowResult | null = null;
  let feeSchedule: FinancingFeeScheduleResult | null = null;
  let isConverged = false;
  let iterationsUsed = 0;
  let maxFeeDifferenceNis = Infinity;
  let maxDebtDifferenceNis = Infinity;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterationsUsed = iteration;

    const combinedOperatingMonths: OperatingMonthInput[] = operatingMonths.map((m) => ({
      ...m,
      operatingOutflowsNis: m.operatingOutflowsNis + (feeByMonth.get(m.monthIndex) ?? 0),
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

    feeSchedule = computeFinancingFeeSchedule({
      monthlyDebtBalances,
      openingFee: financingFeeAssumptions.openingFee,
      unusedFacilityCommission: financingFeeAssumptions.unusedFacilityCommission,
    });

    maxFeeDifferenceNis = 0;
    for (const m of feeSchedule.months) {
      const fedIn = feeByMonth.get(m.monthIndex) ?? 0;
      maxFeeDifferenceNis = Math.max(maxFeeDifferenceNis, Math.abs(m.totalFinancingFeeExpenseNis - fedIn));
    }

    if (previousClosingDebtByMonth === null) {
      // איטרציה ראשונה: עדיין לא הוזנה עמלה חדשה לתזרים בפועל (feeByMonth היה 0 לאורך כל האיטרציה
      // הזו) - אין "לפני/אחרי" אמיתי להשוואת חוב, ובכל מקרה אם העמלה עוד 0 היא לא יכולה לשנות חוב
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
      break;
    }

    // הכנה לאיטרציה הבאה: מחליפים, לא מוסיפים
    feeByMonth = new Map(feeSchedule.months.map((m) => [m.monthIndex, m.totalFinancingFeeExpenseNis]));
    previousClosingDebtByMonth = new Map(financed.months.map((m) => [m.monthIndex, m.closingDebtBalanceNis]));
  }

  if (!financed || !feeSchedule) {
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

  const feeByMonthFinal = new Map(feeSchedule.months.map((m) => [m.monthIndex, m]));
  // financed.months[i].operatingOutflowsNis הוא הד של מה שהוזן ל-computeFinancedCashFlow, כלומר
  // operatingOutflowsNis המקורי + העמלה שהוזנה לאיטרציה - "מנופח" בעמלה, לא ערך תפעולי טהור.
  // מקור האמת ל-operatingOutflowsNis המדווח כאן הוא הקלט המקורי (operatingMonths) בלבד, כדי לא
  // לספור את העמלה פעמיים (גם בתוך operatingOutflowsNis וגם בתוך totalFinancingFeeExpenseNis).
  const originalOperatingByMonth = new Map(operatingMonths.map((m) => [m.monthIndex, m.operatingOutflowsNis]));

  let sumOpeningFee = 0;
  let sumUnusedFacility = 0;
  let sumFinancingFee = 0;
  let totalOperatingOutflowsNis = 0;

  const months: CompleteFinancingMonth[] = financed.months.map((m) => {
    const fee = feeByMonthFinal.get(m.monthIndex);
    if (!fee) {
      throw new Error(`שגיאה פנימית: לוח העמלות לא כולל monthIndex=${m.monthIndex}`);
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

  if (Math.abs(sumOpeningFee - feeSchedule.totalOpeningFeeExpenseNis) > MONEY_EPSILON_NIS) {
    throw new Error("שגיאה פנימית: סך עמלת הפתיחה מהפירוט לא תואם לסיכום מ-computeFinancingFeeSchedule");
  }
  if (Math.abs(sumUnusedFacility - feeSchedule.totalUnusedFacilityCommissionNis) > MONEY_EPSILON_NIS) {
    throw new Error("שגיאה פנימית: סך עמלת אי-הניצול מהפירוט לא תואם לסיכום מ-computeFinancingFeeSchedule");
  }
  if (Math.abs(sumFinancingFee - feeSchedule.totalFinancingFeeExpenseNis) > MONEY_EPSILON_NIS) {
    throw new Error("שגיאה פנימית: סך עמלות המימון מהפירוט לא תואם לסיכום מ-computeFinancingFeeSchedule");
  }

  return {
    months,
    totalOperatingOutflowsNis,
    totalGuaranteeExpenseNis: financed.totalGuaranteeExpenseNis,
    totalOpeningFeeExpenseNis: feeSchedule.totalOpeningFeeExpenseNis,
    totalUnusedFacilityCommissionNis: feeSchedule.totalUnusedFacilityCommissionNis,
    totalFinancingFeeExpenseNis: feeSchedule.totalFinancingFeeExpenseNis,
    totalInterestExpenseNis: financed.totalInterestExpenseNis,
    totalEquityInjectedNis: financed.totalEquityInjectedNis,
    peakClosingDebtBalanceNis: financed.peakClosingDebtBalanceNis,
    peakFundingDeficitNis: financed.peakFundingDeficitNis,
    facilityExceeded: financed.facilityExceeded,
    activeGuaranteesBeyondForecast: financed.activeGuaranteesBeyondForecast,
    isConverged,
    iterationsUsed,
    maxFeeDifferenceNis,
    maxDebtDifferenceNis,
    warnings,
  };
}
