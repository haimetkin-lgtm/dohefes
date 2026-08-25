// commit 6a: מנוע ערבויות טהור ונפרד. שלושה מנגנונים נפרדים (buyerSaleLaw / kombinatsiaOwner /
// unitCompensationOwner), לא מאוחדים תחת נוסחה כללית. עדיין לא מחובר ל-computeInterestCashFlow
// (ההוצאה כאן היא פלט בלבד, לא יוצאת מהמזומן ולא מגדילה חוב), ואין עדיין עמלת אי-ניצול, עמלת
// פתיחת תיק, מסכים, ProjectInputs, Supabase או Excel. ר' GEN2_CASHFLOW_DESIGN.md §6 (עודכן ב-6-prep).

import { validateGuaranteeMechanism } from "./cashflow-validation";
import type { GuaranteeMechanism } from "./cashflow-types";

/** ר' cashflow-interest-engine.ts commit 5b - אותו עיקרון בדיוק, מוחל רק על שדות שנבדקים מול סף 0
 *  (היתרות/ההוצאות המצטרפות), לא עיגול כללי של כל היתרות בכל חודש. */
const MONEY_EPSILON_NIS = 0.01;

function normalizeMoney(value: number): number {
  return Math.abs(value) < MONEY_EPSILON_NIS ? 0 : value;
}

// --- קלט: מופע מנגנון ערבות בודד ---
// GuaranteeMechanism (cashflow-types.ts) מכיל רק שיעור (ומשך, עבור kombinatsiaOwner) - לא בסיס
// כספי, לא חודש התחלה, לא חודש שחרור. אלה קלט מפורש נפרד כאן, לכל מופע בנפרד - ר' GEN2_CASHFLOW_DESIGN.md
// §6 ("בסיסי הערבות ומועדי ההתחלה/השחרור אינם חלק מ-GuaranteeMechanism ואינם נגזרים ממנו בשקט").

export interface BuyerSaleLawGuaranteeInput {
  kind: "buyerSaleLaw";
  mechanism: Extract<GuaranteeMechanism, { kind: "buyerSaleLaw" }>;
  label?: string;
  /**
   * תקבולי רוכשים זכאים לכל חודש בציר (eligibleBuyerReceiptsNis, לא מצטבר - המנוע מצטבר בעצמו),
   * באותו אורך וסדר בדיוק כמו monthIndices. יחידות תמורה שלא שולם עבורן תקבול אינן הופכות אוטומטית
   * לתקבול רוכשים - הבסיס הוא רק מה שהוזן כאן בפועל, לא totalRevenueInclVatNis הכללי ולא שווי יחידות.
   *
   * **מגבלה מתועדת (commit 6b)**: ערכים שליליים (למשל החזר כספי לרוכש) אינם נתמכים ונדחים בוולידציה.
   * המנוע הזה אינו מודל הפחתת-יתרה חלקית - הדרך היחידה להקטין/לאפס את יתרת הערבות היא releaseMonthIndex
   * המלא. אין לנסות "לשחרר" חלק מהיתרה באמצעות תקבול שלילי - זה היה מאפשר ליתרה לרדת בשקט בלי מנגנון
   * שחרור מפורש.
   */
  monthlyEligibleBuyerReceiptsNis: number[];
  /** מחודש זה ואילך (כולל) אין עוד יתרה/עמלה - גבול לא-כולל מלמטה: רק monthIndex < releaseMonthIndex צובר */
  releaseMonthIndex: number;
}

export interface KombinatsiaOwnerGuaranteeInput {
  kind: "kombinatsiaOwner";
  mechanism: Extract<GuaranteeMechanism, { kind: "kombinatsiaOwner" }>;
  label?: string;
  /** שווי שוק קבוע של יחידות הבעלים - קבוע לכל אורך תקופת החשיפה, לא נגזר מתקבולים */
  ownerUnitsMarketValueNis: number;
  /** מועד תחילת החשיפה (למשל תחילת פינוי) - קלט מפורש, לא מוסק */
  startMonthIndex: number;
  // אין releaseMonthIndex נפרד (commit 6b): מקור אמת יחיד לעיתוי השחרור הוא mechanism.durationMonths,
  // כדי למנוע שני שדות שיכולים לסתור זה את זה. חודש השחרור נגזר בתוך computeGuaranteeSchedule:
  // startMonthIndex + mechanism.durationMonths (גבול לא-כולל - ר' תיעוד הפונקציה למטה).
}

