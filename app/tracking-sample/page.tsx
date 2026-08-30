"use client";

import { CATALOG, formatPriceNis } from "@/lib/catalog";
import { downloadTrackingWorkbook } from "@/lib/report/exportTrackingExcel";
import { computeTrackingTotals, itemBudgetNis, type TrackingItem } from "@/lib/tracking/types";

const PROJECT_NAME = "מתחם הגנים, דוגמת מעקב בלבד";

const SAMPLE_ITEMS: TrackingItem[] = [
  { id: "setup-1", phase: "התארגנות והריסה", description: "גידור, התארגנות אתר ושילוט", quantity: 1, unitPriceNis: 420_000, actualNis: 405_000 },
  { id: "setup-2", phase: "התארגנות והריסה", description: "הריסת המבנה ופינוי פסולת", quantity: 1, unitPriceNis: 780_000, actualNis: 812_000 },
  { id: "foundation-1", phase: "ביסוס ודיפון", description: "כלונסאות ודיפון", quantity: 96, unitPriceNis: 18_500, actualNis: 1_520_000 },
  { id: "foundation-2", phase: "ביסוס ודיפון", description: "חפירה ופינוי עפר", quantity: 8_400, unitPriceNis: 145, actualNis: 1_015_000 },
  { id: "structure-1", phase: "שלד", description: "בטון, ברזל וטפסנות", quantity: 7_800, unitPriceNis: 2_850, actualNis: 8_950_000 },
  { id: "structure-2", phase: "שלד", description: "קירות חוץ ומחיצות", quantity: 1, unitPriceNis: 3_250_000, actualNis: 890_000 },
  { id: "systems-1", phase: "מערכות וגמר", description: "חשמל ותקשורת", quantity: 52, unitPriceNis: 58_000, actualNis: 620_000 },
  { id: "systems-2", phase: "מערכות וגמר", description: "אינסטלציה וכיבוי אש", quantity: 52, unitPriceNis: 46_000, actualNis: 480_000 },
  { id: "development-1", phase: "פיתוח ומסירה", description: "פיתוח חצר ותשתיות חוץ", quantity: 1, unitPriceNis: 2_100_000, actualNis: 0 },
];

function nis(value: number): string {
  return `${Math.round(value).toLocaleString("he-IL")} ₪`;
}

