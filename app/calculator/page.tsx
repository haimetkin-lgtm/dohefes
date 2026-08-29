"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeProject, isCashLandDeal, landMechanism } from "@/lib/calc/engine";
import { CHAMBER_COSTS, CHAMBER_COST_DATE, type BuildingHeight } from "@/lib/calc/chamberCosts";
import type { CostInputs, DealType, LandInputs, MunicipalFeeInputs, ProjectInputs, UnitType } from "@/lib/calc/types";
import { downloadWorkbook } from "@/lib/report/exportExcel";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { CATALOG, formatPriceNis } from "@/lib/catalog";
import ReportView from "./ReportView";

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

const SITE_URL = "https://haimetkin-lgtm.github.io/dohefes";

function emptyUnit(): UnitType {
  return { name: "", count: 1, areaSqm: 0, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 0, isCompensationUnit: false };
}

const DEFAULT_MUNICIPAL_FEES: MunicipalFeeInputs = {
  buildingFeeRatePerSqm: 0,
  waterConnectionRatePerSqm: 0,
  sewageConnectionRatePerSqm: 0,
  roadDrainagePlotRatePerSqm: 0,
  roadDrainageBuildingRatePerSqm: 0,
  roadDrainageUndergroundRatePerSqm: 0,
};

// ברירות המחדל של דוח חדש וריק. משמשות גם כגיבוי כשטוענים דוח (?id=) שנוצר עם שדות
// עלות/קרקע חלקיים בלבד, כמו שלד שבנה הסוכן החכם (רק dealType/projectName/units, בלי עלויות).
const DEFAULT_COSTS: CostInputs = {
  balconyWeight: 0.5,
  mainConstructionCostPerSqm: 0,
  premiumConstructionCostPerSqm: 0,
  commercialConstructionCostPerSqm: 0,
  officeConstructionCostPerSqm: 0,
  publicBuildingConstructionCostPerSqm: 0,
  reinforcementCostPerSqm: 0,
  undergroundConstructionCostPerSqm: 0,
  balconyConstructionCostRatio: 0.5,
  developmentCostPerSqm: 500,
  undergroundAreaSqm: 0,
  netPlotAreaSqm: 0,
  demolitionFlatNis: 0,
  municipalFees: DEFAULT_MUNICIPAL_FEES,
  brokerageRate: 0.01,
  purchaseTaxRate: 0.06,
  electricConnectionPerUnitNis: 4500,
  planningFlatNis: 30000,
  planningConsultantsRate: 0.025,
  engineeringInspectionFlatNis: 0,
  marketingRate: 0.025,
  legalRate: 0.01,
  legalRefundPerUnitNis: -5000,
  financialSupervisionFlatNis: 250000,
  overheadRate: 0.025,
  managementFeeRate: 0.06,
  contingencyRate: 0.05,
  guaranteeCommissionRate: 0.0085,
  unusedCreditCommissionRate: 0.0035,
  accountOpeningCommissionRate: 0.0045,
  annualInterestRate: 0.04,
  constructionMonths: 30,
  permitMonths: 12,
  equityNis: 0,
  presaleRate: 0.15,
  organizerFeeNis: 0,
  relocationUnitsCount: 0,
  relocationMonths: 0,
  relocationRentPerUnitMonthlyNis: 0,
};

const DEFAULT_LAND: LandInputs = {
  landPurchaseNis: 0,
  bettermentLevyNis: 0,
  combinationOwnerShare: 0.4,
  combinationLandValueForTaxNis: 0,
};

