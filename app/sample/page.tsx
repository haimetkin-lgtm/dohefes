"use client";

import { computeProject } from "@/lib/calc/engine";
import type { ProjectInputs } from "@/lib/calc/types";
import ReportView from "@/app/calculator/ReportView";

const SAMPLE_INPUTS: ProjectInputs = {
  dealType: "tama38",
  projectName: 'רחוב ההגנה 24, רמת גן, דוגמה בלבד',
  units: [
    { name: "3 חדרים", count: 6, areaSqm: 75, mamadSqm: 12, balconySqm: 12, roofBalconySqm: 0, priceNis: 2950000 },
    { name: "4 חדרים", count: 8, areaSqm: 95, mamadSqm: 12, balconySqm: 12, roofBalconySqm: 0, priceNis: 3550000 },
    { name: "5 חדרים", count: 4, areaSqm: 125, mamadSqm: 12, balconySqm: 14, roofBalconySqm: 0, priceNis: 4400000 },
    { name: "פנטהאוז", count: 2, areaSqm: 130, mamadSqm: 12, balconySqm: 14, roofBalconySqm: 40, priceNis: 5900000 },
  ],
  costs: {
    balconyWeight: 0.5,
    mainConstructionCostPerSqm: 7500,
    commercialConstructionCostPerSqm: 0,
    officeConstructionCostPerSqm: 0,
    undergroundConstructionCostPerSqm: 4100,
    balconyConstructionCostRatio: 0.5,
    developmentCostPerSqm: 500,
    undergroundAreaSqm: 1450,
    netPlotAreaSqm: 950,
    demolitionFlatNis: 320000,
    municipalFeesNis: 1650000,
    brokerageRate: 0.01,
    purchaseTaxRate: 0.06,
    electricConnectionPerUnitNis: 4500,
    planningFlatNis: 30000,
    engineeringSupervisionRate: 0.025,
    marketingRate: 0.025,
    legalRate: 0.01,
    legalRefundPerUnitNis: -5000,
    financialSupervisionFlatNis: 250000,
    overheadRate: 0.025,
    contingencyRate: 0.05,
    guaranteeCommissionRate: 0.0085,
    unusedCreditCommissionRate: 0.0035,
    annualInterestRate: 0.04,
    constructionMonths: 28,
    permitMonths: 12,
    equityNis: 8500000,
    presaleRate: 0.15,
    organizerFeeNis: 0,
  },
  land: {
    landPurchaseNis: 13500000,
    bettermentLevyNis: 180000,
    combinationOwnerShare: 0,
    combinationLandValueForTaxNis: 0,
  },
};

export default function SamplePage() {
  const result = computeProject(SAMPLE_INPUTS);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="print:hidden mb-5 text-center">
        <h1 className="text-lg font-bold text-[#14502F] mb-1">דוגמת דוח אפס</h1>
        <p className="text-sm text-gray-500">
          נתונים לדוגמה בלבד, כדי להראות איך נראה הדוח שתקבלו. לא פרויקט אמיתי.
        </p>
      </div>

      <ReportView inputs={SAMPLE_INPUTS} result={result} />

      <div className="print:hidden mt-6 text-center">
        <a
          href="/dohefes/start/"
          className="inline-block bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold px-6 py-3 rounded-lg transition-colors"
        >
          בניית דוח אפס לפרויקט שלי ←
        </a>
      </div>
    </main>
  );
}
