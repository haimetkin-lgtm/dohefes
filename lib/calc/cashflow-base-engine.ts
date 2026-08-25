// commit 4 (+4b, סבב תיקוני שמות/שדות) של מנוע התזרים: מנוע תזרים בסיסי בלבד. פונקציה טהורה
// שמקבלת קלט חודשי מוכן (תקבולים/תשלומים, כבר מחושבים על ידי commits 2-3) ומריצה waterfall של
// מזומן/הון עצמי/אשראי. אין כאן ריבית, ערבויות, עמלת אי-ניצול או פתיחת תיק (commit 5). אין חיבור
// ל-ProjectInputs, computeProject, React או Supabase - שכבה תוספתית טהורה. ר' GEN2_CASHFLOW_DESIGN.md §4.

import { validatePhases } from "./cashflow-validation";
import type { ProjectPhase } from "./cashflow-types";

export interface BaseCashFlowMonthInput {
  monthIndex: number;
  inflowsNis: number;
  outflowsNis: number;
  phases: ProjectPhase[];
}

export interface BaseCashFlowAssumptions {
  equityCapNis: number;
  minimumCashBalanceNis: number;
  creditFacilityLimitNis: number;
}

export interface BaseCashFlowMonth {
  monthIndex: number;
  phases: ProjectPhase[];

  openingCashBalanceNis: number;
  openingDebtBalanceNis: number;

  inflowsNis: number;
  outflowsNis: number;
  equityInjectionNis: number;
  creditDrawNis: number;
  creditRepaymentNis: number;

  /**
   * יתרת גירעון בסוף החודש (תוקן, ר' סבב ביקורת 4b: **יתרה מצטברת, לא זרימה חודשית חדשה**).
   * `= max(0, minimumCashBalanceNis - closingCashBalanceNis)`. אם גירעון של 100,000 ₪ נוצר בחודש 1
   * ולא קורה שום דבר בחודש 2, גם חודש 2 יציג fundingDeficitBalanceNis=100,000 - **זה אותו גירעון
   * שנשאר פתוח, לא גירעון חדש**. אסור לסכם את השדה הזה על פני חודשים - הוא stock (יתרה), לא flow
   * (תנועה). לצורך תנועה (כמה נוצר/נסגר החודש) יש להשוות בין חודשים סמוכים, אין שדה ייעודי לכך
   * עדיין (לא נוסף בכוונה - אין לו שימוש ברור כרגע, ר' דיון בביקורת).
   */
  fundingDeficitBalanceNis: number;

  /**
   * יתרת מזומן בסוף החודש. **כשהערך שלילי, זה לא יתרת חשבון בנק אמיתית** - זה חוסר מימון/התחייבות
   * בלתי ממומנת שמצטברת במודל (ר' fundingDeficitBalanceNis, ששני השדות שווים בערכם המוחלט בדיוק
   * כשיש גירעון: `closingCashBalanceNis < minimumCashBalanceNis` תמיד גורר `fundingDeficitBalanceNis
   * = minimumCashBalanceNis - closingCashBalanceNis`). סדר החישוב לא השתנה בסבב הזה, רק התיעוד.
   */
  closingCashBalanceNis: number;
  closingDebtBalanceNis: number;

  /** מסגרת אשראי זמינה לניצול, לפי יתרת הסגירה: max(0, creditFacilityLimitNis - closingDebtBalanceNis) */
  availableCreditFacilityNis: number;
}

export interface BaseCashFlowResult {
  months: BaseCashFlowMonth[];
  totalEquityInjectedNis: number;

  /**
   * שיא יתרת החוב **בסופי חודשים בלבד** (תוקן שם, ר' סבב ביקורת 4b - היה peakDebtBalanceNis).
   * המנוע עובד על תקבולים/תשלומים נטו חודשיים, אין לו רזולוציה תוך-חודשית - יתכן ששיא החוב
   * האמיתי בתוך חודש מסוים גבוה יותר מהערך הזה (למשל תשלום גדול בתחילת חודש ותקבול רק בסופו).
   * לא נוספה רזולוציה יומית בשלב הזה.
   */
  peakClosingDebtBalanceNis: number;
  peakClosingDebtBalanceMonthIndex: number | null;

  /**
   * שיא **יתרת** הגירעון (לא סכום חודשי!) על פני כל הציר - ר' fundingDeficitBalanceNis. שם ישן
   * (maximumFundingShortfallNis) הוחלף כדי לא לרמז על "סכום חודשים", זו בדיקת מקסימום על יתרות.
   */
  peakFundingDeficitNis: number;
  /** החודש הראשון שבו נוצרה יתרת גירעון (fundingDeficitBalanceNis>0), null אם מעולם לא קרה */
  firstFundingDeficitMonthIndex: number | null;

