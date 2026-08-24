"use client";

import { computeProject } from "@/lib/calc/engine";
import type { ProjectInputs } from "@/lib/calc/types";
import ReportView from "@/app/calculator/ReportView";
import Banner from "@/app/components/Banner";
import { downloadWorkbook } from "@/lib/report/exportExcel";
import { CUSTOM_PRICE_NIS } from "@/lib/supabase";

// דוגמה למסלול "בהתאמה אישית": פרויקט פינוי בינוי מורכב עם שילוב שימושים,
// בדיוק כדי להראות שהמנוע מתמודד גם עם פרויקט הרבה יותר מסובך מדוח בסיסי:
// כמה סוגי דירות (כולל פנטהאוזים יוקרתיים), מסחר בקומת קרקע, קומות משרדים,
// ומסעדת גג. הנתונים בדויים לחלוטין, לצורך המחשה בלבד.
const SAMPLE_INPUTS: ProjectInputs = {
  dealType: "pinuyBinui",
  projectName: "מתחם 'אקורד הפארק', דוגמה בלבד",
  units: [
    { name: "דירת 3 חדרים, תמורה לדיירים קיימים", count: 60, areaSqm: 78, mamadSqm: 5, balconySqm: 10, roofBalconySqm: 0, priceNis: 3100000, category: "residential" },
    { name: "דירת 4 חדרים פרימיום", count: 50, areaSqm: 105, mamadSqm: 6, balconySqm: 12, roofBalconySqm: 0, priceNis: 4200000, category: "residential" },
    { name: "פנטהאוז דופלקס יוקרה", count: 8, areaSqm: 160, mamadSqm: 8, balconySqm: 20, roofBalconySqm: 60, priceNis: 8900000, category: "residential" },
    { name: "חנות מסחר, קומת קרקע", count: 12, areaSqm: 60, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0, priceNis: 1400000, category: "commercial" },
    { name: "משרד, קומות תעסוקה", count: 20, areaSqm: 90, mamadSqm: 0, balconySqm: 6, roofBalconySqm: 0, priceNis: 1650000, category: "office" },
    { name: "מסעדת גג יוקרתית", count: 1, areaSqm: 450, mamadSqm: 0, balconySqm: 120, roofBalconySqm: 0, priceNis: 9500000, category: "commercial" },
  ],
  costs: {
    balconyWeight: 0.5,
    mainConstructionCostPerSqm: 9500,
    commercialConstructionCostPerSqm: 6200,
    officeConstructionCostPerSqm: 7100,
    undergroundConstructionCostPerSqm: 4300,
    balconyConstructionCostRatio: 0.5,
    developmentCostPerSqm: 650,
    undergroundAreaSqm: 8500,
    netPlotAreaSqm: 4200,
    demolitionFlatNis: 2800000,
    municipalFeesNis: 4200000,
    brokerageRate: 0.01,
    purchaseTaxRate: 0.06,
    electricConnectionPerUnitNis: 4500,
    planningFlatNis: 30000,
    planningConsultantsRate: 0.025,
    engineeringInspectionFlatNis: 950000,
    marketingRate: 0.025,
    legalRate: 0.01,
    legalRefundPerUnitNis: -5000,
    financialSupervisionFlatNis: 250000,
    overheadRate: 0.025,
    managementFeeRate: 0.06,
    contingencyRate: 0.05,
    guaranteeCommissionRate: 0.0085,
    unusedCreditCommissionRate: 0.0035,
    annualInterestRate: 0.04,
    constructionMonths: 42,
    permitMonths: 16,
    equityNis: 48000000,
    presaleRate: 0.15,
    organizerFeeNis: 0,
  },
  land: {
    landPurchaseNis: 0,
    bettermentLevyNis: 0,
    combinationOwnerShare: 0.42,
    combinationLandValueForTaxNis: 58000000,
  },
};

export default function CustomSamplePage() {
  const result = computeProject(SAMPLE_INPUTS);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="print:hidden mb-6">
        <Banner />
      </div>
      <div className="print:hidden mb-5 text-center">
        <h1 className="text-lg font-bold text-[#14502F] mb-1">דוגמת דוח אפס, מסלול בהתאמה אישית</h1>
        <p className="text-sm text-gray-500 max-w-xl mx-auto">
          נתונים בדויים לחלוטין, לצורך המחשה בלבד. פרויקט פינוי בינוי מורכב, עם שילוב שימושים: דירות תמורה
          לדיירים קיימים, דירות פרימיום ופנטהאוזים בסטנדרט בנייה גבוה, מסחר בקומת קרקע, קומות משרדים,
          ומסעדת גג. בדיוק סוג הפרויקט שמתאים למסלול הזה, שבו הסוכן החכם בונה עבורכם שלד כזה מתוך תיאור
          חופשי ותוכניות, ואתם משלימים את הנתונים הכספיים.
        </p>
      </div>

      <ReportView inputs={SAMPLE_INPUTS} result={result} />

      <div className="print:hidden flex flex-col sm:flex-row gap-2 mt-4">
        <button
          onClick={() => downloadWorkbook(SAMPLE_INPUTS, result)}
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

      <div className="print:hidden mt-6 text-center">
        <a
          href="/dohefes/custom/"
          className="inline-block bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold px-6 py-3 rounded-lg transition-colors"
        >
          מעבר לרכישה ותשלום - {CUSTOM_PRICE_NIS.toLocaleString("he-IL")} ₪
        </a>
      </div>
    </main>
  );
}
