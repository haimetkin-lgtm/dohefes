import type { ProjectInputs, ProjectResult } from "@/lib/calc/types";
import Logo from "@/app/components/Logo";
import ConsultationCTA from "@/app/components/ConsultationCTA";

const DEAL_TYPE_LABEL: Record<ProjectInputs["dealType"], string> = {
  basic: "דוח אפס בסיסי",
  tama38: 'תמ"א 38',
  pinuyBinui: "פינוי בינוי",
  kombinatsia: "קומבינציה בעין",
  kombinatsiaTemurot: "קומבינצית תמורות",
  purchaseGroup: "קבוצת רכישה",
  mixedUse: "מעורב מגורים ותעסוקה",
};

// המודל מייצג רק את מסלול ההריסה, לא מסלול חיזוק (אין בו סעיפי חיזוק הנדסי)
const DEAL_TYPE_SUBTITLE: Partial<Record<ProjectInputs["dealType"], string>> = {
  tama38: "הריסה ובנייה מחדש",
};

const CATEGORY_LABEL: Record<string, string> = {
  residential: "מגורים",
  commercial: "מסחר",
  office: "משרדים",
};

function nis(n: number): string {
  return Math.round(n).toLocaleString("he-IL") + " ₪";
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("he-IL", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? "border-t border-gray-300" : "border-b border-gray-50"}>
      <td className={`py-1.5 text-gray-600 ${strong ? "font-bold text-[#123640] pt-2.5" : ""}`}>{label}</td>
      <td className={`py-1.5 text-left tabular-nums ${strong ? "font-bold text-[#123640] pt-2.5" : ""}`}>{value}</td>
    </tr>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-bold text-[#123640] text-base mb-2.5">
      <span className="inline-block w-1.5 h-4 rounded-full bg-[#1D6F42]" />
      {children}
    </h2>
  );
}

