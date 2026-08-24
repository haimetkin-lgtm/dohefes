import * as XLSX from "xlsx";

interface Criterion {
  id: string;
  name: string;
}

interface UnitRow {
  id: string;
  name: string;
  basePriceNis: number;
  coefficients: Record<string, number>;
}

function total(unit: UnitRow, criteria: Criterion[]): number {
  return criteria.reduce((acc, c) => acc * (unit.coefficients[c.id] ?? 1), 1);
}

function round(n: number): number {
  return Math.round(n);
}

function unitsSheet(units: UnitRow[], criteria: Criterion[]): (string | number)[][] {
  return [
    ["יחידה", ...criteria.map((c) => c.name || "קריטריון"), "מחיר בסיס (₪)", "מקדם כולל", "מחיר מתואם (₪)"],
    ...units.map((u) => {
      const t = total(u, criteria);
      return [u.name, ...criteria.map((c) => u.coefficients[c.id] ?? 1), round(u.basePriceNis), Number(t.toFixed(3)), round(u.basePriceNis * t)];
    }),
  ];
}

export function buildRankingWorkbook(
  criteria: Criterion[],
  oldUnits: UnitRow[],
  newUnits: UnitRow[],
  choices: Record<string, string>
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const wsOld = XLSX.utils.aoa_to_sheet(unitsSheet(oldUnits, criteria));
  wsOld["!cols"] = [{ wch: 20 }, ...criteria.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsOld, "דירות ישנות");

  const wsNew = XLSX.utils.aoa_to_sheet(unitsSheet(newUnits, criteria));
  wsNew["!cols"] = [{ wch: 20 }, ...criteria.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsNew, "דירות חדשות");

  const newUnitsById = new Map(newUnits.map((u) => [u.id, u]));
  const oldRanked = [...oldUnits]
    .map((u) => ({ unit: u, t: total(u, criteria) }))
    .sort((a, b) => b.t - a.t);

  const orderRows: (string | number)[][] = [
    ["תור", "דירה ישנה", "מקדם ישן", "דירה חדשה שנבחרה", "מקדם חדש", "פער מקדם", "פער ערך (₪)"],
    ...oldRanked.map(({ unit, t }, i) => {
      const chosenId = choices[unit.id];
      const chosenUnit = chosenId ? newUnitsById.get(chosenId) : undefined;
      const chosenTotal = chosenUnit ? total(chosenUnit, criteria) : null;
      const coefGap = chosenTotal !== null ? chosenTotal - t : "";
      const valueGap =
        chosenTotal !== null && chosenUnit ? round(chosenUnit.basePriceNis * chosenTotal - unit.basePriceNis * t) : "";
      return [
        i + 1,
        unit.name,
        Number(t.toFixed(3)),
        chosenUnit ? chosenUnit.name : "טרם נבחר",
        chosenTotal !== null ? Number(chosenTotal.toFixed(3)) : "",
        typeof coefGap === "number" ? Number(coefGap.toFixed(3)) : "",
        valueGap,
      ];
    }),
  ];
  const wsOrder = XLSX.utils.aoa_to_sheet(orderRows);
  wsOrder["!cols"] = [{ wch: 6 }, { wch: 20 }, { wch: 10 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsOrder, "סדר בחירה ופער ערך");

  return wb;
}

export function downloadRankingWorkbook(
  criteria: Criterion[],
  oldUnits: UnitRow[],
  newUnits: UnitRow[],
  choices: Record<string, string>
) {
  const wb = buildRankingWorkbook(criteria, oldUnits, newUnits, choices);
  XLSX.writeFile(wb, `דירוג-יחידות-פינוי-בינוי-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
