"use client";

import { computeProject } from "@/lib/calc/engine";
import type { ProjectInputs } from "@/lib/calc/types";
import ReportView from "@/app/calculator/ReportView";
import Banner from "@/app/components/Banner";
import { downloadWorkbook } from "@/lib/report/exportExcel";
import { CATALOG, formatPriceNis } from "@/lib/catalog";

// דוגמה למסלול "חיזוק ותוספת" של תמ"א 38: המבנה הקיים לא נהרס, רק מתחזק הנדסית
// (הדיירים הקיימים משמרים את דירתם, בלי תמורה חדשה), ומעליו נבנות קומות תוספת שנמכרות בשוק החופשי.
const SAMPLE_INPUTS: ProjectInputs = {
  dealType: "tama38",
  projectName: 'רחוב ההגנה 24, רמת גן, דוגמה בלבד',
  units: [
    { name: "3 חדרים, מבנה קיים מחוזק", count: 16, areaSqm: 75, mamadSqm: 5, balconySqm: 0, roofBalconySqm: 0, priceNis: 0, isExistingStructure: true },
    { name: "4 חדרים, קומת תוספת חדשה", count: 8, areaSqm: 95, mamadSqm: 12, balconySqm: 12, roofBalconySqm: 0, priceNis: 3550000, category: "residential" },
    { name: "פנטהאוז, קומת גג חדשה", count: 2, areaSqm: 130, mamadSqm: 12, balconySqm: 14, roofBalconySqm: 40, priceNis: 5900000, category: "residentialPremium" },
  ],
  costs: {
    balconyWeight: 0.5,
    mainConstructionCostPerSqm: 8500,
    premiumConstructionCostPerSqm: 10200,
    commercialConstructionCostPerSqm: 0,
    officeConstructionCostPerSqm: 0,
    publicBuildingConstructionCostPerSqm: 0,
    reinforcementCostPerSqm: 3000,
    undergroundConstructionCostPerSqm: 4100,
    balconyConstructionCostRatio: 0.5,
    developmentCostPerSqm: 500,
    undergroundAreaSqm: 500,
    netPlotAreaSqm: 950,
    demolitionFlatNis: 0,
    municipalFees: {
      buildingFeeRatePerSqm: 200,
      waterConnectionRatePerSqm: 80,
      sewageConnectionRatePerSqm: 60,
      roadDrainagePlotRatePerSqm: 150,
      roadDrainageBuildingRatePerSqm: 180,
      roadDrainageUndergroundRatePerSqm: 90,
    },
    relocationUnitsCount: 16,
    relocationMonths: 14,
    relocationRentPerUnitMonthlyNis: 4500,
    brokerageRate: 0.01,
    purchaseTaxRate: 0.06,
    electricConnectionPerUnitNis: 4500,
    planningFlatNis: 30000,
    planningConsultantsRate: 0.025,
    engineeringInspectionFlatNis: 200000,
    marketingRate: 0.025,
    legalRate: 0.01,
    legalRefundPerUnitNis: -5000,
    financialSupervisionFlatNis: 220000,
    overheadRate: 0.025,
    managementFeeRate: 0.06,
    contingencyRate: 0.05,
    guaranteeCommissionRate: 0.0085,
    unusedCreditCommissionRate: 0.0035,
    accountOpeningCommissionRate: 0.0045,
    annualInterestRate: 0.04,
    constructionMonths: 16,
    permitMonths: 10,
    equityNis: 7500000,
    presaleRate: 0.15,
    organizerFeeNis: 0,
  },
  land: {
    landPurchaseNis: 0,
    bettermentLevyNis: 150000,
    combinationOwnerShare: 0,
    combinationLandValueForTaxNis: 3500000,
  },
};

export default function SamplePage() {
  const result = computeProject(SAMPLE_INPUTS);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="print:hidden mb-6">
        <Banner />
      </div>
      <div className="print:hidden mb-5 text-center">
        <h1 className="text-lg font-bold text-[#14502F] mb-1">דוגמת דוח אפס</h1>
        <p className="text-sm text-gray-500">
          נתונים לדוגמה בלבד, כדי להראות איך נראה הדוח שתקבלו. לא פרויקט אמיתי.
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
          href="/dohefes/start/"
          className="inline-block bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold px-6 py-3 rounded-lg transition-colors"
        >
          מעבר לרכישה ותשלום - {formatPriceNis(CATALOG.baseReport.priceAgorot)}
        </a>
      </div>
    </main>
  );
}