export default function CalculatorPage() {
  const [projectName, setProjectName] = useState("");
  const [dealType, setDealType] = useState<DealType>("basic");
  // מנוע החישוב (engine.ts) מטפל בפילוח קטגוריות (מגורים/מסחר/משרדים) בכל סוג עסקה שהקרקע
  // בו משולמת באחוז חלוקה, לא רק מעורב שימושים. פינוי בינוי עם מסחר בקומת קרקע נפוץ בפועל.
  // זמין תמיד, לא רק במעורב שימושים: נמצא בקבצי מקור אמיתיים (למשל תרגיל בית "יזמות") שגם
  // פרויקט מגורים "רגיל" יכול לכלול מסחר/מב"צ (בית כנסת כמטלה ציבורית) לצד המגורים. אין נזק
  // בהצגת האפשרות תמיד, מי שלא צריך פשוט לא נוגע בה (קטגוריה נשארת מגורים כברירת מחדל).
  const supportsMixedCategories = true;
  const usesUnitCompensation = landMechanism(dealType) === "unitCompensation";
  // תמ"א 38 "חיזוק ותוספת": חלק מהשטח הוא מבנה קיים שרק מתחזק (עלות נמוכה משמעותית מבנייה חדשה),
  // לא נהרס כמו ב"הריסה ובנייה מחדש". רלוונטי רק לתמ"א 38.
  const supportsReinforcement = dealType === "tama38";
  const [region, setRegion] = useState(CHAMBER_COSTS[0].region);
  const [height, setHeight] = useState<BuildingHeight>("low");

  const [units, setUnits] = useState<UnitType[]>([emptyUnit()]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const chamberRow = CHAMBER_COSTS.find((r) => r.region === region)!;

  const [mainCost, setMainCost] = useState(chamberRow[height]);
  const [premiumCost, setPremiumCost] = useState(0);
  const [commercialCost, setCommercialCost] = useState(0);
  const [officeCost, setOfficeCost] = useState(0);
  const [publicBuildingCost, setPublicBuildingCost] = useState(0);
  const [reinforcementCost, setReinforcementCost] = useState(0);
  const [undergroundCost, setUndergroundCost] = useState(chamberRow.underground);
  const [undergroundArea, setUndergroundArea] = useState(0);
  const [netPlotArea, setNetPlotArea] = useState(0);
  const [demolition, setDemolition] = useState(0);
  const [buildingFeeRate, setBuildingFeeRate] = useState(0);
  const [waterConnectionRate, setWaterConnectionRate] = useState(0);
  const [sewageConnectionRate, setSewageConnectionRate] = useState(0);
  const [roadDrainagePlotRate, setRoadDrainagePlotRate] = useState(0);
  const [roadDrainageBuildingRate, setRoadDrainageBuildingRate] = useState(0);
  const [roadDrainageUndergroundRate, setRoadDrainageUndergroundRate] = useState(0);
  const [relocationUnitsCount, setRelocationUnitsCount] = useState(0);
  const [relocationMonths, setRelocationMonths] = useState(0);
  const [relocationRentPerUnit, setRelocationRentPerUnit] = useState(0);

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

  const [reportId, setReportId] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [urlParsed, setUrlParsed] = useState(false);
  const [paidPending, setPaidPending] = useState(false);
  const insertedRef = useRef(false);

  function applyRegionDefaults(nextRegion: string, nextHeight: BuildingHeight) {
    const row = CHAMBER_COSTS.find((r) => r.region === nextRegion);
    if (!row) return;
    setMainCost(row[nextHeight]);
    setUndergroundCost(row.underground);
  }

  function applyLoadedInputs(loaded: ProjectInputs) {
    // מיזוג עם ברירות המחדל, לא השמה ישירה: דוח שנבנה על ידי הסוכן החכם שומר רק
    // dealType/projectName/units (ר' ai_notes ב-dohefes_custom_orders), בלי עלויות/קרקע כלל.
    const costs = {
      ...DEFAULT_COSTS,
      ...(loaded.costs || {}),
      municipalFees: { ...DEFAULT_MUNICIPAL_FEES, ...(loaded.costs?.municipalFees || {}) },
    };
    const land = { ...DEFAULT_LAND, ...(loaded.land || {}) };
    setProjectName(loaded.projectName);
    setDealType(loaded.dealType);
    setUnits(loaded.units?.length > 0 ? loaded.units : [emptyUnit()]);
    setMainCost(costs.mainConstructionCostPerSqm);
    setPremiumCost(costs.premiumConstructionCostPerSqm);
    setCommercialCost(costs.commercialConstructionCostPerSqm);
    setOfficeCost(costs.officeConstructionCostPerSqm);
    setPublicBuildingCost(costs.publicBuildingConstructionCostPerSqm);
    setReinforcementCost(costs.reinforcementCostPerSqm);
    setUndergroundCost(costs.undergroundConstructionCostPerSqm);
    setUndergroundArea(costs.undergroundAreaSqm);
    setNetPlotArea(costs.netPlotAreaSqm);
    setDemolition(costs.demolitionFlatNis);
    setBuildingFeeRate(costs.municipalFees.buildingFeeRatePerSqm);
    setWaterConnectionRate(costs.municipalFees.waterConnectionRatePerSqm);
    setSewageConnectionRate(costs.municipalFees.sewageConnectionRatePerSqm);
    setRoadDrainagePlotRate(costs.municipalFees.roadDrainagePlotRatePerSqm);
    setRoadDrainageBuildingRate(costs.municipalFees.roadDrainageBuildingRatePerSqm);
    setRoadDrainageUndergroundRate(costs.municipalFees.roadDrainageUndergroundRatePerSqm);
    setRelocationUnitsCount(costs.relocationUnitsCount);
    setRelocationMonths(costs.relocationMonths);
    setRelocationRentPerUnit(costs.relocationRentPerUnitMonthlyNis);
    setPurchaseTaxRate(costs.purchaseTaxRate);
    setPlanningConsultantsRate(costs.planningConsultantsRate);
    setEngineeringInspectionFlat(costs.engineeringInspectionFlatNis);
    setMarketingRate(costs.marketingRate);
    setLegalRate(costs.legalRate);
    setOverheadRate(costs.overheadRate);
    setManagementFeeRate(costs.managementFeeRate);
    setContingencyRate(costs.contingencyRate);
    setInterestRate(costs.annualInterestRate);
    setConstructionMonths(costs.constructionMonths);
    setEquity(costs.equityNis);
    setPresaleRate(costs.presaleRate);
    setOrganizerFee(costs.organizerFeeNis);
    setLandPurchase(land.landPurchaseNis);
    setBettermentLevy(land.bettermentLevyNis);
    setCombinationShare(land.combinationOwnerShare);
    setCombinationLandValue(land.combinationLandValueForTaxNis);
  }

  const inputs: ProjectInputs = useMemo(
    () => ({
      dealType,
      projectName,
      units,
      costs: {
        balconyWeight: 0.5,
        mainConstructionCostPerSqm: mainCost,
        premiumConstructionCostPerSqm: premiumCost,
        commercialConstructionCostPerSqm: commercialCost,
        officeConstructionCostPerSqm: officeCost,
        publicBuildingConstructionCostPerSqm: publicBuildingCost,
        reinforcementCostPerSqm: reinforcementCost,
        undergroundConstructionCostPerSqm: undergroundCost,
        balconyConstructionCostRatio: 0.5,
        developmentCostPerSqm: 500,
        undergroundAreaSqm: undergroundArea,
        netPlotAreaSqm: netPlotArea,
        demolitionFlatNis: demolition,
        municipalFees: {
          buildingFeeRatePerSqm: buildingFeeRate,
          waterConnectionRatePerSqm: waterConnectionRate,
          sewageConnectionRatePerSqm: sewageConnectionRate,
          roadDrainagePlotRatePerSqm: roadDrainagePlotRate,
          roadDrainageBuildingRatePerSqm: roadDrainageBuildingRate,
          roadDrainageUndergroundRatePerSqm: roadDrainageUndergroundRate,
        },
        relocationUnitsCount,
        relocationMonths,
        relocationRentPerUnitMonthlyNis: relocationRentPerUnit,
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
        accountOpeningCommissionRate: 0.0045,
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
      projectName, dealType, units, mainCost, premiumCost, commercialCost, officeCost, publicBuildingCost, reinforcementCost, undergroundCost, undergroundArea, netPlotArea, demolition,
      buildingFeeRate, waterConnectionRate, sewageConnectionRate, roadDrainagePlotRate, roadDrainageBuildingRate, roadDrainageUndergroundRate,
      relocationUnitsCount, relocationMonths, relocationRentPerUnit,
      purchaseTaxRate, planningConsultantsRate, engineeringInspectionFlat, marketingRate, legalRate, overheadRate, managementFeeRate, contingencyRate,
      interestRate, constructionMonths, equity, presaleRate, organizerFee, landPurchase, bettermentLevy, combinationShare, combinationLandValue,
    ],
  );

  const result = useMemo(() => computeProject(inputs), [inputs]);

  // פענוח פרמטרי URL בטעינה: ?id=<uuid> (דוח קיים, לטעון) או ?dealType=X&paid=true (דוח חדש אחרי תשלום)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dealTypeParam = params.get("dealType");
    if (dealTypeParam && DEAL_TYPE_ORDER.includes(dealTypeParam as DealType)) {
      setDealType(dealTypeParam as DealType);
    }
    const existingId = params.get("id");
    if (existingId && supabaseConfigured) {
      setLoadingReport(true);
      supabase
        .from("dohefes_reports")
        .select("inputs")
        .eq("id", existingId)
        .single()
        .then(({ data }) => {
          if (data?.inputs) applyLoadedInputs(data.inputs as ProjectInputs);
          setReportId(existingId);
          setLoadingReport(false);
          setUrlParsed(true);
        });
      return;
    }
    if (params.get("paid") === "true") setPaidPending(true);
    setUrlParsed(true);
  }, []);

  // יצירת רשומת דוח + קישור קבוע, פעם אחת, מיד אחרי הגעה עם paid=true (בלי לחכות שהמשתמש ימלא נתונים)
  useEffect(() => {
    if (!urlParsed || !paidPending || reportId || insertedRef.current || !supabaseConfigured) return;
    insertedRef.current = true;
    supabase
      .from("dohefes_reports")
      .insert({
        project_name: inputs.projectName || null,
        deal_type: inputs.dealType,
        inputs,
        results: result,
        payment_status: "paid",
      })
      .select("id")
      .single()
      .then(({ data }) => {
        if (data?.id) {
          setReportId(data.id);
          const url = new URL(window.location.href);
          url.searchParams.delete("paid");
          url.searchParams.set("id", data.id);
          window.history.replaceState({}, "", url.toString());
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlParsed, paidPending, reportId]);

  // שמירה רציפה (debounced) של הדוח בכל שינוי, ברגע שיש קישור קבוע
  useEffect(() => {
    if (!reportId || !supabaseConfigured) return;
    const timer = setTimeout(() => {
      supabase
        .from("dohefes_reports")
        .update({
          project_name: inputs.projectName || null,
          deal_type: inputs.dealType,
          inputs,
          results: result,
        })
        .eq("id", reportId)
        .then(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [reportId, inputs, result]);

  function updateUnit(index: number, patch: Partial<UnitType>) {
    setUnits((prev) => prev.map((u, i) => (i === index ? { ...u, ...patch } : u)));
  }

  return (
    <>
    <main className="max-w-3xl mx-auto px-4 py-8 print:hidden">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">מחולל דוח אפס</h1>
      {loadingReport ? (
        <p className="text-sm text-gray-500 mb-6">טוען את הדוח שלך...</p>
      ) : reportId ? (
        <div className="bg-[#EAF3EC] border border-[#BFE0CC] rounded-lg px-3 py-2 mb-6 text-xs text-gray-700">
          הדוח נשמר אוטומטית עם כל שינוי. הקישור הקבוע שלו:{" "}
          <a href={`${SITE_URL}/calculator/?id=${reportId}`} className="text-[#1D6F42] underline break-all">
            {`${SITE_URL}/calculator/?id=${reportId}`}
          </a>
          <p className="mt-1">
            {CATALOG.trackingReports.displayName} - מוצר המשך אופציונלי לדוח זה,{" "}
            {formatPriceNis(CATALOG.trackingReports.priceAgorot)} נוספים.{" "}
            <a href={`${SITE_URL}/tracking/?id=${reportId}`} className="text-[#1D6F42] underline">
              מעבר לדוח מעקב בנייה ←
            </a>
          </p>
          {mainCost === 0 && undergroundCost === 0 && (
            <p className="mt-1 text-[#8a2f22]">
              זהו שלד ראשוני שבנה הסוכן החכם על סמך הפרטים שנמסרו: סוג העסקה ופילוח היחידות. עלויות הבנייה, מחירי המכירה ונתוני הקרקע עדיין לא הוזנו, יש להשלים אותם למטה כדי לקבל תוצאה אמיתית.
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-1">
            <strong className="text-[#123640]">גרסת בדיקה להתרשמות</strong> - אפשר להזין נתונים
            ולצפות בתוצאה מיד, ללא תשלום. הדוח המלא, כולל קישור קבוע לשמירה וחזרה, ייצוא ל-Excel
            והדפסה/PDF, מתקבל ברכישה דרך{" "}
            <a href="/dohefes/start/" className="text-[#1D6F42] underline">
              עמוד ההזמנה
            </a>
            .
          </p>
          <p className="text-xs text-gray-400 mb-6">
            עלויות הבנייה נטענות כברירת מחדל מאומדן לשכת שמאי המקרקעין, {CHAMBER_COST_DATE}. אפשר
            לשנות כל ערך.
          </p>
        </>
      )}

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
        {dealType === "pinuyBinui" && (
          <a
            href="/dohefes/ranking/"
            target="_blank"
            className="inline-block text-xs font-medium text-[#1D6F42] hover:underline mt-3"
          >
            כלי דירוג יחידות, לחישוב הפרש ערך בין דירות בבניין החדש ←
          </a>
        )}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">עלות בנייה למ&quot;ר עיקרי (₪)</span>
            <input
              type="number"
              value={mainCost}
              onChange={(e) => setMainCost(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          {supportsMixedCategories && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-gray-500 text-xs">עלות בנייה למ&quot;ר מגורים פרימיום (₪), ריק = כמו מגורים רגיל</span>
                <input
                  type="number"
                  value={premiumCost}
                  onChange={(e) => setPremiumCost(Number(e.target.value))}
                  className="border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
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
              <label className="flex flex-col gap-1">
                <span className="text-gray-500 text-xs">עלות בנייה למ&quot;ר מב&quot;צ (₪), ריק = כמו מגורים</span>
                <input
                  type="number"
                  value={publicBuildingCost}
                  onChange={(e) => setPublicBuildingCost(Number(e.target.value))}
                  className="border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
            </>
          )}
          {supportsReinforcement && (
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">
                עלות חיזוק שלד קיים למ&quot;ר (₪) <span className="text-gray-400">חיזוק ותוספת, לא הריסה ובנייה</span>
              </span>
              <input
                type="number"
                value={reinforcementCost}
                onChange={(e) => setReinforcementCost(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
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
        </div>

        <div className="mt-3">
          <div className="text-xs font-medium text-gray-600 mb-2">
            אגרות והיטלים עירוניים, ₪ למ&quot;ר <span className="text-gray-400">תלוי רשות מקומית, ריק = 0</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">אגרות בנייה, לשטח בנוי</span>
              <input
                type="number"
                value={buildingFeeRate}
                onChange={(e) => setBuildingFeeRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">דמי הקמה מים, לשטח בנוי</span>
              <input
                type="number"
                value={waterConnectionRate}
                onChange={(e) => setWaterConnectionRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">דמי הקמה ביוב, לשטח בנוי</span>
              <input
                type="number"
                value={sewageConnectionRate}
                onChange={(e) => setSewageConnectionRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">כביש/תיעול/מדרכות, לשטח מגרש</span>
              <input
                type="number"
                value={roadDrainagePlotRate}
                onChange={(e) => setRoadDrainagePlotRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">כביש/תיעול/מדרכות, לשטח בנוי</span>
              <input
                type="number"
                value={roadDrainageBuildingRate}
                onChange={(e) => setRoadDrainageBuildingRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">כביש/תיעול/מדרכות, לשטח מרתף</span>
              <input
                type="number"
                value={roadDrainageUndergroundRate}
                onChange={(e) => setRoadDrainageUndergroundRate(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
          </div>
        </div>

        <div className="mt-3">
          <div className="text-xs font-medium text-gray-600 mb-2">
            דמי שכירות לדיירים קיימים לתקופת הבנייה <span className="text-gray-400">כמעט תמיד רלוונטי בפינוי בינוי</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">מספר יחידות קיימות</span>
              <input
                type="number"
                value={relocationUnitsCount}
                onChange={(e) => setRelocationUnitsCount(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">משך התשלום (חודשים)</span>
              <input
                type="number"
                value={relocationMonths}
                onChange={(e) => setRelocationMonths(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">דמי שכירות חודשיים ליחידה (₪)</span>
              <input
                type="number"
                value={relocationRentPerUnit}
                onChange={(e) => setRelocationRentPerUnit(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
          </div>
          {relocationUnitsCount > 0 && relocationMonths > 0 && relocationRentPerUnit > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              סה&quot;כ: {(relocationUnitsCount * relocationMonths * relocationRentPerUnit).toLocaleString("he-IL")} ₪
            </p>
          )}
        </div>
      </section>

      {/* קרקע */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <div className="font-bold text-[#123640] mb-2 text-sm">קרקע</div>
        {isCashLandDeal(dealType) ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
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
        ) : usesUnitCompensation ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">אומדן שווי קרקע לצורך מס רכישה, חלק היזם בלבד (₪)</span>
              <input
                type="number"
                value={combinationLandValue}
                onChange={(e) => setCombinationLandValue(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">היטל השבחה (₪)</span>
              <input
                type="number"
                value={bettermentLevy}
                onChange={(e) => setBettermentLevy(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <p className="text-xs text-gray-400 sm:col-span-2">
              הדיירים הקיימים מקבלים דירות תמורה ספציפיות בחינם, לא אחוז מהפרויקט: סמנו אילו שורות
              בטבלת התמהיל למטה הן דירות תמורה (עמודת &quot;תמורה&quot;).
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">
                {dealType === "mixedUse" ? "אחוז החלוקה לבעלים הקיימים" : "אחוז הקומבינציה לבעל הקרקע"}
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
            <label className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">היטל השבחה (₪)</span>
              <input
                type="number"
                value={bettermentLevy}
                onChange={(e) => setBettermentLevy(Number(e.target.value))}
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
        <div className="overflow-x-auto max-w-full">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="text-gray-500 text-right">
                <th className="py-1 pl-2">טיפוס</th>
                {supportsMixedCategories && <th className="py-1 pl-2">קטגוריה</th>}
                {usesUnitCompensation && <th className="py-1 pl-2">תמורה</th>}
                {supportsReinforcement && <th className="py-1 pl-2">מבנה קיים</th>}
                <th className="py-1 pl-2">כמות</th>
                <th className="py-1 pl-2">שטח עיקרי</th>
                <th className="py-1 pl-2">ממ&quot;ד</th>
                <th className="py-1 pl-2">מרפסת</th>
                <th className="py-1 pl-2">מרפסת גג</th>
                <th className="py-1 pl-2">
                  {supportsMixedCategories ? "מחיר ליחידה (מגורים כולל מע\"מ, מסחר/משרדים נטו)" : "מחיר ליחידה כולל מע\"מ"}
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
                  {supportsMixedCategories && (
                    <td className="py-1 pl-2">
                      <select
                        value={u.category ?? "residential"}
                        onChange={(e) => updateUnit(i, { category: e.target.value as UnitType["category"] })}
                        aria-label={`קטגוריה, שורה ${i + 1}`}
                        className="border border-gray-200 rounded px-1 py-1"
                      >
                        <option value="residential">מגורים</option>
                        <option value="residentialPremium">מגורים פרימיום</option>
                        <option value="commercial">מסחר</option>
                        <option value="office">משרדים</option>
                        <option value="publicBuilding">מב&quot;צ (מבנה ציבור)</option>
                      </select>
                    </td>
                  )}
                  {usesUnitCompensation && (
                    <td className="py-1 pl-2 text-center">
                      <input
                        type="checkbox"
                        checked={u.isCompensationUnit ?? false}
                        onChange={(e) => updateUnit(i, { isCompensationUnit: e.target.checked })}
                        aria-label={`יחידת תמורה, שורה ${i + 1}`}
                      />
                    </td>
                  )}
                  {supportsReinforcement && (
                    <td className="py-1 pl-2 text-center">
                      <input
                        type="checkbox"
                        checked={u.isExistingStructure ?? false}
                        onChange={(e) => updateUnit(i, { isExistingStructure: e.target.checked })}
                        aria-label={`מבנה קיים המחוזק, שורה ${i + 1}`}
                      />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mt-3">
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
