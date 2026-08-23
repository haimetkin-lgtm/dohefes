"use client";

import { useEffect, useMemo, useState } from "react";
import { computeProject, isCashLandDeal } from "@/lib/calc/engine";
import { CHAMBER_COSTS, CHAMBER_COST_DATE, type BuildingHeight } from "@/lib/calc/chamberCosts";
import type { DealType, ProjectInputs, UnitType } from "@/lib/calc/types";
import { downloadWorkbook } from "@/lib/report/exportExcel";
import ReportView from "./ReportView";
import ConsultationCTA from "@/app/components/ConsultationCTA";

const HEIGHT_LABELS: Record<BuildingHeight, string> = {
  low: "בניין נמוך (עד 13 מ')",
  high: "בניין גבוה (עד 29 מ')",
  highrise: "בניין רב קומות (מעל 29 מ')",
};

const DEAL_TYPE_LABELS: Record<DealType, string> = {
  basic: "דוח אפס בסיסי",
  tama38: 'תמ"א 38',
  pinuyBinui: "פינוי בינוי",
  kombinatsia: "קומבינציה בעין",
  kombinatsiaTemurot: "קומבינצית תמורות",
  purchaseGroup: "קבוצת רכישה",
  mixedUse: "מעורב מגורים ותעסוקה",
};

const DEAL_TYPE_ORDER: DealType[] = [
  "basic",
  "tama38",
  "pinuyBinui",
  "kombinatsia",
  "kombinatsiaTemurot",
  "purchaseGroup",
  "mixedUse",
];

function emptyUnit(): UnitType {
  return { name: "", count: 1, areaSqm: 0, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 0 };
}

