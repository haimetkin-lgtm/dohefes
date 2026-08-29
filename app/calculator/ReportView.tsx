"use client";

import { Fragment } from "react";
import { isCashLandDeal, landMechanism, profitToCostBenchmark } from "@/lib/calc/engine";
import type { ProjectInputs, ProjectResult } from "@/lib/calc/types";
import { downloadWorkbook } from "@/lib/report/exportExcel";
import { LOCKED_EXPORT_MESSAGE, handleExcelExportClick, handlePrintClick, isExportUnlocked } from "@/lib/report/outputAccess";
import type { OutputAccess } from "@/lib/report/outputAccess";
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

const CATEGORY_LABEL: Record<string, string> = {
  residential: "מגורים",
  residentialPremium: "מגורים פרימיום",
  commercial: "מסחר",
  office: "משרדים",
  publicBuilding: 'מב"צ',
  existingStructure: "חיזוק שלד קיים",
};

// תווית שורת פירוט הבנייה לקטגוריה, תלוית-הקשר: כשיש גם residential וגם residentialPremium
// באותו פרויקט (פינוי בינוי טיפוסי), residential מתויג "תמורה" ו-residentialPremium "פרימיום".
// אחרת (רק residential, כמו תמ"א 38/בסיסי רגיל) נשארת התווית הרגילה "מגורים".
function constructionCategoryLabel(category: string, hasBothResidentialTiers: boolean): string {
  if (hasBothResidentialTiers && category === "residential") return "דירות תמורה";
  if (hasBothResidentialTiers && category === "residentialPremium") return "דירות פרימיום";
  if (category === "residential") return "דירות (מגורים)";
  return CATEGORY_LABEL[category] ?? category;
}

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

