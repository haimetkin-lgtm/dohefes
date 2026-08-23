import * as XLSX from "xlsx";
import type { ProjectInputs, ProjectResult } from "@/lib/calc/types";

const DEAL_TYPE_LABEL: Record<ProjectInputs["dealType"], string> = {
  tama38: 'תמ"א 38',
  kombinatsia: "קומבינציה בעין",
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
  ];
  const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
  wsOverview["!cols"] = [{ wch: 24 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsOverview, "פרטי פרויקט");

  // גיליון 2: תמהיל דירות
  const unitRows: (string | number)[][] = [
    ["טיפוס", "כמות", "שטח עיקרי (מ\"ר)", "ממ\"ד (מ\"ר)", "מרפסת (מ\"ר)", "מרפסת גג (מ\"ר)", "מחיר ליחידה כולל מע\"מ (₪)"],
    ...inputs.units.map((u) => [u.name, u.count, u.areaSqm, u.mamadSqm, u.balconySqm, u.roofBalconySqm, u.priceNis]),
  ];
  const wsUnits = XLSX.utils.aoa_to_sheet(unitRows);
  wsUnits["!cols"] = [{ wch: 20 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 18 }];
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
    ["עלויות"],
    ["קרקע (₪)", round(result.costs.landNis)],
    ["עקיפות (₪)", round(result.costs.indirectNis)],
    ["עמלות מימון (₪)", round(result.costs.commissionsNis)],
    ["בנייה ישירה (₪)", round(result.costs.directConstructionNis)],
    ["מימון (₪)", round(result.costs.financingNis)],
    ["סה\"כ עלויות (₪)", round(result.costs.totalInclFinancingNis)],
    [],
    ["רווחיות"],
    ["רווח שוטף (₪)", round(result.profitability.currentProfitNis)],
    ["רווח לעלות (%)", Number((result.profitability.profitToCostRatio * 100).toFixed(1))],
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