export default function CalculatorPage() {
  const [projectName, setProjectName] = useState("");
  const [dealType, setDealType] = useState<DealType>("basic");
  const [region, setRegion] = useState(CHAMBER_COSTS[0].region);
  const [height, setHeight] = useState<BuildingHeight>("low");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("dealType");
    if (fromUrl && DEAL_TYPE_ORDER.includes(fromUrl as DealType)) {
      setDealType(fromUrl as DealType);
    }
  }, []);
  const [units, setUnits] = useState<UnitType[]>([emptyUnit()]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const chamberRow = CHAMBER_COSTS.find((r) => r.region === region)!;

  const [mainCost, setMainCost] = useState(chamberRow[height]);
  const [commercialCost, setCommercialCost] = useState(0);
  const [officeCost, setOfficeCost] = useState(0);
  const [undergroundCost, setUndergroundCost] = useState(chamberRow.underground);
  const [undergroundArea, setUndergroundArea] = useState(0);
  const [netPlotArea, setNetPlotArea] = useState(0);
  const [demolition, setDemolition] = useState(0);
  const [municipalFees, setMunicipalFees] = useState(0);

  const [landPurchase, setLandPurchase] = useState(0);
  const [bettermentLevy, setBettermentLevy] = useState(0);
  const [combinationShare, setCombinationShare] = useState(0.4);
  const [combinationLandValue, setCombinationLandValue] = useState(0);

  const [equity, setEquity] = useState(0);
  const [presaleRate, setPresaleRate] = useState(0.15);
  const [interestRate, setInterestRate] = useState(0.04);
  const [constructionMonths, setConstructionMonths] = useState(30);
  const [organizerFee, setOrganizerFee] = useState(0);

  const [purchaseTaxRate, setPurchaseTaxRate] = useState(0.06);
  const [planningConsultantsRate, setPlanningConsultantsRate] = useState(0.025);
  const [engineeringInspectionFlat, setEngineeringInspectionFlat] = useState(0);
  const [marketingRate, setMarketingRate] = useState(0.025);
  const [legalRate, setLegalRate] = useState(0.01);
  const [overheadRate, setOverheadRate] = useState(0.025);
  const [managementFeeRate, setManagementFeeRate] = useState(0.06);
  const [contingencyRate, setContingencyRate] = useState(0.05);

  function applyRegionDefaults(nextRegion: string, nextHeight: BuildingHeight) {
    const row = CHAMBER_COSTS.find((r) => r.region === nextRegion);
    if (!row) return;
    setMainCost(row[nextHeight]);
    setUndergroundCost(row.underground);
  }

  const inputs: ProjectInputs = useMemo(
    () => ({
      dealType,
      projectName,
      units,
      costs: {
        balconyWeight: 0.5,
        mainConstructionCostPerSqm: mainCost,
        commercialConstructionCostPerSqm: commercialCost,
        officeConstructionCostPerSqm: officeCost,
        undergroundConstructionCostPerSqm: undergroundCost,
        balconyConstructionCostRatio: 0.5,
        developmentCostPerSqm: 500,
        undergroundAreaSqm: undergroundArea,
        netPlotAreaSqm: netPlotArea,
        demolitionFlatNis: demolition,
        municipalFeesNis: municipalFees,
        brokerageRate: 0.01,
        purchaseTaxRate,
        electricConnectionPerUnitNis: 4500,
        planningFlatNis: 30000,
        planningConsultantsRate,
        engineeringInspectionFlatNis: engineeringInspectionFlat,
        marketingRate,
        legalRate,
        legalRefundPerUnitNis: -5000,
        financialSupervisionFlatNis: 250000,
        overheadRate,
        managementFeeRate,
        contingencyRate,
        guaranteeCommissionRate: 0.0085,
        unusedCreditCommissionRate: 0.0035,
        annualInterestRate: interestRate,
        constructionMonths,
        permitMonths: 12,
        equityNis: equity,
        presaleRate,
        organizerFeeNis: organizerFee,
      },
      land: {
        landPurchaseNis: landPurchase,
        bettermentLevyNis: bettermentLevy,
        combinationOwnerShare: combinationShare,
        combinationLandValueForTaxNis: combinationLandValue,
      },
    }),
    [
      projectName, dealType, units, mainCost, commercialCost, officeCost, undergroundCost, undergroundArea, netPlotArea, demolition, municipalFees,
      purchaseTaxRate, planningConsultantsRate, engineeringInspectionFlat, marketingRate, legalRate, overheadRate, managementFeeRate, contingencyRate,
      interestRate, constructionMonths, equity, presaleRate, organizerFee, landPurchase, bettermentLevy, combinationShare, combinationLandValue,
    ],
  );

  const result = useMemo(() => computeProject(inputs), [inputs]);

  function updateUnit(index: number, patch: Partial<UnitType>) {
    setUnits((prev) => prev.map((u, i) => (i === index ? { ...u, ...patch } : u)));
  }

  return (
    <>
    <main className="max-w-3xl mx-auto px-4 py-8 print:hidden">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">מחשבון דוח אפס</h1>
      <p className="text-sm text-gray-500 mb-1">
        גרסת בדיקה: התוצאה מוצגת מיד, ללא תשלום. חיבור לתשלום ולשמירת פרויקטים בשלב הבא.
      </p>
      <p className="text-xs text-gray-400 mb-6">
        עלויות הבנייה נטענות כברירת מחדל מאומדן לשכת שמאי המקרקעין, {CHAMBER_COST_DATE}. אפשר לשנות
        כל ערך.
      </p>

      {/* שם הפרויקט */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500 text-xs">
            שם הפרויקט (יופיע בדוח ובקובץ המורד), אין חובה להזין כתובת, ניתן לתת כל שם שתבחר
            לפרויקט שלך
          </span>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="למשל: רחוב הרצל 12, רמת גן"
            className="border border-gray-300 rounded-lg px-3 py-2"
          />
        </label>
      </section>

      {/* סוג עסקה */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <div className="font-bold text-[#123640] mb-2 text-sm">סוג עסקה</div>
        <div className="flex flex-wrap gap-2">
          {DEAL_TYPE_ORDER.map((dt) => (
            <button
              key={dt}
              onClick={() => setDealType(dt)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                dealType === dt
                  ? "bg-[#1D6F42] text-white border-[#1D6F42]"
                  : "bg-white text-gray-600 border-gray-300"
              }`}
            >
              {DEAL_TYPE_LABELS[dt]}
            </button>
          ))}
        </div>
      </section>

      {/* אזור ועלויות בנייה */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <div className="font-bold text-[#123640] mb-2 text-sm">עלויות בנייה, ברירת מחדל מהלשכה</div>
        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3 leading-relaxed">
          לפי מתודולוגיית הלשכה, האומדן מתייחס לעלויות בנייה ישירות בלבד ואינו כולל עלויות
          עקיפות, כגון: תכנון וייעוצים, ניהול ופיקוח, אגרות בנייה והיטלים, תקורה (הנהלה
          וכלליות) ועלויות מימון. סעיפים אלה יש להזין בנפרד, בסקשן &quot;מיסים ועלויות עקיפות&quot;
          למטה.
        </p>
        <div className="grid sm:grid-cols-2 gap-2 mb-3">
          <select
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              applyRegionDefaults(e.target.value, height);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {CHAMBER_COSTS.map((r) => (
              <option key={r.region} value={r.region}>
                {r.region}
              </option>
            ))}
          </select>
          <select
            value={height}
            onChange={(e) => {
              const h = e.target.value as BuildingHeight;
              setHeight(h);
              applyRegionDefaults(region, h);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {(Object.keys(HEIGHT_LABELS) as BuildingHeight[]).map((h) => (
              <option key={h} value={h}>
                {HEIGHT_LABELS[h]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid sm:grid-cols-2 gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">עלות בנייה למ&quot;ר עיקרי (₪)</span>
            <input
              type="number"
              value={mainCost}
              onChange={(e) => setMainCost(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          {dealType === "mixedUse" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-gray-500 text-xs">עלות בנייה למ&quot;ר מסחר (₪), ריק = כמו מגורים</span>
                <input
                  type="number"
                  value={commercialCost}
                  onChange={(e) => setCommercialCost(Number(e.target.value))}
                  className="border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-gray-500 text-xs">עלות בנייה למ&quot;ר משרדים (₪), ריק = כמו מגורים</span>
                <input
                  type="number"
                  value={officeCost}
                  onChange={(e) => setOfficeCost(Number(e.target.value))}
                  className="border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
            </>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">עלות בנייה למ&quot;ר תת קרקעי (₪)</span>
            <input
              type="number"
              value={undergroundCost}
              onChange={(e) => setUndergroundCost(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">שטח מרתף/חניה (מ&quot;ר)</span>
            <input
              type="number"
              value={undergroundArea}
              onChange={(e) => setUndergroundArea(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">שטח מגרש נטו (מ&quot;ר)</span>
            <input
              type="number"
              value={netPlotArea}
              onChange={(e) => setNetPlotArea(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">הריסה ופינוי, סכום קבוע (₪)</span>
            <input
              type="number"
              value={demolition}
              onChange={(e) => setDemolition(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">
              אגרות והיטלים עירוניים, סכום כולל (₪) <span className="text-gray-400">תלוי רשות מקומית</span>
            </span>
            <input
              type="number"
              value={municipalFees}
              onChange={(e) => setMunicipalFees(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
        </div>
      </section>

      {/* קרקע */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <div className="font-bold text-[#123640] mb-2 text-sm">קרקע</div>
        {isCashLandDeal(dealType) ? (
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">רכישת קרקע (₪)</span>
              <input
                type="number"
                value={landPurchase}
                onChange={(e) => setLandPurchase(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">היטל השבחה בגין הקלות (₪)</span>
              <input
                type="number"
                value={bettermentLevy}
                onChange={(e) => setBettermentLevy(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">
                {dealType === "pinuyBinui" || dealType === "mixedUse"
                  ? "אחוז החלוקה לדיירים/בעלים הקיימים"
                  : "אחוז הקומבינציה לבעל הקרקע"}
              </span>
              <input
                type="number"
                step="0.01"
                value={combinationShare}
                onChange={(e) => setCombinationShare(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">
                {dealType === "kombinatsiaTemurot"
                  ? "אומדן שווי הקרקע המלא לצורך מס רכישה (₪)"
                  : "אומדן שווי קרקע לצורך מס רכישה, חלק היזם בלבד (₪)"}
              </span>
              <input
                type="number"
                value={combinationLandValue}
                onChange={(e) => setCombinationLandValue(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
          </div>
        )}
      </section>

      {/* תמהיל דירות */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-[#123640] text-sm">תמהיל דירות והכנסות</div>
          <button
            onClick={() => setUnits((prev) => [...prev, emptyUnit()])}
            className="text-xs font-medium text-[#1D6F42] hover:underline"
          >
            + הוספת טיפוס דירה
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="text-gray-500 text-right">
                <th className="py-1 pl-2">טיפוס</th>
                {dealType === "mixedUse" && <th className="py-1 pl-2">קטגוריה</th>}
                <th className="py-1 pl-2">כמות</th>
                <th className="py-1 pl-2">שטח עיקרי</th>
                <th className="py-1 pl-2">ממ&quot;ד</th>
                <th className="py-1 pl-2">מרפסת</th>
                <th className="py-1 pl-2">מרפסת גג</th>
                <th className="py-1 pl-2">
                  {dealType === "mixedUse" ? "מחיר ליחידה (מגורים כולל מע\"מ, מסחר/משרדים נטו)" : "מחיר ליחידה כולל מע\"מ"}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="py-1 pl-2">
                    <input
                      value={u.name}
                      onChange={(e) => updateUnit(i, { name: e.target.value })}
                      placeholder="דירת 4 חדרים"
                      aria-label={`טיפוס דירה, שורה ${i + 1}`}
                      className="w-28 border border-gray-200 rounded px-2 py-1"
                    />
                  </td>
                  {dealType === "mixedUse" && (
                    <td className="py-1 pl-2">
                      <select
                        value={u.category ?? "residential"}
                        onChange={(e) => updateUnit(i, { category: e.target.value as UnitType["category"] })}
                        aria-label={`קטגוריה, שורה ${i + 1}`}
                        className="border border-gray-200 rounded px-1 py-1"
                      >
                        <option value="residential">מגורים</option>
                        <option value="commercial">מסחר</option>
                        <option value="office">משרדים</option>
                      </select>
                    </td>
                  )}
                  {(
                    [
                      ["count", "כמות"],
                      ["areaSqm", "שטח עיקרי"],
                      ["mamadSqm", "ממ\"ד"],
                      ["balconySqm", "מרפסת"],
                      ["roofBalconySqm", "מרפסת גג"],
                      ["priceNis", "מחיר ליחידה"],
                    ] as const
                  ).map(([field, label]) => (
                    <td key={field} className="py-1 pl-2">
                      <input
                        type="number"
                        value={u[field]}
                        onChange={(e) => updateUnit(i, { [field]: Number(e.target.value) })}
                        aria-label={`${label}, שורה ${i + 1}`}
                        className="w-20 border border-gray-200 rounded px-2 py-1"
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      onClick={() => setUnits((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-400 hover:text-red-500 px-1"
                      aria-label="מחיקה"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* מימון */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <div className="font-bold text-[#123640] mb-2 text-sm">מימון</div>
        <div className="grid sm:grid-cols-2 gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">הון עצמי מושקע (₪)</span>
            <input
              type="number"
              value={equity}
              onChange={(e) => setEquity(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">אחוז מכירה מוקדמת (פרי-סייל)</span>
            <input
              type="number"
              step="0.01"
              value={presaleRate}
              onChange={(e) => setPresaleRate(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">ריבית שנתית</span>
            <input
              type="number"
              step="0.01"
              value={interestRate}
              onChange={(e) => setInterestRate(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">משך תקופת הבנייה (חודשים)</span>
            <input
              type="number"
              value={constructionMonths}
              onChange={(e) => setConstructionMonths(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
        </div>
      </section>

      {dealType === "purchaseGroup" && (
        <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
          <div className="font-bold text-[#123640] mb-2 text-sm">שכר המארגן</div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-500 text-xs">
              עמלת ארגון הקבוצה, סכום קבוע (₪), נוסף לעלויות הקבוצה ומוצג גם כרווח המארגן בנפרד
            </span>
            <input
              type="number"
              value={organizerFee}
              onChange={(e) => setOrganizerFee(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 max-w-xs"
            />
          </label>
        </section>
      )}

      {/* מיסים ועלויות עקיפות, מתקדם */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <button
          onClick={() => setShowAdvanced((s) => !s)}
          className="font-bold text-[#123640] text-sm w-full text-right"
        >
          {showAdvanced ? "▲" : "▼"} מיסים ועלויות עקיפות, ברירות מחדל ניתנות לעריכה
        </button>
        {showAdvanced && (
          <div className="grid sm:grid-cols-2 gap-2 text-sm mt-3">
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">מס רכישה</span>
              <input
                type="number"
                step="0.01"
                value={purchaseTaxRate}
                onChange={(e) => setPurchaseTaxRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">תכנון ויועצים, % מעלות בנייה</span>
              <input
                type="number"
                step="0.01"
                value={planningConsultantsRate}
                onChange={(e) => setPlanningConsultantsRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">פיקוח הנדסי, סכום קבוע (₪)</span>
              <input
                type="number"
                value={engineeringInspectionFlat}
                onChange={(e) => setEngineeringInspectionFlat(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">שיווק ופרסום, % מהכנסות</span>
              <input
                type="number"
                step="0.01"
                value={marketingRate}
                onChange={(e) => setMarketingRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">משפטי, % מהכנסות כולל מע&quot;מ</span>
              <input
                type="number"
                step="0.01"
                value={legalRate}
                onChange={(e) => setLegalRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">תקורות הנהלה, % מעלות בנייה</span>
              <input
                type="number"
                step="0.01"
                value={overheadRate}
                onChange={(e) => setOverheadRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">דמי ניהול וניהול כספי, % מעלות בנייה</span>
              <input
                type="number"
                step="0.01"
                value={managementFeeRate}
                onChange={(e) => setManagementFeeRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">בצ&quot;מ (בלתי צפוי), % מעלות בנייה</span>
              <input
                type="number"
                step="0.01"
                value={contingencyRate}
                onChange={(e) => setContingencyRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
          </div>
        )}
      </section>

      {result.warnings.length > 0 && (
        <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 space-y-0.5">
          {result.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </main>

    <div className="max-w-3xl mx-auto px-4 pb-10">
      <div className="print:hidden text-sm font-bold text-[#123640] mb-2">הדוח שלכם</div>
      <ReportView inputs={inputs} result={result} />

      <div className="print:hidden flex flex-col sm:flex-row gap-2 mt-4">
        <button
          onClick={() => downloadWorkbook(inputs, result)}
          className="flex-1 bg-[#1D6F42] hover:bg-[#14502F] text-white font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          הורדת קובץ Excel
        </button>
        <button
          onClick={() => window.print()}
          className="flex-1 bg-white border border-[#1D6F42] text-[#1D6F42] hover:bg-[#EAF3EC] font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          הדפסה / שמירה כ-PDF
        </button>
      </div>

      <div className="print:hidden mt-4">
        <ConsultationCTA />
      </div>

      <p className="print:hidden text-xs text-gray-400 text-center mt-4">
        עמלות המימון ועלות המימון מחושבות כאן בקירוב מפושט (לא סימולציית תזרים רבעונית מלאה). כלי
        חישוב עזר בלבד, ר&apos;{" "}
        <a href="/dohefes/terms/" className="underline">
          תנאי השימוש
        </a>
        .
      </p>
    </div>
    </>
  );
}