export interface UnitCompensationOwnerGuaranteeInput {
  kind: "unitCompensationOwner";
  mechanism: Extract<GuaranteeMechanism, { kind: "unitCompensationOwner" }>;
  label?: string;
  /**
   * שווי דירת התמורה החדשה - קבוע לאורך תקופת החשיפה. נדרש תמיד (גם כש-mechanism.annualRateFraction
   * הוא "requiresVerification") - זו עובדת שמאות נפרדת מהחלטת השיעור, לא אמורה להיעלם יחד איתה.
   */
  compensationUnitValueNis: number;
  /** מועד פינוי */
  startMonthIndex: number;
  /** מועד מסירת דירת התמורה + השבת הערבות (כולל - ר' buyerSaleLaw) */
  releaseMonthIndex: number;
}

export type GuaranteeInstanceInput =
  | BuyerSaleLawGuaranteeInput
  | KombinatsiaOwnerGuaranteeInput
  | UnitCompensationOwnerGuaranteeInput;

export interface GuaranteeScheduleInput {
  /** ציר החודשים המפורש - רציף, ממוין, בלי כפילויות (כמו monthlyInputs במנועי הבסיס/ריבית) */
  monthIndices: number[];
  /**
   * לכל היותר מופע אחד של buyerSaleLaw ולכל היותר מופע אחד של kombinatsiaOwner (מנגנונים אלה
   * מיוצגים כמצרף אחד לכל הפרויקט). unitCompensationOwner מותר בריבוי במפורש - אחד לכל דייר/דירת
   * תמורה, בהתאם ל"אלא אם הטיפוס תומך בכך במפורש".
   */
  instances: GuaranteeInstanceInput[];
}

// --- פלט ---

export interface GuaranteeMonth {
  monthIndex: number;
  buyerGuaranteeBalanceNis: number;
  buyerGuaranteeExpenseNis: number;
  ownerGuaranteeBalanceNis: number;
  ownerGuaranteeExpenseNis: number;
  unitCompensationGuaranteeBalanceNis: number;
  unitCompensationGuaranteeExpenseNis: number;
  totalGuaranteeBalanceNis: number;
  totalGuaranteeExpenseNis: number;
}

export interface GuaranteeScheduleResult {
  months: GuaranteeMonth[];
  totalGuaranteeExpenseNis: number;
  peakGuaranteeBalanceNis: number;
  peakGuaranteeBalanceMonthIndex: number | null;
  /** מופעי unitCompensationOwner עם annualRateFraction==="requiresVerification" - לא מחושבים
   *  (תרומה 0), לא מוחלף בניחוש שקט. "כישלון גלוי" לפי הוראת הביצוע, לא זריקת שגיאה: זהו מצב
   *  תקין ומתועד של הטיפוס עצמו (הליטרל "requiresVerification"), לא קלט פגום. */
  missingAssumptions: string[];
  /**
   * commit 6b: true אם חודש השחרור הנגזר של kombinatsiaOwner (startMonthIndex+durationMonths)
   * חורג מציר החודשים המתוזמן (lastMonth+1). **אינה שגיאה** - הערבות ממשיכה להיות מחושבת ומוצגת
   * ככל שהיא פעילה בתוך הציר (סוף התחזית אינו מאפס אותה בשקט), הדגל רק מציין שהחשיפה בפועל נמשכת
   * גם אחרי גבול המודל הנוכחי.
   */
  activeBeyondForecast: boolean;
}

// --- ולידציה ---

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

function validateReleaseMonth(value: number, firstMonth: number, lastMonth: number, context: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${context}: releaseMonthIndex אינו מספר שלם סופי (${value})`);
  }
  // lastMonth+1 מותר במפורש: "עדיין פעיל עד סוף הציר המתוזמן", לא "משוחרר באמצע"
  if (value < firstMonth || value > lastMonth + 1) {
    throw new Error(
      `${context}: releaseMonthIndex (${value}) מחוץ לטווח האפשרי [${firstMonth}, ${lastMonth + 1}]`
    );
  }
}

function validateFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} חייב להיות מספר סופי לא-שלילי (התקבל ${value})`);
  }
}