export default function ReportView({ inputs, result }: { inputs: ProjectInputs; result: ProjectResult }) {
  const isGroup = inputs.dealType === "purchaseGroup";
  // מבוסס על הנתונים בפועל ולא על סוג העסקה, כל סוג עסקה שהקרקע בו משולמת באחוז חלוקה
  // יכול לכלול יחידות ממספר קטגוריות (למשל פינוי בינוי עם מסחר בקומת קרקע)
  const isMixed = new Set(inputs.units.map((u) => u.category ?? "residential")).size > 1;
  const dateStr = new Date().toLocaleDateString("he-IL");

  return (
    <div
      id="report-view"
      className="bg-white text-black text-sm max-w-3xl mx-auto rounded-2xl border border-gray-200 shadow-lg print:shadow-none print:border-0 overflow-hidden"
      dir="rtl"
    >
      {/* כותרת */}
      <div className="bg-gradient-to-l from-[#EAF3EC] to-white px-8 py-6 border-b-2 border-[#1D6F42] flex items-center justify-between flex-wrap gap-3">
        <Logo height={52} />
        <div className="text-left">
          <div className="text-xs text-gray-500">{dateStr}</div>
          <div className="text-xs font-medium text-[#14502F] bg-white border border-[#BFE0CC] rounded-full px-2.5 py-0.5 mt-1 inline-block">
            {DEAL_TYPE_LABEL[inputs.dealType]}
          </div>
          {DEAL_TYPE_SUBTITLE[inputs.dealType] && (
            <div className="text-[10px] text-gray-400 mt-1">{DEAL_TYPE_SUBTITLE[inputs.dealType]}</div>
          )}
        </div>
      </div>

      <div className="px-8 pt-5 pb-8">
        <div className="mb-6">
          <div className="text-xs text-gray-400 mb-0.5">פרויקט</div>
          <div className="text-xl font-bold text-[#14502F]">{inputs.projectName || "ללא שם"}</div>
          <div className="text-xs text-gray-400 mt-0.5">טיוטת חישוב, לא חוות דעת שמאית</div>
        </div>

        {/* תמהיל */}
        <div className="mb-7">
          <SectionTitle>תמהיל דירות והכנסות</SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-xs border-collapse min-w-[500px]">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="text-right py-2 px-2">טיפוס</th>
                  {isMixed && <th className="text-right py-2 px-2">קטגוריה</th>}
                  <th className="text-right py-2 px-2">כמות</th>
                  <th className="text-right py-2 px-2">שטח עיקרי</th>
                  <th className="text-right py-2 px-2">ממ&quot;ד</th>
                  <th className="text-right py-2 px-2">מרפסת</th>
                  <th className="text-right py-2 px-2">מרפסת גג</th>
                  <th className="text-right py-2 px-2">מחיר ליחידה</th>
                </tr>
              </thead>
              <tbody>
                {inputs.units.map((u, i) => (
                  <tr key={i} className="border-t border-gray-100 tabular-nums">
                    <td className="py-1.5 px-2">{u.name || "ללא שם"}</td>
                    {isMixed && <td className="py-1.5 px-2">{CATEGORY_LABEL[u.category ?? "residential"]}</td>}
                    <td className="py-1.5 px-2">{u.count}</td>
                    <td className="py-1.5 px-2">{fmt(u.areaSqm)}</td>
                    <td className="py-1.5 px-2">{fmt(u.mamadSqm)}</td>
                    <td className="py-1.5 px-2">{fmt(u.balconySqm)}</td>
                    <td className="py-1.5 px-2">{fmt(u.roofBalconySqm)}</td>
                    <td className="py-1.5 px-2">{nis(u.priceNis)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-7">
          <div>
            <SectionTitle>שטחים</SectionTitle>
            <table className="w-full text-xs">
              <tbody>
                <Row label="שטח עיקרי" value={`${fmt(result.areas.totalMainAreaSqm)} מ"ר`} />
                <Row label="שטח לשיווק" value={`${fmt(result.areas.totalMarketableAreaSqm)} מ"ר`} />
                <Row label="יחידות" value={fmt(result.areas.unitCount)} />
              </tbody>
            </table>
          </div>
          <div>
            <SectionTitle>הכנסות</SectionTitle>
            <table className="w-full text-xs">
              <tbody>
                <Row label="סה&quot;כ הכנסה כולל מע&quot;מ" value={nis(result.revenue.totalRevenueInclVatNis)} />
                <Row label="הכנסת היזם, לא כולל מע&quot;מ" value={nis(result.revenue.developerRevenueExclVatNis)} />
                <Row label="מחיר ממוצע למ&quot;ר" value={nis(result.revenue.averagePricePerSqmNis)} />
              </tbody>
            </table>
          </div>
        </div>

        <div className="mb-7">
          <SectionTitle>עלויות</SectionTitle>
          <table className="w-full text-xs">
            <tbody>
              <Row label="קרקע" value={nis(result.costs.landNis)} />
              <Row label="עקיפות" value={nis(result.costs.indirectNis)} />
              {isGroup && result.costs.organizerFeeNis > 0 && (
                <Row label="מתוכן, שכר מארגן" value={nis(result.costs.organizerFeeNis)} />
              )}
              {result.costs.relocationRentNis > 0 && (
                <Row label="מתוכן, דמי שכירות לדיירים קיימים" value={nis(result.costs.relocationRentNis)} />
              )}
              <Row label="עמלות מימון" value={nis(result.costs.commissionsNis)} />
              <Row label="בנייה ישירה" value={nis(result.costs.directConstructionNis)} />
              <Row label="מימון" value={nis(result.costs.financingNis)} />
              <Row label="סה&quot;כ עלויות" value={nis(result.costs.totalInclFinancingNis)} strong />
            </tbody>
          </table>
        </div>

        {/* רווחיות */}
        <div className="bg-gradient-to-l from-[#EAF3EC] to-[#F5FAF6] border border-[#BFE0CC] rounded-xl p-5 flex items-center justify-between flex-wrap gap-4 mb-2">
          <div>
            <div className="text-xs text-[#14502F]/70 mb-0.5">{isGroup ? "חיסכון לחברי הקבוצה" : "רווח שוטף"}</div>
            <div className="font-bold text-xl text-[#14502F] tabular-nums">{nis(result.profitability.currentProfitNis)}</div>
          </div>
          <div className="text-left">
            <div className="text-xs text-[#14502F]/70 mb-0.5">{isGroup ? "אחוז חיסכון מול שווי שוק" : "רווח לעלות"}</div>
            <div
              className={`font-bold text-3xl tabular-nums ${result.profitability.profitToCostRatio >= 0 ? "text-[#14502F]" : "text-red-600"}`}
            >
              {fmt(result.profitability.profitToCostRatio * 100, 1)}%
            </div>
          </div>
        </div>

        <div className="mt-4">
          <ConsultationCTA />
        </div>
      </div>

      <p className="text-[10px] text-gray-500 leading-relaxed border-t border-gray-100 px-8 py-4 bg-gray-50">
        כלי חישוב עזר בלבד. כל נתון שהוזן הוא באחריות המזין. אינו מהווה חוות דעת שמאית ואינו תחליף
        לבדיקת שמאי מקרקעין מוסמך. עמלות המימון ועלות המימון חושבו בקירוב מפושט. השימוש על אחריות
        המשתמש בלבד, ראה תנאי השימוש והגבלת האחריות באתר. © חיים אטקין, בית שמאי<sup>®</sup>.
      </p>
    </div>
  );
}
