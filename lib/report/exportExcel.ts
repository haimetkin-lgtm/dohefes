import * as XLSX from "xlsx";
import { isCashLandDeal, profitToCostBenchmark } from "@/lib/calc/engine";
import type { ProjectInputs, ProjectResult } from "@/lib/calc/types";

const DEAL_TYPE_LABEL: Record<ProjectInputs["dealType"], string> = {
  basic: "דוח אפס בסיסי",
  tama38: 'תמ"א 38',
  pinuyBinui: "פינוי בינוי",
  kombinatsia: "קומבינציה בעין",
  kombinatsiaTemurot: "קומבינצית תמורות",
  purchaseGroup: "קבוצת רכישה",
  mixedUse: "מעורב מגורים ותעסוקה",
};

function round(n: number): number {
  return Math.round(n);
}

export function buildWorkbook(inputs: ProjectInputs, result: ProjectResult): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // גיליון 1: פרטי פרויקט
  const overviewRows: (string | number)[][] = [
    ["דוח אפס, טיוטת חישוב"],
    [],
    ["שם הפרויקט", inputs.projectName],
    ["סוג עסקה", DEAL_TYPE_LABEL[inputs.dealType]],
    ["תאריך הפקה", new Date().toLocaleDateString("he-IL")],
    [],
    ["כלי חישוב עזר בלבד. כל נתון שהוזן הוא באחריות המזין. אינו מהווה חוות דעת שמאית ואינו תחליף לבדיקת שמאי מקרקעין מוסמך."],
    ["ההכנסות והעלויות בדוח, לרבות ברווח לעלות, כולן לא כוללות מע\"מ (מתקזז ליזם רשום כדין ואינו משפיע על הרווח הכלכלי)."],
  ];
  const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
  wsOverview["!cols"] = [{ wch: 24 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsOverview, "פרטי פרויקט");

  // גיליון 2: תמהיל דירות
  const unitRows: (string | number)[][] = [
    ["טיפוס", "יחידת תמורה", "מבנה קיים", "כמות", "שטח עיקרי (מ\"ר)", "ממ\"ד (מ\"ר)", "מרפסת (מ\"ר)", "מרפסת גג (מ\"ר)", "מחיר ליחידה כולל מע\"מ (₪)"],
    ...inputs.units.map((u) => [
      u.name,
      u.isCompensationUnit ? "כן" : "",
      u.isExistingStructure ? "כן" : "",
      u.count,
      u.areaSqm,
      u.mamadSqm,
      u.balconySqm,
      u.roofBalconySqm,
      u.priceNis,
    ]),
  ];
  const wsUnits = XLSX.utils.aoa_to_sheet(unitRows);
  wsUnits["!cols"] = [{ wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsUnits, "תמהיל דירות");

  // גיליון 3: תוצאות
  const resultRows: (string | number)[][] = [
    ["שטחים"],
    ["שטח עיקרי (מ\"ר)", round(result.areas.totalMainAreaSqm)],
    ["ממ\"ד (מ\"ר)", round(result.areas.totalMamadSqm)],
    ["מרפסות (מ\"ר)", round(result.areas.totalBalconySqm)],
    ["מרפסות גג (מ\"ר)", round(result.areas.totalRoofBalconySqm)],
    ["שטח לשיווק (מ\"ר)", round(result.areas.totalMarketableAreaSqm)],
    ["יחידות דיור", result.areas.unitCount],
    [],
    ["הכנסות"],
    ["סה\"כ הכנסה כולל מע\"מ (₪)", round(result.revenue.totalRevenueInclVatNis)],
    ["סה\"כ הכנסה לא כולל מע\"מ (₪)", round(result.revenue.totalRevenueExclVatNis)],
    ["הכנסת היזם, לא כולל מע\"מ (₪)", round(result.revenue.developerRevenueExclVatNis)],
    ["מחיר ממוצע למ\"ר (₪)", round(result.revenue.averagePricePerSqmNis)],
    [],
    ["עלויות (לא כולל מע\"מ)"],
    [isCashLandDeal(inputs.dealType) ? "קרקע (₪)" : "היטל השבחה (₪)", round(result.costs.landNis)],
    ["עקיפות (₪)", round(result.costs.indirectNis)],
    ["עמלות מימון (₪)", round(result.costs.commissionsNis)],
    ["בנייה ישירה (₪)", round(result.costs.directConstructionNis)],
    ["מימון (₪)", round(result.costs.financingNis)],
    ["סה\"כ עלויות (₪)", round(result.costs.totalInclFinancingNis)],
    [],
    ["רווחיות"],
    ["רווח שוטף (₪)", round(result.profitability.currentProfitNis)],
    ["רווח לעלות (%)", Number((result.profitability.profitToCostRatio * 100).toFixed(1))],
    ...(profitToCostBenchmark(inputs.dealType) !== null
      ? [["סף מקובל בשוק, להשוואה (%)", Number((profitToCostBenchmark(inputs.dealType)! * 100).toFixed(1))]]
      : []),
    ["רווח למחזור (%)", Number((result.profitability.profitToRevenueRatio * 100).toFixed(1))],
    ...(result.profitability.cashOnCashAnnualRatio !== 0
      ? [["תשואה על ההון העצמי לשנה (%)", Number((result.profitability.cashOnCashAnnualRatio * 100).toFixed(1))]]
      : []),
    ...(result.feasibility.breakEven.averagePricePerSqmNis !== null || isCashLandDeal(inputs.dealType)
      ? [
          [],
          ["מדדי היתכנות (מדדי עזר, לא שומה)"],
          ...(result.feasibility.breakEven.averagePricePerSqmNis !== null
            ? [
                ["מחיר ממוצע למ\"ר בנקודת האיזון (₪)", round(result.feasibility.breakEven.averagePricePerSqmNis)],
                ["מרווח ביטחון בהכנסות (%)", Number((result.feasibility.breakEven.marginOfSafetyRatio! * 100).toFixed(1))],
              ]
            : []),
          ...(isCashLandDeal(inputs.dealType)
            ? [["שווי קרקע שיורי, ליעד רווח-לעלות מקובל (₪)", result.feasibility.residualLandValueNis !== null ? round(result.feasibility.residualLandValueNis) : "לא מושג בטווח סביר"]]
            : []),
        ]
      : []),
    [],
    ["ניתוח רגישות"],
    ["תרחיש", "רווח (₪)", "רווח לעלות (%)"],
    ...[
      { label: "לפי התחזית", revenueFactor: 1, costFactor: 1 },
      { label: "עלויות בנייה +10%", revenueFactor: 1, costFactor: 1.1 },
      { label: "הכנסות -10%", revenueFactor: 0.9, costFactor: 1 },
      { label: "עלויות בנייה +10%, הכנסות -10%", revenueFactor: 0.9, costFactor: 1.1 },
    ].map((scenario) => {
      const cell = result.feasibility.sensitivityMatrix.find(
        (c) => c.revenueFactor === scenario.revenueFactor && c.costFactor === scenario.costFactor
      )!;
      return [scenario.label, round(cell.profitNis), Number((cell.profitToCostRatio * 100).toFixed(1))];
    }),
    ...(result.unitAllocation.length > 0
      ? [
          [],
          ["בדיקת הקצאה והוגנות בין דיירים/שותפים"],
          ["טיפוס", "אחוז יחסי (%)", "עלות ליחידה (₪)", "שווי שוק ליחידה (₪)", "פער ליחידה (₪)", "יחס פער-לעלות (%)"],
          ...result.unitAllocation.map((row) => [
            row.name,
            Number((row.sharePercent * 100).toFixed(1)),
            round(row.costBasisPerUnitNis),
            round(row.marketValuePerUnitNis),
            round(row.gapPerUnitNis),
            Number((row.gapRatio * 100).toFixed(1)),
          ]),
        ]
      : []),
  ];
  const wsResults = XLSX.utils.aoa_to_sheet(resultRows);
  wsResults["!cols"] = [{ wch: 30 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsResults, "תוצאות");

  return wb;
}

export function downloadWorkbook(inputs: ProjectInputs, result: ProjectResult) {
  const wb = buildWorkbook(inputs, result);
  const fileName = `דוח-אפס-${inputs.projectName || "פרויקט"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
