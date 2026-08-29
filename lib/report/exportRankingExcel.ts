import * as XLSX from "xlsx";
import { calculateValueGap, rankUnits, totalCoefficient, type RankingCriterion, type RankingUnit } from "../ranking";

function round(n: number): number {
  return Math.round(n);
}

function unitsSheet(units: RankingUnit[], criteria: RankingCriterion[]): (string | number)[][] {
  return [
    ["יחידה", ...criteria.map((c) => c.name || "קריטריון"), "מחיר בסיס (₪)", "מקדם כולל", "מחיר מתואם (₪)"],
    ...units.map((u) => {
      const t = totalCoefficient(u, criteria);
      return [u.name, ...criteria.map((c) => u.coefficients[c.id] ?? 1), round(u.basePriceNis), Number(t.toFixed(3)), round(u.basePriceNis * t)];
    }),
  ];
}

export function buildRankingWorkbook(
  criteria: RankingCriterion[],
  oldUnits: RankingUnit[],
  newUnits: RankingUnit[],
  choices: Record<string, string>
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const wsMethod = XLSX.utils.aoa_to_sheet([
    ["קריטריון", "משקל", "משמעות"],
    ...criteria.map((criterion) => [criterion.name || "קריטריון", criterion.weight, "תרומה = מקדם בחזקת המשקל"]),
    [],
    ["שיטה", "מקדם כולל = מכפלת תרומות הקריטריונים. משקל 1 שומר על המקדם במלואו; משקל 0 מנטרל אותו."],
  ]);
  wsMethod["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 54 }];
  XLSX.utils.book_append_sheet(wb, wsMethod, "שיטה ומשקלים");

  const wsOld = XLSX.utils.aoa_to_sheet(unitsSheet(oldUnits, criteria));
  wsOld["!cols"] = [{ wch: 20 }, ...criteria.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsOld, "דירות ישנות");

  const wsNew = XLSX.utils.aoa_to_sheet(unitsSheet(newUnits, criteria));
  wsNew["!cols"] = [{ wch: 20 }, ...criteria.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsNew, "דירות חדשות");

  const newUnitsById = new Map(newUnits.map((u) => [u.id, u]));
  const oldRanked = rankUnits(oldUnits, criteria);

  const orderRows: (string | number)[][] = [
    ["תור", "תיקו", "דירה ישנה", "מקדם ישן", "דירה חדשה שנבחרה", "מקדם חדש", "פער מקדם", "פער מקדם (%)", "פער מחיר בסיס (₪)", "ערך ישן מתואם (₪)", "ערך חדש מתואם (₪)", "פער ערך (₪)"],
    ...oldRanked.map(({ unit, coefficient, rank, tie }) => {
      const chosenId = choices[unit.id];
      const chosenUnit = chosenId ? newUnitsById.get(chosenId) : undefined;
      const gap = chosenUnit ? calculateValueGap(unit, chosenUnit, criteria) : null;
      const chosenTotal = chosenUnit ? totalCoefficient(chosenUnit, criteria) : null;
      return [
        rank,
        tie ? "נדרשת הגרלה" : "",
        unit.name,
        Number(coefficient.toFixed(3)),
        chosenUnit ? chosenUnit.name : "טרם נבחר",
        chosenTotal !== null ? Number(chosenTotal.toFixed(3)) : "",
        gap ? Number(gap.coefficientGap.toFixed(3)) : "",
        gap ? Number((gap.coefficientGapPercent * 100).toFixed(2)) : "",
        gap ? round(gap.basePriceGapNis) : "",
        gap ? round(gap.oldAdjustedValueNis) : "",
        gap ? round(gap.newAdjustedValueNis) : "",
        gap ? round(gap.valueGapNis) : "",
      ];
    }),
  ];
  const wsOrder = XLSX.utils.aoa_to_sheet(orderRows);
  wsOrder["!cols"] = [{ wch: 6 }, { wch: 16 }, { wch: 20 }, { wch: 10 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsOrder, "סדר בחירה ופער ערך");

  return wb;
}

export function downloadRankingWorkbook(
  criteria: RankingCriterion[],
  oldUnits: RankingUnit[],
  newUnits: RankingUnit[],
  choices: Record<string, string>
) {
  const wb = buildRankingWorkbook(criteria, oldUnits, newUnits, choices);
  XLSX.writeFile(wb, `דירוג-יחידות-פינוי-בינוי-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