function validateInstances(instances: GuaranteeInstanceInput[], monthIndices: number[]): void {
  const firstMonth = monthIndices[0];
  const lastMonth = monthIndices[monthIndices.length - 1];

  const buyerCount = instances.filter((i) => i.kind === "buyerSaleLaw").length;
  if (buyerCount > 1) {
    throw new Error(
      `יותר ממופע אחד של buyerSaleLaw (${buyerCount}) - מנגנון זה מיוצג כמצרף אחד לכל הפרויקט, לא נתמכת כפילות`
    );
  }
  const kombinatsiaCount = instances.filter((i) => i.kind === "kombinatsiaOwner").length;
  if (kombinatsiaCount > 1) {
    throw new Error(
      `יותר ממופע אחד של kombinatsiaOwner (${kombinatsiaCount}) - מנגנון זה מיוצג כמצרף אחד לכל הפרויקט, לא נתמכת כפילות`
    );
  }
  // unitCompensationOwner מותר בריבוי במפורש - ללא בדיקת כמות

  for (const instance of instances) {
    const label = instance.label ? ` ("${instance.label}")` : "";
    const mechanismCheck = validateGuaranteeMechanism(instance.mechanism);
    if (!mechanismCheck.valid) {
      throw new Error(`${instance.kind}${label}: ${mechanismCheck.errors.join("; ")}`);
    }

    if (instance.kind === "buyerSaleLaw") {
      if (instance.monthlyEligibleBuyerReceiptsNis.length !== monthIndices.length) {
        throw new Error(
          `buyerSaleLaw${label}: monthlyEligibleBuyerReceiptsNis.length (${instance.monthlyEligibleBuyerReceiptsNis.length}) ` +
            `לא תואם ל-monthIndices.length (${monthIndices.length})`
        );
      }
      for (const [i, v] of instance.monthlyEligibleBuyerReceiptsNis.entries()) {
        validateFiniteNonNegative(v, `buyerSaleLaw${label}: monthlyEligibleBuyerReceiptsNis[${i}]`);
      }
      validateReleaseMonth(instance.releaseMonthIndex, firstMonth, lastMonth, `buyerSaleLaw${label}`);
      continue;
    }

    // kombinatsiaOwner / unitCompensationOwner - startMonthIndex משותף, אימות זהה
    if (!Number.isFinite(instance.startMonthIndex) || !Number.isInteger(instance.startMonthIndex)) {
      throw new Error(`${instance.kind}${label}: startMonthIndex אינו מספר שלם סופי (${instance.startMonthIndex})`);
    }
    if (instance.startMonthIndex < firstMonth || instance.startMonthIndex > lastMonth) {
      throw new Error(
        `${instance.kind}${label}: startMonthIndex (${instance.startMonthIndex}) מחוץ לציר הפרויקט [${firstMonth}, ${lastMonth}]`
      );
    }

    if (instance.kind === "kombinatsiaOwner") {
      validateFiniteNonNegative(instance.ownerUnitsMarketValueNis, `kombinatsiaOwner${label}: ownerUnitsMarketValueNis`);
      // commit 6b: מקור אמת יחיד לעיתוי השחרור - durationMonths, לא releaseMonthIndex נפרד.
      // חייב חיובי ממש (לא רק >=0 כמו validateGuaranteeMechanism הכללי): משך 0 היה יוצר חלון
      // פעילות ריק מבנית, ערבות שלמעשה אף פעם לא פעילה - כנראה טעות קלט, לא ערך לגיטימי.
      const { durationMonths } = instance.mechanism;
      if (!Number.isInteger(durationMonths) || durationMonths <= 0) {
        throw new Error(`kombinatsiaOwner${label}: durationMonths חייב להיות מספר שלם חיובי (${durationMonths})`);
      }
    } else {
      // unitCompensationOwner: אין durationMonths בטיפוס - releaseMonthIndex נשאר מפורש, כנדרש
      validateReleaseMonth(instance.releaseMonthIndex, firstMonth, lastMonth, `unitCompensationOwner${label}`);
      if (instance.releaseMonthIndex < instance.startMonthIndex) {
        throw new Error(
          `unitCompensationOwner${label}: releaseMonthIndex (${instance.releaseMonthIndex}) קודם ל-startMonthIndex (${instance.startMonthIndex})`
        );
      }
      // הבסיס נדרש תמיד, גם כששיעור="requiresVerification" (עובדת שמאות נפרדת מהחלטת השיעור) -
      // חסר כאן לא מוחלף ב-0 שקט, זו שגיאה חוסמת
      validateFiniteNonNegative(instance.compensationUnitValueNis, `unitCompensationOwner${label}: compensationUnitValueNis`);
    }
  }
}

