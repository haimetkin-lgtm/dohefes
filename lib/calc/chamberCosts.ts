// אומדן עלויות בנייה, לשכת שמאי מקרקעין בישראל, יוני 2026.
// מקור: https://landvalue.org.il/loadedFiles/1783338676-KVFVS.pdf
// עלות למ"ר עילי, ₪, לא כולל מע"מ. סטייה מוערכת של כ-10%. הלשכה מעדכנת אחת ל-6 חודשים,
// כדאי לבדוק לפני שימוש ארוך טווח אם התפרסם אומדן חדש יותר.
//
// בניין נמוך: עד 13 מ' | בניין גבוה: עד 29 מ' | בניין רב קומות: מעל 29 מ'
// (ההפרש בין גובה מפלס הכניסה הקובעת למפלס הכניסה לקומה הגבוהה ביותר המיועדת למגורים)

export type BuildingHeight = "low" | "high" | "highrise";

export interface RegionCost {
  region: string;
  low: number;
  high: number;
  highrise: number;
  underground: number;
}

export const CHAMBER_COST_DATE = "יוני 2026";

export const CHAMBER_COSTS: RegionCost[] = [
  { region: "גולן, גליל עליון", low: 5400, high: 5300, highrise: 5800, underground: 3300 },
  { region: "חיפה", low: 5800, high: 5800, highrise: 6000, underground: 3400 },
  { region: "השרון", low: 6200, high: 6300, highrise: 6600, underground: 3400 },
  { region: "שומרון", low: 5000, high: 5200, highrise: 5600, underground: 3600 },
  { region: "סובב ירושלים (לרבות הר חומה ופסגת זאב)", low: 5900, high: 6300, highrise: 6600, underground: 3900 },
  { region: "ירושלים", low: 7000, high: 6900, highrise: 7700, underground: 4000 },
  { region: "רמת גן + גבעתיים", low: 6700, high: 7500, highrise: 7900, underground: 4100 },
  { region: "גוש דן (ללא הרצליה, ת\"א, רמת השרון, רמת גן, גבעתיים)", low: 6300, high: 6400, highrise: 6700, underground: 3600 },
  { region: "מרכז ת\"א", low: 12000, high: 11100, highrise: 12700, underground: 4400 },
  { region: "עבר הירקון ת\"א", low: 8300, high: 9100, highrise: 10600, underground: 4300 },
  { region: "דרום ומזרח ת\"א", low: 8000, high: 7700, highrise: 9000, underground: 4100 },
  { region: "הרצליה + רמת השרון", low: 7000, high: 7200, highrise: 7900, underground: 3900 },
  { region: "שפלת החוף", low: 6100, high: 6200, highrise: 6600, underground: 3600 },
  { region: "באר שבע והסביבה", low: 5400, high: 5400, highrise: 5900, underground: 3400 },
  { region: "אילת", low: 6800, high: 6800, highrise: 7100, underground: 3800 },
  { region: "מדבר יהודה, הערבה והנגב", low: 5200, high: 5500, highrise: 5700, underground: 3400 },
];

export function getChamberCost(region: string, height: BuildingHeight): number | null {
  const row = CHAMBER_COSTS.find((r) => r.region === region);
  if (!row) return null;
  return row[height];
}

export function getUndergroundCost(region: string): number | null {
  const row = CHAMBER_COSTS.find((r) => r.region === region);
  return row ? row.underground : null;
}
