// commit 3 של מנוע התזרים: תרגום PaymentTranche ללוח תקבולים חודשי. פונקציות טהורות בלבד -
// אין הון עצמי, אשראי, ריבית או ערבויות כאן (זה מנוע התזרים הבסיסי, commit 4). ר' GEN2_CASHFLOW_DESIGN.md §3.

import { validatePaymentSchedule } from "./cashflow-validation";
import type { PaymentTranche, SaleScheduleModel } from "./cashflow-types";
import type { UnitCategory } from "./types";

export interface MonthlyReceipt {
  monthIndex: number;
  amountNis: number;
}

/** תת-קבוצת שדות UnitType הרלוונטיים כאן, בלי import מ-types.ts (נמנעים מתלות מעגלית מיותרת) */
export interface ReceiptUnitInput {
  count: number;
  priceNis: number;
  category?: UnitCategory;
  isCompensationUnit?: boolean;
  isExistingStructure?: boolean;
}

function unitCategoryOrDefault(category: UnitCategory | undefined): UnitCategory {
  return category ?? "residential";
}

/**
 * מוצאת את החודש (אינדקס) הראשון שבו עקומת הבנייה מגיעה לאחוז ההתקדמות הנדרש. קונבנציית האינדקס
 * זהה ל-resolveConstructionCurve: curve[i] = אחוז מצטבר בסוף חודש i (0-based - חודש 0 הוא החודש
 * הראשון של הבנייה). אם אף חודש לא מגיע לאחוז (עקומה ריקה, או cumulativeProgress גבוה מהשיא),
 * מוחזר האינדקס האחרון כברירת מחדל בטוחה (לא זורק - זו רק נקודת עיגון לתשלום, לא שגיאת קלט).
 */
function resolveConstructionProgressMonth(constructionCurve: number[], cumulativeProgress: number): number {
  for (let i = 0; i < constructionCurve.length; i++) {
    if (constructionCurve[i] >= cumulativeProgress) return i;
  }
  return Math.max(0, constructionCurve.length - 1);
}

/**
 * מתרגמת יחידת תמהיל (שורה בטבלה) ללוח תקבולים חודשי.
 *
 * **בסיס המע"מ, כפי שנבדק מול הכלל הקיים ב-engine.ts**: הסכום המתקבל בכל חודש הוא count*priceNis,
 * בדיוק כמו revenue.totalRevenueInclVatNis הקיים (`const inclVat = u.count * u.priceNis` בכל היחידות,
 * ללא הבחנה קטגורית באותה נקודה). **לא ממיר בין מגורים למסחר/משרדים** - מגורים: priceNis מוזן כולל
 * מע"מ (מוסכמה קיימת), מסחר/משרדים: priceNis מוזן נטו (מוסכמה קיימת אחרת). כלומר התקבול החודשי
 * משקף בדיוק את הסכום שהמשתמש הזין ליחידה, באותו בסיס מע"מ שהוא הזין - עקבי עם שאר המנוע, לא
 * "מתקן" את המוסכמה הקיימת (שממילא לא מוסיפה מע"מ בפועל על מסחר/משרדים בשום מקום קיים).
 *
 * **אף פעם לא מייצרות תקבול**: יחידות תמורה (isCompensationUnit), מבנה קיים מחוזק
 * (isExistingStructure), ומב"צ (category==="publicBuilding") - ר' §3.4 במסמך התכנון. מוחזר מערך ריק.
 *
 * @param constructionCurve נדרש (וממופה לפי אינדקס חודש 0-based) רק כש-scheduleModel==="legacyConstructionLinked"
 *   וקיימת מנה מסוג constructionProgress. לא בשימוש בשום מסלול אחר.
 */
export function computeUnitMonthlyReceipts(
  unit: ReceiptUnitInput,
  tranches: PaymentTranche[],
  saleMonth: number,
  handoverMonth: number,
  scheduleModel: SaleScheduleModel,
  constructionCurve?: number[]
): MonthlyReceipt[] {
  if (unit.isCompensationUnit || unit.isExistingStructure || unitCategoryOrDefault(unit.category) === "publicBuilding") {
    return [];
  }

  const validation = validatePaymentSchedule(tranches, saleMonth, handoverMonth, scheduleModel);
  if (!validation.valid) {
    throw new Error(`לוח תקבולים לא תקין: ${validation.errors.join("; ")}`);
  }

  const needsCurve = tranches.some((t) => t.timing.kind === "constructionProgress");
  if (needsCurve && (!constructionCurve || constructionCurve.length === 0)) {
    throw new Error('מנה מסוג "constructionProgress" דורשת constructionCurve לא ריקה');
  }

  const totalAmountNis = unit.count * unit.priceNis;
  const byMonth = new Map<number, number>();
  const addAmount = (monthIndex: number, amountNis: number) => {
    byMonth.set(monthIndex, (byMonth.get(monthIndex) ?? 0) + amountNis);
  };

  for (const tranche of tranches) {
    const trancheAmountNis = tranche.fraction * totalAmountNis;
    const { timing } = tranche;

    switch (timing.kind) {
      case "relativeToSale":
        addAmount(saleMonth + timing.monthsAfterSale, trancheAmountNis);
        break;
      case "projectMonth":
        addAmount(timing.monthIndex, trancheAmountNis);
        break;
      case "handover":
        addAmount(handoverMonth, trancheAmountNis);
        break;
      case "evenSpread": {
        const fromMonth = saleMonth + timing.fromMonthsAfterSale;
        const toMonth = saleMonth + timing.toMonthsAfterSale;
        // כולל שני הקצוות; from===to -> חודש יחיד, monthCount=1, חלוקה דטרמיניסטית טריוויאלית
        const monthCount = toMonth - fromMonth + 1;
        const perMonthAmount = trancheAmountNis / monthCount;
        for (let m = fromMonth; m <= toMonth; m++) {
          addAmount(m, perMonthAmount);
        }
        break;
      }
      case "constructionProgress": {
        const monthIndex = resolveConstructionProgressMonth(constructionCurve!, timing.cumulativeProgress);
        addAmount(monthIndex, trancheAmountNis);
        break;
      }
    }
  }

  // התאמת אגורות/שקלים: סכום הביניים (float, בעיקר מחלוקות evenSpread לא-עגולות) עשוי לסטות
  // במעט מ-totalAmountNis. ההפרש מתווסף לחודש האחרון שיש בו תקבול בפועל, לא נאבד בשקט.
  const sortedMonths = Array.from(byMonth.keys()).sort((a, b) => a - b);
  const computedTotal = Array.from(byMonth.values()).reduce((sum, v) => sum + v, 0);
  const residual = totalAmountNis - computedTotal;
  if (sortedMonths.length > 0 && residual !== 0) {
    const lastMonth = sortedMonths[sortedMonths.length - 1];
    byMonth.set(lastMonth, byMonth.get(lastMonth)! + residual);
  }

  return sortedMonths.map((monthIndex) => ({ monthIndex, amountNis: byMonth.get(monthIndex)! }));
}
