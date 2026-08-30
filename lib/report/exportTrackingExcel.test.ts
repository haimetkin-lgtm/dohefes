import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { TrackingItem } from "../tracking/types";
import { buildTrackingWorkbook } from "./exportTrackingExcel";

const ITEMS: TrackingItem[] = [
  { id: "a", phase: "ביסוס", description: "כלונסאות", quantity: 10, unitPriceNis: 1_000, actualNis: 8_000 },
  { id: "b", phase: "ביסוס", description: "חפירה", quantity: 1, unitPriceNis: 5_000, actualNis: 6_000 },
  { id: "c", phase: "שלד", description: "בטון", quantity: 2, unitPriceNis: 10_000, actualNis: 22_000 },
];

describe("ייצוא דוח מעקב ל-Excel", () => {
  it("שומר פירוט, חריגות וסיכומי שלבים גם לאחר כתיבה וקריאה של XLSX", () => {
    const workbook = buildTrackingWorkbook("פרויקט בדיקה", ITEMS);
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const reread = XLSX.read(bytes, { type: "buffer" });
    expect(reread.SheetNames).toEqual(["מעקב בנייה"]);
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(reread.Sheets["מעקב בנייה"], { header: 1 });
    expect(rows.some((row) => row[1] === "חפירה" && row[4] === 5_000 && row[5] === 6_000 && row[7] === -1_000)).toBe(true);
    expect(rows.some((row) => row[0] === "ביסוס" && row[1] === 15_000 && row[2] === 14_000 && row[3] === 1_000)).toBe(true);
    expect(rows.some((row) => row[0] === "סה\"כ תקציב (₪)" && row[1] === 35_000)).toBe(true);
    expect(rows.some((row) => row[0] === "סה\"כ בוצע (₪)" && row[1] === 36_000)).toBe(true);
    expect(rows.some((row) => row[0] === "יתרה לביצוע (₪)" && row[1] === -1_000)).toBe(true);
  });

  it("מפיק דוח ריק תקין ללא NaN או Infinity", () => {
    const workbook = buildTrackingWorkbook("", []);
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["מעקב בנייה"], { header: 1 });
    expect(rows.flat().some((value) => typeof value === "number" && !Number.isFinite(value))).toBe(false);
    expect(rows.some((row) => row[0] === "% ביצוע כולל" && row[1] === 0)).toBe(true);
  });
});