function sumInPlaceOrder(values: number[]): number[] {
  const cumulative: number[] = new Array(values.length);
  let running = 0;
  for (let i = 0; i < values.length; i++) {
    running += values[i];
    cumulative[i] = running;
  }
  return cumulative;
}

/**
 * מנוע לוח ערבויות: שלושה מנגנונים נפרדים, כל אחד עם בסיס וכללי חשיפה משלו, לא מאוחדים תחת נוסחה
 * כללית. פלט בלבד ב-commit 6a - לא יוצא מהמזומן ולא מגדיל חוב (ר' §4/§6 ב-GEN2_CASHFLOW_DESIGN.md).
 *
 * סדר חישוב לכל חודש ולכל מופע מנגנון:
 * - buyerSaleLaw: יתרה = סכום מצטבר (עד ועם החודש הנוכחי, "יתרת סגירה" - אותה מוסכמה כמו הריבית
 *   ב-commit 5) של monthlyEligibleBuyerReceiptsNis, כל עוד monthIndex < releaseMonthIndex (מפורש).
 * - kombinatsiaOwner: יתרה = ownerUnitsMarketValueNis הקבוע כל עוד startMonthIndex <= monthIndex
 *   < releaseMonthIndex, כאשר releaseMonthIndex **נגזר** (commit 6b, מקור אמת יחיד) כ-
 *   startMonthIndex + mechanism.durationMonths - לא שדה קלט נפרד. גבול לא-כולל: ערבות שמתחילה
 *   בחודש 2 למשך 36 חודשים פעילה בחודשים 2-37, לא בחודש 38.
 * - unitCompensationOwner: יתרה = compensationUnitValueNis הקבוע כל עוד startMonthIndex <=
 *   monthIndex < releaseMonthIndex (מפורש - אין durationMonths בטיפוס הזה, נשאר קלט מפורש).
 * - הוצאה חודשית = יתרת אותו חודש * (annualRateFraction/12), לכל מנגנון בנפרד.
 * - unitCompensationOwner עם annualRateFraction==="requiresVerification": תרומה 0 בכל חודש,
 *   מדווח פעם אחת ב-missingAssumptions - לא מוחלף בניחוש שקט.
 * - אם חודש השחרור הנגזר של kombinatsiaOwner חורג מציר החודשים המתוזמן: **לא** נזרקת שגיאה, הערבות
 *   ממשיכה להיות מחושבת בתוך הציר (סוף התחזית לא מאפס אותה בשקט), ו-activeBeyondForecast=true.
 *
 * יתרה שלילית אינה אפשרית מבנית: כל הבסיסים מאומתים לא-שליליים ואין כאן חיסור בשום מקום (זה מודל
 * יתרה בלבד, לא waterfall עם משיכות/פירעונות) - לכן אין צורך ב-Math.max(0, ...) בשום מקום.
 */
