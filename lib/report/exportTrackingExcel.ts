import * as XLSX from "xlsx";
import type { TrackingItem } from "@/lib/tracking/types";
import { computeTrackingTotals, itemBudgetNis } from "@/lib/tracking/types";

function round(n: number): number {
  return Math.round(n);
}

export function buildTrackingWorkbook(projectName: string, items: TrackingItem[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const totals = computeTrackingTotals(items);

  const rows: (string | number)[][] = [
    ["דוח מעקב בנייה, תקציב מול ביצוע"],
    [],
    ["שם הפרויקט", projectName || ""],
    ["תאריך הפקה", new Date().toLocaleDateString("he-IL")],
    [],
    ["כלי חישוב עזר בלבד. כל נתון שהוזן הוא באחריות המזין. אינו מהווה חוות דעת שמאית ואינו תחליף לבדיקת שמאי מקרקעין מוסמך."],
    [],
    ["שלב", "תיאור", "כמות", "מחיר יחידה (₪)", "תקציב (₪)", "בוצע (₪)", "% ביצוע", "יתרה (₪)"],
  ];

  for (const item of items) {
    const budget = itemBudgetNis(item);
    const remaining = budget - item.actualNis;
    const percent = budget !== 0 ? item.actualNis / budget : 0;
    rows.push([
      item.phase || "ללא שלב",
      item.description,
      item.quantity,
      round(item.unitPriceNis),
      round(budget),
      round(item.actualNis),
      Number((percent * 100).toFixed(1)),
      round(remaining),
    ]);
  }

  rows.push([]);
  rows.push(["סיכום לפי שלב"]);
  rows.push(["שלב", "תקציב (₪)", "בוצע (₪)", "יתרה (₪)", "% ביצוע"]);
  for (const p of totals.byPhase) {
    rows.push([p.phase, round(p.budgetNis), round(p.actualNis), round(p.remainingNis), Number((p.percentComplete * 100).toFixed(1))]);
  }

  rows.push([]);
  rows.push(["סה\"כ תקציב (₪)", round(totals.budgetNis)]);
  rows.push(["סה\"כ בוצע (₪)", round(totals.actualNis)]);
  rows.push(["יתרה לביצוע (₪)", round(totals.remainingNis)]);
  rows.push(["% ביצוע כולל", Number((totals.percentComplete * 100).toFixed(1))]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 22 }, { wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, "מעקב בנייה");

  return wb;
}

export function downloadTrackingWorkbook(projectName: string, items: TrackingItem[]) {
  const wb = buildTrackingWorkbook(projectName, items);
  const fileName = `דוח-מעקב-${projectName || "פרויקט"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