export default function TrackingSamplePage() {
  const totals = computeTrackingTotals(SAMPLE_ITEMS);
  const phaseGroups = totals.byPhase.map((phase) => ({
    ...phase,
    items: SAMPLE_ITEMS.filter((item) => item.phase === phase.phase),
  }));

  return (
    <main className="w-full min-w-0 max-w-4xl mx-auto px-4 py-8 overflow-x-hidden">
      <div className="text-center mb-6 print:hidden">
        <div className="inline-block text-xs font-bold text-[#8A5A12] bg-[#FFF7E8] border border-[#E7C98B] rounded-full px-3 py-1 mb-2">
          דוגמה עם נתונים בדויים בלבד
        </div>
        <h1 className="text-xl font-bold text-[#14502F] mb-1">דוגמת {CATALOG.trackingReports.displayName}</h1>
        <p className="text-sm text-gray-500 mb-1">{PROJECT_NAME}</p>
        <p className="text-sm text-gray-600 max-w-2xl mx-auto">
          כך נראה מעקב תקציב מול ביצוע לאורך הבנייה. המוצר האמיתי הוא מוצר המשך נפרד לדוח אפס עצמאי קיים,
          במחיר {formatPriceNis(CATALOG.trackingReports.priceAgorot)}, ואינו כלול במחיר דוח האפס.
        </p>
      </div>

      <div className="print:hidden flex flex-col sm:flex-row gap-2 mb-6">
        <button
          type="button"
          onClick={() => downloadTrackingWorkbook(PROJECT_NAME, SAMPLE_ITEMS)}
          className="flex-1 bg-[#1D6F42] hover:bg-[#14502F] text-white font-medium text-sm px-4 py-2.5 rounded-lg"
        >
          הורדת Excel של נתוני הדוגמה
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex-1 bg-white border border-[#1D6F42] text-[#1D6F42] hover:bg-[#EAF3EC] font-medium text-sm px-4 py-2.5 rounded-lg"
        >
          הדפסת דוגמת הדוח / PDF
        </button>
      </div>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 text-sm">
        {[
          ["תקציב כולל", nis(totals.budgetNis)],
          ["בוצע עד כה", nis(totals.actualNis)],
          ["יתרה לביצוע", nis(totals.remainingNis)],
          ["ביצוע כולל", `${Math.round(totals.percentComplete * 100)}%`],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#EAF3EC] border border-[#BFE0CC] rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">{label}</div>
            <div className="font-bold text-[#14502F] tabular-nums">{value}</div>
          </div>
        ))}
      </section>

      <section className="min-w-0 mb-7">
        <h2 className="font-bold text-[#123640] text-sm mb-2">תמונת מצב לפי שלב</h2>
        <div className="w-full max-w-full overflow-x-auto print:overflow-visible border border-gray-200 rounded-lg">
          <table className="w-full text-xs min-w-[620px] print:min-w-0 print:text-[9px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="text-right px-3 py-2">שלב</th>
                <th className="text-right px-3 py-2">תקציב</th>
                <th className="text-right px-3 py-2">בוצע</th>
                <th className="text-right px-3 py-2">יתרה</th>
                <th className="text-right px-3 py-2">% ביצוע</th>
              </tr>
            </thead>
            <tbody>
              {phaseGroups.map((phase) => (
                <tr key={phase.phase} className="border-t border-gray-100 tabular-nums">
                  <td className="px-3 py-2 font-medium text-[#14502F]">{phase.phase}</td>
                  <td className="px-3 py-2">{nis(phase.budgetNis)}</td>
                  <td className="px-3 py-2">{nis(phase.actualNis)}</td>
                  <td className="px-3 py-2">{nis(phase.remainingNis)}</td>
                  <td className="px-3 py-2">{Math.round(phase.percentComplete * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="min-w-0 space-y-5">
        {phaseGroups.map((group) => (
          <div key={group.phase} className="min-w-0 border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-[#EAF3EC] px-3 py-2 text-sm font-bold text-[#14502F]">{group.phase}</div>
            <div className="w-full max-w-full overflow-x-auto print:overflow-visible">
              <table className="w-full text-xs min-w-[720px] print:min-w-0 print:text-[9px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    <th className="text-right px-2 py-2">סעיף</th>
                    <th className="text-right px-2 py-2">כמות</th>
                    <th className="text-right px-2 py-2">מחיר יחידה</th>
                    <th className="text-right px-2 py-2">תקציב</th>
                    <th className="text-right px-2 py-2">בוצע</th>
                    <th className="text-right px-2 py-2">יתרה</th>
                    <th className="text-right px-2 py-2">% ביצוע</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => {
                    const budget = itemBudgetNis(item);
                    return (
                      <tr key={item.id} className="border-t border-gray-100 tabular-nums">
                        <td className="px-2 py-2">{item.description}</td>
                        <td className="px-2 py-2">{item.quantity.toLocaleString("he-IL")}</td>
                        <td className="px-2 py-2">{nis(item.unitPriceNis)}</td>
                        <td className="px-2 py-2">{nis(budget)}</td>
                        <td className="px-2 py-2">{nis(item.actualNis)}</td>
                        <td className="px-2 py-2">{nis(budget - item.actualNis)}</td>
                        <td className="px-2 py-2">{budget ? Math.round((item.actualNis / budget) * 100) : 0}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <div className="print:hidden text-center mt-8">
        <p className="text-sm text-gray-600 mb-3">
          כדי לרכוש דוחות מעקב יש ליצור תחילה דוח אפס, ולאחר מכן לבחור בדוחות המעקב מתוך הדוח הקיים.
        </p>
        <a href="/dohefes/start/" className="inline-block bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold px-6 py-3 rounded-lg">
          התחלת דוח אפס חדש ←
        </a>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-4 mt-8 text-center">
        הדוגמה אינה פרויקט אמיתי ואינה משקפת חשבון מאושר. דוח מעקב הוא כלי עזר ואינו תחליף
        לחשבון קבלן, פיקוח הנדסי או אישור גורם מקצועי.
      </p>
    </main>
  );
}