  /** true אם יש חודש כלשהו עם fundingDeficitBalanceNis > 0 */
  facilityExceeded: boolean;
}

function validateFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} חייב להיות מספר סופי לא-שלילי (התקבל ${value})`);
  }
}

function validateAssumptions(assumptions: BaseCashFlowAssumptions): void {
  validateFiniteNonNegative(assumptions.equityCapNis, "equityCapNis");
  validateFiniteNonNegative(assumptions.minimumCashBalanceNis, "minimumCashBalanceNis");
  validateFiniteNonNegative(assumptions.creditFacilityLimitNis, "creditFacilityLimitNis");
}

function validateMonthlyInputs(monthlyInputs: BaseCashFlowMonthInput[]): void {
  if (monthlyInputs.length === 0) {
    throw new Error("monthlyInputs ריק");
  }

  for (const [i, input] of monthlyInputs.entries()) {
    if (!Number.isFinite(input.monthIndex) || !Number.isInteger(input.monthIndex)) {
      throw new Error(`חודש באינדקס ${i}: monthIndex אינו מספר שלם סופי (${input.monthIndex})`);
    }
    validateFiniteNonNegative(input.inflowsNis, `inflowsNis בחודש ${input.monthIndex}`);
    validateFiniteNonNegative(input.outflowsNis, `outflowsNis בחודש ${input.monthIndex}`);
    const phasesValidation = validatePhases(input.phases);
    if (!phasesValidation.valid) {
      throw new Error(`חודש ${input.monthIndex}: phases לא תקין - ${phasesValidation.errors.join("; ")}`);
    }
  }

  // רציפים, ממוינים, בלי כפילויות: monthIndex[i] === monthIndex[0]+i לכל i - לא ממיינים בשקט,
  // קלט לא-רציף/לא-ממוין/עם כפילות הוא סימן לבאג בהרכבת הקלט, לא מקרה ל"תיקון" אוטומטי.
  const firstMonth = monthlyInputs[0].monthIndex;
  for (const [i, input] of monthlyInputs.entries()) {
    const expected = firstMonth + i;
    if (input.monthIndex !== expected) {
      throw new Error(
        `monthlyInputs חייב להיות רציף, ממוין, בלי כפילויות: באינדקס ${i} צפוי monthIndex=${expected}, התקבל ${input.monthIndex}`
      );
    }
  }
}

/**
 * מנוע תזרים בסיסי: waterfall חודשי של מזומן/הון עצמי/אשראי, בלי ריבית/ערבויות/עמלות (ר' commit 5).
 *
 * סדר חישוב לכל חודש (ר' §4.2 במסמך התכנון, מצומצם לשלב הבסיסי) - **ללא שינוי בסבב 4b, רק
 * שמות/תיעוד/שדה נוסף**:
 * 1. יתרות פתיחה = יתרות סגירה של החודש הקודם (0 בחודש הראשון).
 * 2. cashBeforeFinancing = openingCash + inflows - outflows.
 * 3. אם cashBeforeFinancing < minimumCashBalanceNis: הזרמת הון עצמי עד לצורך/לתקרה שנותרה,
 *    ואז משיכת אשראי עד לצורך/למסגרת שנותרה (openingDebt כבר בחשבון) - בסדר הזה, לא הפוך.
 * 4. עודף מעל המינימום (אם יש) משמש לפירעון חוב, מוגבל ליתרת החוב הקיימת (לא פורעים יותר משיש).
 * 5. יתרות סגירה נגזרות אלגברית מהתאמות המקורות/שימושים (ר' בדיקות ה-reconciliation).
 * 6. fundingDeficitBalanceNis = max(0, minimumCashBalanceNis - closingCashBalanceNis) - **יתרה**,
 *    לא זרימה חדשה - חוסר שנוצר בחודש X וממשיך בלי שינוי מוצג באותו ערך בכל חודש עוקב, עד שתקבול
 *    מספיק גדול מצמצם/סוגר אותו. לא ממציאים כסף מעבר להון+מסגרת.
 *
 * לא ממיין/מתקן קלט בשקט: monthlyInputs חייב להגיע רציף, ממוין, בלי כפילויות, אחרת נזרקת שגיאה.
 * לא נוגע במערך/באובייקטים שהתקבלו - כל הפלט הוא אובייקטים חדשים.
 */
export function computeBaseCashFlow(monthlyInputs: BaseCashFlowMonthInput[], assumptions: BaseCashFlowAssumptions): BaseCashFlowResult {
  validateAssumptions(assumptions);
  validateMonthlyInputs(monthlyInputs);

  const months: BaseCashFlowMonth[] = [];
  let openingCashBalanceNis = 0;
  let openingDebtBalanceNis = 0;
  let equityInjectedSoFar = 0;

  for (const input of monthlyInputs) {
    const cashBeforeFinancing = openingCashBalanceNis + input.inflowsNis - input.outflowsNis;

    let equityInjectionNis = 0;
    let creditDrawNis = 0;

    if (cashBeforeFinancing < assumptions.minimumCashBalanceNis) {
      const shortfallBeforeFinancing = assumptions.minimumCashBalanceNis - cashBeforeFinancing;

      // 1) הון עצמי, עד לצורך או לתקרה שנותרה - הראשון בתור
      const remainingEquityCap = assumptions.equityCapNis - equityInjectedSoFar;
      equityInjectionNis = Math.min(shortfallBeforeFinancing, Math.max(0, remainingEquityCap));

      // 2) אשראי, עד לצורך שנותר אחרי ההון העצמי, או למסגרת שנותרה (לפי יתרת הפתיחה) - השני בתור
      const remainingShortfall = shortfallBeforeFinancing - equityInjectionNis;
      const availableFacilityForDrawNis = Math.max(0, assumptions.creditFacilityLimitNis - openingDebtBalanceNis);
      creditDrawNis = Math.min(remainingShortfall, availableFacilityForDrawNis);
    }

    const cashAfterAvailableFunding = cashBeforeFinancing + equityInjectionNis + creditDrawNis;

    // עודף מעל המינימום פורע חוב, לא יותר משיש בפועל (יתרת פתיחה + משיכת החודש הזה)
    const debtBeforeRepaymentNis = openingDebtBalanceNis + creditDrawNis;
    const surplusNis = Math.max(0, cashAfterAvailableFunding - assumptions.minimumCashBalanceNis);
    const creditRepaymentNis = Math.min(surplusNis, debtBeforeRepaymentNis);

    const closingCashBalanceNis = cashAfterAvailableFunding - creditRepaymentNis;
    const closingDebtBalanceNis = debtBeforeRepaymentNis - creditRepaymentNis;
    const fundingDeficitBalanceNis = Math.max(0, assumptions.minimumCashBalanceNis - closingCashBalanceNis);
    const availableCreditFacilityNis = Math.max(0, assumptions.creditFacilityLimitNis - closingDebtBalanceNis);

    months.push({
      monthIndex: input.monthIndex,
      phases: [...input.phases],
      openingCashBalanceNis,
      openingDebtBalanceNis,
      inflowsNis: input.inflowsNis,
      outflowsNis: input.outflowsNis,
      equityInjectionNis,
      creditDrawNis,
      creditRepaymentNis,
      fundingDeficitBalanceNis,
      closingCashBalanceNis,
      closingDebtBalanceNis,
      availableCreditFacilityNis,
    });

    equityInjectedSoFar += equityInjectionNis;
    openingCashBalanceNis = closingCashBalanceNis;
    openingDebtBalanceNis = closingDebtBalanceNis;
  }

  let peakClosingDebtBalanceNis = 0;
  let peakClosingDebtBalanceMonthIndex: number | null = null;
  let peakFundingDeficitNis = 0;
  let firstFundingDeficitMonthIndex: number | null = null;
  let facilityExceeded = false;

  for (const month of months) {
    if (month.closingDebtBalanceNis > peakClosingDebtBalanceNis) {
      peakClosingDebtBalanceNis = month.closingDebtBalanceNis;
      peakClosingDebtBalanceMonthIndex = month.monthIndex;
    }
    if (month.fundingDeficitBalanceNis > peakFundingDeficitNis) {
      peakFundingDeficitNis = month.fundingDeficitBalanceNis;
    }
    if (month.fundingDeficitBalanceNis > 0) {
      facilityExceeded = true;
      if (firstFundingDeficitMonthIndex === null) {
        firstFundingDeficitMonthIndex = month.monthIndex;
      }
    }
  }

  return {
    months,
    totalEquityInjectedNis: equityInjectedSoFar,
    peakClosingDebtBalanceNis,
    peakClosingDebtBalanceMonthIndex,
    peakFundingDeficitNis,
    firstFundingDeficitMonthIndex,
    facilityExceeded,
  };
}