export function computeGuaranteeSchedule(input: GuaranteeScheduleInput): GuaranteeScheduleResult {
  const { monthIndices, instances } = input;
  validateMonthIndices(monthIndices);
  validateInstances(instances, monthIndices);

  const missingAssumptions: string[] = [];

  const buyerInstance = instances.find((i): i is BuyerSaleLawGuaranteeInput => i.kind === "buyerSaleLaw");
  const buyerCumulativeReceipts = buyerInstance ? sumInPlaceOrder(buyerInstance.monthlyEligibleBuyerReceiptsNis) : null;

  const unitCompensationInstances = instances.filter(
    (i): i is UnitCompensationOwnerGuaranteeInput => i.kind === "unitCompensationOwner"
  );
  for (const instance of unitCompensationInstances) {
    if (instance.mechanism.annualRateFraction === "requiresVerification") {
      const label = instance.label ? ` ("${instance.label}")` : "";
      missingAssumptions.push(
        `unitCompensationOwner${label}: annualRateFraction="requiresVerification" - שיעור לא הוזן, המנגנון לא נכלל בחישוב הערבות עד שיוזן שיעור מפורש`
      );
    }
  }

  const kombinatsiaInstance = instances.find(
    (i): i is KombinatsiaOwnerGuaranteeInput => i.kind === "kombinatsiaOwner"
  );
  // commit 6b: מקור אמת יחיד - נגזר פעם אחת מ-startMonthIndex+durationMonths, לא שדה קלט נפרד
  const kombinatsiaReleaseMonthIndex = kombinatsiaInstance
    ? kombinatsiaInstance.startMonthIndex + kombinatsiaInstance.mechanism.durationMonths
    : null;
  const lastMonthIndex = monthIndices[monthIndices.length - 1];
  const activeBeyondForecast = kombinatsiaReleaseMonthIndex !== null && kombinatsiaReleaseMonthIndex > lastMonthIndex + 1;

  const months: GuaranteeMonth[] = monthIndices.map((monthIndex, idx) => {
    let buyerGuaranteeBalanceNis = 0;
    let buyerGuaranteeExpenseNis = 0;
    let ownerGuaranteeBalanceNis = 0;
    let ownerGuaranteeExpenseNis = 0;
    let unitCompensationGuaranteeBalanceNis = 0;
    let unitCompensationGuaranteeExpenseNis = 0;

    if (buyerInstance && buyerCumulativeReceipts && monthIndex < buyerInstance.releaseMonthIndex) {
      const monthlyRate = buyerInstance.mechanism.annualRateFraction / 12;
      buyerGuaranteeBalanceNis = buyerCumulativeReceipts[idx];
      buyerGuaranteeExpenseNis = buyerGuaranteeBalanceNis * monthlyRate;
    }

    if (
      kombinatsiaInstance &&
      kombinatsiaReleaseMonthIndex !== null &&
      monthIndex >= kombinatsiaInstance.startMonthIndex &&
      monthIndex < kombinatsiaReleaseMonthIndex
    ) {
      const monthlyRate = kombinatsiaInstance.mechanism.annualRateFraction / 12;
      ownerGuaranteeBalanceNis = kombinatsiaInstance.ownerUnitsMarketValueNis;
      ownerGuaranteeExpenseNis = ownerGuaranteeBalanceNis * monthlyRate;
    }

    for (const instance of unitCompensationInstances) {
      if (instance.mechanism.annualRateFraction === "requiresVerification") continue;
      if (monthIndex >= instance.startMonthIndex && monthIndex < instance.releaseMonthIndex) {
        const monthlyRate = instance.mechanism.annualRateFraction / 12;
        unitCompensationGuaranteeBalanceNis += instance.compensationUnitValueNis;
        unitCompensationGuaranteeExpenseNis += instance.compensationUnitValueNis * monthlyRate;
      }
    }

    buyerGuaranteeBalanceNis = normalizeMoney(buyerGuaranteeBalanceNis);
    buyerGuaranteeExpenseNis = normalizeMoney(buyerGuaranteeExpenseNis);
    ownerGuaranteeBalanceNis = normalizeMoney(ownerGuaranteeBalanceNis);
    ownerGuaranteeExpenseNis = normalizeMoney(ownerGuaranteeExpenseNis);
    unitCompensationGuaranteeBalanceNis = normalizeMoney(unitCompensationGuaranteeBalanceNis);
    unitCompensationGuaranteeExpenseNis = normalizeMoney(unitCompensationGuaranteeExpenseNis);

    const totalGuaranteeBalanceNis = normalizeMoney(
      buyerGuaranteeBalanceNis + ownerGuaranteeBalanceNis + unitCompensationGuaranteeBalanceNis
    );
    const totalGuaranteeExpenseNis = normalizeMoney(
      buyerGuaranteeExpenseNis + ownerGuaranteeExpenseNis + unitCompensationGuaranteeExpenseNis
    );

    return {
      monthIndex,
      buyerGuaranteeBalanceNis,
      buyerGuaranteeExpenseNis,
      ownerGuaranteeBalanceNis,
      ownerGuaranteeExpenseNis,
      unitCompensationGuaranteeBalanceNis,
      unitCompensationGuaranteeExpenseNis,
      totalGuaranteeBalanceNis,
      totalGuaranteeExpenseNis,
    };
  });

  let totalGuaranteeExpenseNis = 0;
  let peakGuaranteeBalanceNis = 0;
  let peakGuaranteeBalanceMonthIndex: number | null = null;
  for (const month of months) {
    totalGuaranteeExpenseNis += month.totalGuaranteeExpenseNis;
    if (month.totalGuaranteeBalanceNis > peakGuaranteeBalanceNis) {
      peakGuaranteeBalanceNis = month.totalGuaranteeBalanceNis;
      peakGuaranteeBalanceMonthIndex = month.monthIndex;
    }
  }

  return {
    months,
    totalGuaranteeExpenseNis,
    peakGuaranteeBalanceNis,
    peakGuaranteeBalanceMonthIndex,
    missingAssumptions,
    activeBeyondForecast,
  };
}