export default function ReportView({
  inputs,
  result,
  outputAccess,
}: {
  inputs: ProjectInputs;
  result: ProjectResult;
  /** קלט חובה, בלי ברירת מחדל - ר' lib/report/outputAccess.ts. כל call site קובע במפורש. */
  outputAccess: OutputAccess;
}) {
  const isGroup = inputs.dealType === "purchaseGroup";
  // מבוסס על הנתונים בפועל ולא על סוג העסקה, כל סוג עסקה שהקרקע בו משולמת באחוז חלוקה
  // יכול לכלול יחידות ממספר קטגוריות (למשל פינוי בינוי עם מסחר בקומת קרקע)
  const isMixed = new Set(inputs.units.map((u) => u.category ?? "residential")).size > 1;
  // "residential" מתויג "דירות תמורה" בפירוט הבנייה רק כשהוא בפועל משמש כדרגת התמורה
  // (מסומן isCompensationUnit), לא סתם כי יש גם residentialPremium באותו פרויקט - למשל
  // בחיזוק ותוספת יש residential חדש שנמכר בשוק לצד residentialPremium, בלי קשר לתמורה כלל.
  const residentialIsCompensationTier = inputs.units.some(
    (u) => (u.category ?? "residential") === "residential" && u.isCompensationUnit
  );
  const hasBothResidentialTiers =
    residentialIsCompensationTier && inputs.units.some((u) => u.category === "residentialPremium");
  const usesUnitCompensation = landMechanism(inputs.dealType) === "unitCompensation";
  const hasReinforcement = inputs.units.some((u) => u.isExistingStructure);
  const benchmark = profitToCostBenchmark(inputs.dealType);
  const showResidualLandValue = isCashLandDeal(inputs.dealType) && benchmark !== null;
  const hasFeasibilityMetrics = result.feasibility.breakEven.averagePricePerSqmNis !== null || showResidualLandValue;
  const dateStr = new Date().toLocaleDateString("he-IL");
  const dealTypeSubtitle =
    inputs.dealType === "tama38" ? (hasReinforcement ? "חיזוק ותוספת" : "הריסה ובנייה מחדש") : undefined;

  const exportUnlocked = isExportUnlocked(outputAccess);

  return (
    <>
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
          {dealTypeSubtitle && <div className="text-[10px] text-gray-400 mt-1">{dealTypeSubtitle}</div>}
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
                  {usesUnitCompensation && <th className="text-right py-2 px-2">תמורה</th>}
                  {hasReinforcement && <th className="text-right py-2 px-2">מבנה קיים</th>}
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
                    {usesUnitCompensation && (
                      <td className="py-1.5 px-2">{u.isCompensationUnit ? "כן" : "—"}</td>
                    )}
                    {hasReinforcement && (
                      <td className="py-1.5 px-2">{u.isExistingStructure ? "כן" : "—"}</td>
                    )}
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

        {/* פירוט עלויות בנייה ותשלומים נלווים */}
        <div className="mb-7">
          <SectionTitle>פירוט עלויות בנייה ותשלומים נלווים</SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-xs border-collapse min-w-[420px]">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="text-right py-2 px-2">סעיף</th>
                  <th className="text-right py-2 px-2">שטח</th>
                  <th className="text-right py-2 px-2">סה&quot;כ</th>
                </tr>
              </thead>
              <tbody>
                {result.costs.constructionBreakdown.map((row) => {
                  const label = constructionCategoryLabel(row.category, hasBothResidentialTiers);
                  return (
                    <Fragment key={row.category}>
                      <tr className="border-t border-gray-100 tabular-nums">
                        <td className="py-1.5 px-2">עלויות בנייה למ&quot;ר {label}</td>
                        <td className="py-1.5 px-2">{fmt(row.mainAreaSqm)} מ&quot;ר</td>
                        <td className="py-1.5 px-2">{nis(row.mainCostNis)}</td>
                      </tr>
                      {row.otherAreaSqm > 0 && (
                        <tr className="border-t border-gray-100 tabular-nums">
                          <td className="py-1.5 px-2">עלויות בנייה למ&quot;ר מרפסות {label}</td>
                          <td className="py-1.5 px-2">{fmt(row.otherAreaSqm)} מ&quot;ר</td>
                          <td className="py-1.5 px-2">{nis(row.otherCostNis)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {inputs.costs.demolitionFlatNis > 0 && (
                  <tr className="border-t border-gray-100 tabular-nums">
                    <td className="py-1.5 px-2">עלויות הריסה ופינוי</td>
                    <td className="py-1.5 px-2 text-gray-300">—</td>
                    <td className="py-1.5 px-2">{nis(inputs.costs.demolitionFlatNis)}</td>
                  </tr>
                )}
                {inputs.land.bettermentLevyNis > 0 && (
                  <tr className="border-t border-gray-100 tabular-nums">
                    <td className="py-1.5 px-2">היטל השבחה</td>
                    <td className="py-1.5 px-2 text-gray-300">—</td>
                    <td className="py-1.5 px-2">{nis(inputs.land.bettermentLevyNis)}</td>
                  </tr>
                )}
                {result.costs.municipalFeesNis > 0 && (
                  <tr className="border-t border-gray-100 tabular-nums">
                    <td className="py-1.5 px-2">אגרות והיטלים עירוניים</td>
                    <td className="py-1.5 px-2 text-gray-300">—</td>
                    <td className="py-1.5 px-2">{nis(result.costs.municipalFeesNis)}</td>
                  </tr>
                )}
                {result.costs.relocationRentNis > 0 && (
                  <tr className="border-t border-gray-100 tabular-nums">
                    <td className="py-1.5 px-2">דמי שכירות לדיירים קיימים</td>
                    <td className="py-1.5 px-2 text-gray-300">
                      {inputs.costs.relocationUnitsCount} יח&apos; × {inputs.costs.relocationMonths} חוד&apos;
                    </td>
                    <td className="py-1.5 px-2">{nis(result.costs.relocationRentNis)}</td>
                  </tr>
                )}
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
            {usesUnitCompensation && (
              <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                הכנסת היזם אינה כוללת את יחידות התמורה (מסומנות בטבלה למעלה), הן ניתנות לדיירים
                הקיימים ואינן חלק ממכירות היזם.
              </p>
            )}
          </div>
        </div>

        <div className="mb-7">
          <SectionTitle>עלויות (לא כולל מע&quot;מ)</SectionTitle>
          <table className="w-full text-xs">
            <tbody>
              <Row
                label={isCashLandDeal(inputs.dealType) ? "קרקע" : "היטל השבחה"}
                value={nis(result.costs.landNis)}
              />
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
            {!isGroup && benchmark !== null && (
              <div className={`text-xs mt-0.5 ${result.profitability.profitToCostRatio >= benchmark ? "text-[#1D6F42]" : "text-amber-700"}`}>
                {result.profitability.profitToCostRatio >= benchmark
                  ? `מעל הסף המקובל בשוק (${fmt(benchmark * 100, 0)}%)`
                  : `מתחת לסף המקובל בשוק (${fmt(benchmark * 100, 0)}%)`}
              </div>
            )}
          </div>
        </div>

        {/* מדדי רווחיות נוספים */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 mb-7 px-1">
          <span>
            רווח למחזור: <strong className="text-[#123640] tabular-nums">{fmt(result.profitability.profitToRevenueRatio * 100, 1)}%</strong>
          </span>
          {result.profitability.cashOnCashAnnualRatio !== 0 && (
            <span>
              תשואה על ההון העצמי לשנה:{" "}
              <strong className="text-[#123640] tabular-nums">{fmt(result.profitability.cashOnCashAnnualRatio * 100, 1)}%</strong>
            </span>
          )}
        </div>

        {/* מדדי היתכנות (דור 2): נקודת איזון, מרווח ביטחון, שווי קרקע שיורי - כולם מחושבים
            במנוע (lib/calc/engine.ts) על ידי הרצה מלאה וחוזרת של שרשרת החישוב, לא קירוב תצוגתי.
            מוסתר לגמרי כשאין מה להציג (שלד טרי בלי מחירים, ולא עסקת מזומן) */}
        {hasFeasibilityMetrics && (
        <div className="mb-7">
          <SectionTitle>מדדי היתכנות</SectionTitle>
          <p className="text-xs text-gray-500 mb-2">מדדי עזר לבחינת רגישות הפרויקט, לא שומה ולא תחליף לבדיקת שמאי.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-gray-600">
            {result.feasibility.breakEven.averagePricePerSqmNis !== null && (
              <span>
                מחיר ממוצע למ&quot;ר בנקודת האיזון:{" "}
                <strong className="text-[#123640] tabular-nums">{nis(result.feasibility.breakEven.averagePricePerSqmNis)}</strong>
              </span>
            )}
            {result.feasibility.breakEven.marginOfSafetyRatio !== null && (
              <span>
                מרווח ביטחון בהכנסות:{" "}
                <strong className={`tabular-nums ${result.feasibility.breakEven.marginOfSafetyRatio >= 0 ? "text-[#123640]" : "text-red-600"}`}>
                  {fmt(result.feasibility.breakEven.marginOfSafetyRatio * 100, 1)}%
                </strong>
              </span>
            )}
            {showResidualLandValue && (
              <span>
                שווי קרקע שיורי (ליעד רווח-לעלות מקובל):{" "}
                <strong className="text-[#123640] tabular-nums">
                  {result.feasibility.residualLandValueNis !== null ? nis(result.feasibility.residualLandValueNis) : "לא מושג בטווח שנבדק"}
                </strong>
              </span>
            )}
          </div>
        </div>
        )}

        {/* ניתוח רגישות: אותה טבלה שהוצגה עד היום (4 תרחישים), מחוברת עכשיו לתוצאות מנוע
            החישוב (result.feasibility.sensitivityMatrix, 25 תאים) במקום חישוב מקורב ברכיב עצמו */}
        <div className="mb-7">
          <SectionTitle>ניתוח רגישות</SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-xs border-collapse min-w-[420px]">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="text-right py-2 px-2">תרחיש</th>
                  <th className="text-right py-2 px-2">רווח</th>
                  <th className="text-right py-2 px-2">רווח לעלות</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "לפי התחזית", revenueFactor: 1, costFactor: 1 },
                  { label: "עלויות בנייה +10%", revenueFactor: 1, costFactor: 1.1 },
                  { label: "הכנסות -10%", revenueFactor: 0.9, costFactor: 1 },
                  { label: "עלויות בנייה +10%, הכנסות -10%", revenueFactor: 0.9, costFactor: 1.1 },
                ].map((scenario) => {
                  const cell = result.feasibility.sensitivityMatrix.find(
                    (c) => c.revenueFactor === scenario.revenueFactor && c.costFactor === scenario.costFactor
                  )!;
                  return (
                    <tr key={scenario.label} className="border-t border-gray-100 tabular-nums">
                      <td className="py-1.5 px-2">{scenario.label}</td>
                      <td className="py-1.5 px-2">{nis(cell.profitNis)}</td>
                      <td className={`py-1.5 px-2 ${cell.profitToCostRatio >= 0 ? "" : "text-red-600"}`}>{fmt(cell.profitToCostRatio * 100, 1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* בדיקת הקצאה והוגנות ליחידה, ר' נספח א.xlsx: מוצגת רק כשיש חלוקת קרקע/תמורה בין שני צדדים */}
        {result.unitAllocation.length > 0 && (
          <div className="mb-7">
            <SectionTitle>בדיקת הקצאה והוגנות בין דיירים/שותפים</SectionTitle>
            <p className="text-xs text-gray-500 mb-2">
              חלוקת שווי הקרקע ועלות ההקמה בין סוגי היחידות לפי שטח משוקלל יחסי, מול שווי השוק שלהן.
              יחס הפער-לעלות אמור להיות דומה בין כל סוגי היחידות, כבדיקת הוגנות שלא סוג אחד נהנה על חשבון אחר.
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs border-collapse min-w-[640px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    <th className="text-right py-2 px-2">טיפוס</th>
                    <th className="text-right py-2 px-2">אחוז יחסי</th>
                    <th className="text-right py-2 px-2">עלות ליחידה</th>
                    <th className="text-right py-2 px-2">שווי שוק ליחידה</th>
                    <th className="text-right py-2 px-2">פער ליחידה</th>
                    <th className="text-right py-2 px-2">יחס פער-לעלות</th>
                  </tr>
                </thead>
                <tbody>
                  {result.unitAllocation.map((row) => (
                    <tr key={row.name} className="border-t border-gray-100 tabular-nums">
                      <td className="py-1.5 px-2">{row.name}</td>
                      <td className="py-1.5 px-2">{fmt(row.sharePercent * 100, 1)}%</td>
                      <td className="py-1.5 px-2">{nis(row.costBasisPerUnitNis)}</td>
                      <td className="py-1.5 px-2">{nis(row.marketValuePerUnitNis)}</td>
                      <td className={`py-1.5 px-2 ${row.gapPerUnitNis >= 0 ? "" : "text-red-600"}`}>{nis(row.gapPerUnitNis)}</td>
                      <td className={`py-1.5 px-2 ${row.gapRatio >= 0 ? "" : "text-red-600"}`}>{fmt(row.gapRatio * 100, 1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-4">
          <ConsultationCTA />
        </div>
      </div>

      <p className="text-[10px] text-gray-500 leading-relaxed border-t border-gray-100 px-8 py-4 bg-gray-50">
        כלי חישוב עזר בלבד. כל נתון שהוזן הוא באחריות המזין. אינו מהווה חוות דעת שמאית ואינו תחליף
        לבדיקת שמאי מקרקעין מוסמך. עמלות המימון ועלות המימון חושבו בקירוב מפושט. ההכנסות והעלויות
        בדוח, לרבות ברווח לעלות, כולן לא כוללות מע&quot;מ: עבור יזם רשום כדין, מע&quot;מ שנגבה מלקוחות
        משולם למדינה ומע&quot;מ ששולם לספקים מתקזז מולו, ולכן אינו משפיע על הרווח הכלכלי. השימוש על
        אחריות המשתמש בלבד, ראה תנאי השימוש והגבלת האחריות באתר. © חיים אטקין, בית שמאי<sup>®</sup>.
      </p>
    </div>

    {/* ייצוא Excel/הדפסה - Commit 4: נעול לגמרי (trial/sample) או פעיל (full), לפי outputAccess
        שהמסך הקורא סיפק במפורש. disabled אמיתי (לא רק עיצוב) + handler שלא קורא לפונקציית
        הייצוא בכלל כשנעול (ר' lib/report/outputAccess.ts) - שתי שכבות הגנה, לא כפילות מיותרת. */}
    <div className="print:hidden max-w-3xl mx-auto mt-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={() => handleExcelExportClick(outputAccess, () => downloadWorkbook(inputs, result))}
          disabled={!exportUnlocked}
          aria-disabled={!exportUnlocked}
          className={`flex-1 font-medium text-sm px-4 py-2.5 rounded-lg transition-colors ${
            exportUnlocked
              ? "bg-[#1D6F42] hover:bg-[#14502F] text-white"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }`}
        >
          הורדת קובץ Excel
        </button>
        <button
          onClick={() => handlePrintClick(outputAccess, () => window.print())}
          disabled={!exportUnlocked}
          aria-disabled={!exportUnlocked}
          className={`flex-1 font-medium text-sm px-4 py-2.5 rounded-lg transition-colors ${
            exportUnlocked
              ? "bg-white border border-[#1D6F42] text-[#1D6F42] hover:bg-[#EAF3EC]"
              : "bg-gray-100 border border-gray-200 text-gray-400 cursor-not-allowed"
          }`}
        >
          הדפסה / שמירה כ-PDF
        </button>
      </div>
      {!exportUnlocked && (
        <p className="text-xs text-gray-500 text-center mt-2" aria-live="polite">
          {LOCKED_EXPORT_MESSAGE}
        </p>
      )}
    </div>
    </>
  );
}
