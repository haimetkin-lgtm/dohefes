"use client";

import { useState } from "react";

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

const DEFAULT_CRITERIA: Criterion[] = [
  { id: "floor", name: "קומה" },
  { id: "aspect", name: "כיוון אוויר ומספר חזיתות" },
  { id: "view", name: "נוף" },
  { id: "elevator", name: "מרחק ממעלית/מבואה" },
  { id: "attachments", name: "הצמדות (חניה/מחסן/גינה)" },
];

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function makeUnit(name: string, criteria: Criterion[]): UnitRow {
  const coefficients: Record<string, number> = {};
  criteria.forEach((c) => (coefficients[c.id] = 1));
  return { id: nextId("unit"), name, basePriceNis: 0, coefficients };
}

function totalCoefficient(unit: UnitRow, criteria: Criterion[]): number {
  return criteria.reduce((acc, c) => acc * (unit.coefficients[c.id] ?? 1), 1);
}

function nis(n: number): string {
  return Math.round(n).toLocaleString("he-IL") + " ₪";
}

export default function RankingPage() {
  const [criteria, setCriteria] = useState<Criterion[]>(DEFAULT_CRITERIA);
  const [units, setUnits] = useState<UnitRow[]>(() => [
    makeUnit("דירה 1", DEFAULT_CRITERIA),
    makeUnit("דירה 2", DEFAULT_CRITERIA),
  ]);

  function addCriterion() {
    const c = { id: nextId("crit"), name: "" };
    setCriteria((prev) => [...prev, c]);
    setUnits((prev) => prev.map((u) => ({ ...u, coefficients: { ...u.coefficients, [c.id]: 1 } })));
  }

  function removeCriterion(id: string) {
    setCriteria((prev) => prev.filter((c) => c.id !== id));
    setUnits((prev) =>
      prev.map((u) => {
        const { [id]: _removed, ...rest } = u.coefficients;
        return { ...u, coefficients: rest };
      })
    );
  }

  function renameCriterion(id: string, name: string) {
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  function addUnit() {
    setUnits((prev) => [...prev, makeUnit(`דירה ${prev.length + 1}`, criteria)]);
  }

  function removeUnit(id: string) {
    setUnits((prev) => prev.filter((u) => u.id !== id));
  }

  function updateUnit(id: string, patch: Partial<UnitRow>) {
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  function updateCoefficient(unitId: string, critId: string, value: number) {
    setUnits((prev) =>
      prev.map((u) => (u.id === unitId ? { ...u, coefficients: { ...u.coefficients, [critId]: value } } : u))
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">כלי דירוג יחידות</h1>
      <p className="text-sm text-gray-500 mb-6">
        לשימוש בפרויקטי פינוי בינוי (ותמ&quot;א 38/קומבינציה במידת הצורך), לחישוב הפרש ערך יחסי בין
        דירות בבניין החדש.
      </p>

      <section className="bg-[#EAF3EC] border border-[#BFE0CC] rounded-xl p-5 mb-8 text-sm text-gray-700 leading-relaxed">
        <div className="font-bold text-[#14502F] mb-2">שיטת החישוב</div>
        <p className="mb-2">
          לכל קריטריון (קומה, נוף, כיוון אוויר וכו&apos;) נקבע לכל יחידה <b>מקדם התאמה סביב 1.0</b>:
          בדיוק 1 = ניטרלי (ביחס ליחידה בסיסית/ממוצעת), מעל 1 = משביח (למשל 1.08 = נוף שמוסיף כ-8%
          לערך), מתחת ל-1 = פוגם (למשל 0.95 = קרבה לכביש סואן).
        </p>
        <p className="mb-2">
          <b>המקדם הכולל של יחידה הוא מכפלת כל המקדמים שלה</b> (לא סכום), והוא מכפיל את מחיר/שווי
          הבסיס של אותה יחידה.
        </p>
        <p>
          אין טווחים סטנדרטיים מחייבים לאחוזי ההתאמה בשמאות מקרקעין, כל פרויקט נבדק לגופו לפי שיקול
          דעת מקצועי. הרשימה למטה היא ברירת מחדל נפוצה, ניתנת לעריכה מלאה: אפשר לשנות שם קריטריון,
          למחוק, ולהוסיף קריטריונים משלכם.
        </p>
      </section>

      <section className="mb-4 flex items-center justify-between">
        <h2 className="font-bold text-[#123640] text-sm">קריטריונים</h2>
        <button onClick={addCriterion} className="text-xs font-medium text-[#1D6F42] hover:underline">
          + הוספת קריטריון
        </button>
      </section>

      <div className="overflow-x-auto rounded-lg border border-gray-200 mb-8">
        <table className="w-full text-xs border-collapse min-w-[700px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              <th className="text-right py-2 px-2 sticky right-0 bg-gray-50">יחידה</th>
              {criteria.map((c) => (
                <th key={c.id} className="text-right py-2 px-2 min-w-[140px]">
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) => renameCriterion(c.id, e.target.value)}
                      placeholder="שם קריטריון"
                      aria-label={`שם קריטריון: ${c.name || "ללא שם"}`}
                      className="w-full border border-gray-200 rounded px-2 py-1 bg-white font-normal"
                    />
                    <button
                      onClick={() => removeCriterion(c.id)}
                      className="text-gray-400 hover:text-red-500 px-1"
                      aria-label={`מחיקת קריטריון ${c.name || "ללא שם"}`}
                    >
                      ✕
                    </button>
                  </div>
                </th>
              ))}
              <th className="text-right py-2 px-2 min-w-[110px]">מחיר בסיס (₪)</th>
              <th className="text-right py-2 px-2 min-w-[90px]">מקדם כולל</th>
              <th className="text-right py-2 px-2 min-w-[110px]">מחיר מתואם</th>
              <th className="py-2 px-1" />
            </tr>
          </thead>
          <tbody>
            {units.map((u, i) => {
              const total = totalCoefficient(u, criteria);
              return (
                <tr key={u.id} className="border-t border-gray-100 tabular-nums">
                  <td className="py-1.5 px-2 sticky right-0 bg-white">
                    <input
                      type="text"
                      value={u.name}
                      onChange={(e) => updateUnit(u.id, { name: e.target.value })}
                      aria-label={`שם יחידה, שורה ${i + 1}`}
                      className="w-24 border border-gray-200 rounded px-2 py-1"
                    />
                  </td>
                  {criteria.map((c) => (
                    <td key={c.id} className="py-1.5 px-2">
                      <input
                        type="number"
                        step="0.01"
                        value={u.coefficients[c.id] ?? 1}
                        onChange={(e) => updateCoefficient(u.id, c.id, Number(e.target.value))}
                        aria-label={`מקדם ${c.name || "קריטריון"}, שורה ${i + 1}`}
                        className="w-20 border border-gray-200 rounded px-2 py-1"
                      />
                    </td>
                  ))}
                  <td className="py-1.5 px-2">
                    <input
                      type="number"
                      value={u.basePriceNis}
                      onChange={(e) => updateUnit(u.id, { basePriceNis: Number(e.target.value) })}
                      aria-label={`מחיר בסיס, שורה ${i + 1}`}
                      className="w-24 border border-gray-200 rounded px-2 py-1"
                    />
                  </td>
                  <td className="py-1.5 px-2 font-medium text-[#14502F]">{total.toFixed(3)}</td>
                  <td className="py-1.5 px-2 font-medium text-[#14502F]">
                    {u.basePriceNis > 0 ? nis(u.basePriceNis * total) : "-"}
                  </td>
                  <td className="py-1.5 px-1">
                    <button
                      onClick={() => removeUnit(u.id)}
                      className="text-gray-400 hover:text-red-500 px-1"
                      aria-label="מחיקת יחידה"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button onClick={addUnit} className="text-xs font-medium text-[#1D6F42] hover:underline mb-8">
        + הוספת יחידה
      </button>

      <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-4">
        כלי חישוב עזר בלבד, לשימוש שמאי מקרקעין מוסמך בלבד. המקדמים המוזנים הם באחריות המזין, ואינם
        המלצה שמאית. אינו מהווה חוות דעת שמאית ואינו תחליף לבדיקת שמאי מקרקעין מוסמך.
      </p>
    </main>
  );
}
