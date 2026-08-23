import type { ProjectInputs, ProjectResult } from "@/lib/calc/types";
import Logo from "@/app/components/Logo";

const DEAL_TYPE_LABEL: Record<ProjectInputs["dealType"], string> = {
  basic: "דוח אפס בסיסי",
  tama38: 'תמ"א 38',
  pinuyBinui: "פינוי בינוי",
  kombinatsia: "קומבינציה בעין",
  kombinatsiaTemurot: "קומבינצית תמורות",
  purchaseGroup: "קבוצת רכישה",
  mixedUse: "מעורב מגורים ותעסוקה",
};

function nis(n: number): string {
  return Math.round(n).toLocaleString("he-IL") + " ₪";
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("he-IL", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export default function ReportView({ inputs, result }: { inputs: ProjectInputs; result: ProjectResult }) {
  return (
    <div id="report-view" className="hidden print:block bg-white text-black text-sm p-8 max-w-3xl mx-auto" dir="rtl">
      <div className="flex items-center justify-between border-b-2 border-[#1D6F42] pb-3 mb-4">
        <Logo height={50} />
        <div className="text-xs text-gray-500">{new Date().toLocaleDateString("he-IL")}</div>
      </div>
      <div className="text-sm text-gray-500 mb-4">טיוטת חישוב</div>

      <div className="grid grid-cols-2 gap-2 mb-6 text-xs">
        <div>
          <span className="text-gray-500">פרויקט: </span>
          {inputs.projectName || "ללא שם"}
        </div>
        <div>
          <span className="text-gray-500">סוג עסקה: </span>
          {DEAL_TYPE_LABEL[inputs.dealType]}
        </div>
      </div>

      <h2 className="font-bold text-[#123640] border-b border-gray-200 mb-2 pb-1">תמהיל דירות</h2>
      <table className="w-full text-xs mb-6 border-collapse">
        <thead>
          <tr className="text-gray-500 border-b border-gray-300">
            <th className="text-right py-1">טיפוס</th>
            <th className="text-right py-1">כמות</th>
            <th className="text-right py-1">שטח עיקרי</th>
            <th className="text-right py-1">ממ&quot;ד</th>
            <th className="text-right py-1">מרפסת</th>
            <th className="text-right py-1">מרפסת גג</th>
            <th className="text-right py-1">מחיר ליחידה</th>
          </tr>
        </thead>
        <tbody>
          {inputs.units.map((u, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-1">{u.name || "ללא שם"}</td>
              <td className="py-1">{u.count}</td>
              <td className="py-1">{fmt(u.areaSqm)}</td>
              <td className="py-1">{fmt(u.mamadSqm)}</td>
              <td className="py-1">{fmt(u.balconySqm)}</td>
              <td className="py-1">{fmt(u.roofBalconySqm)}</td>
              <td className="py-1">{nis(u.priceNis)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <h2 className="font-bold text-[#123640] border-b border-gray-200 mb-2 pb-1">שטחים</h2>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="py-0.5 text-gray-600">שטח עיקרי</td>
                <td className="py-0.5 text-left">{fmt(result.areas.totalMainAreaSqm)} מ&quot;ר</td>
              </tr>
              <tr>
                <td className="py-0.5 text-gray-600">שטח לשיווק</td>
                <td className="py-0.5 text-left">{fmt(result.areas.totalMarketableAreaSqm)} מ&quot;ר</td>
              </tr>
              <tr>
                <td className="py-0.5 text-gray-600">יחידות דיור</td>
                <td className="py-0.5 text-left">{result.areas.unitCount}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="font-bold text-[#123640] border-b border-gray-200 mb-2 pb-1">הכנסות</h2>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="py-0.5 text-gray-600">סה&quot;כ הכנסה כולל מע&quot;מ</td>
                <td className="py-0.5 text-left">{nis(result.revenue.totalRevenueInclVatNis)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-gray-600">הכנסת היזם, לא כולל מע&quot;מ</td>
                <td className="py-0.5 text-left">{nis(result.revenue.developerRevenueExclVatNis)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-gray-600">מחיר ממוצע למ&quot;ר</td>
                <td className="py-0.5 text-left">{nis(result.revenue.averagePricePerSqmNis)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="font-bold text-[#123640] border-b border-gray-200 mb-2 pb-1">עלויות</h2>
      <table className="w-full text-xs mb-6">
        <tbody>
          <tr>
            <td className="py-0.5 text-gray-600">קרקע</td>
            <td className="py-0.5 text-left">{nis(result.costs.landNis)}</td>
          </tr>
          <tr>
            <td className="py-0.5 text-gray-600">עקיפות</td>
            <td className="py-0.5 text-left">{nis(result.costs.indirectNis)}</td>
          </tr>
          <tr>
            <td className="py-0.5 text-gray-600">עמלות מימון</td>
            <td className="py-0.5 text-left">{nis(result.costs.commissionsNis)}</td>
          </tr>
          <tr>
            <td className="py-0.5 text-gray-600">בנייה ישירה</td>
            <td className="py-0.5 text-left">{nis(result.costs.directConstructionNis)}</td>
          </tr>
          <tr>
            <td className="py-0.5 text-gray-600">מימון</td>
            <td className="py-0.5 text-left">{nis(result.costs.financingNis)}</td>
          </tr>
          <tr className="border-t border-gray-300 font-medium">
            <td className="py-1">סה&quot;כ עלויות</td>
            <td className="py-1 text-left">{nis(result.costs.totalInclFinancingNis)}</td>
          </tr>
        </tbody>
      </table>

      <div className="bg-[#EAF3EC] border border-[#BFE0CC] rounded p-4 flex items-center justify-between mb-6">
        <div>
          <div className="text-xs text-gray-600">רווח שוטף</div>
          <div className="font-bold text-base">{nis(result.profitability.currentProfitNis)}</div>
        </div>
        <div className="text-left">
          <div className="text-xs text-gray-600">רווח לעלות</div>
          <div className="font-bold text-xl">{fmt(result.profitability.profitToCostRatio * 100, 1)}%</div>
        </div>
      </div>

      <p className="text-[10px] text-gray-500 leading-relaxed border-t border-gray-200 pt-3">
        כלי חישוב עזר בלבד. כל נתון שהוזן הוא באחריות המזין. אינו מהווה חוות דעת שמאית ואינו תחליף
        לבדיקת שמאי מקרקעין מוסמך. עמלות המימון ועלות המימון חושבו בקירוב מפושט. השימוש על אחריות
        המשתמש בלבד, ר&apos; תנאי השימוש והגבלת האחריות באתר. © חיים אטקין, בית שמאי.
      </p>
    </div>
  );
}
