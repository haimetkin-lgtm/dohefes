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

function UnitGroupTable({
  title,
  addLabel,
  units,
  criteria,
  onAddUnit,
  onRemoveUnit,
  onUpdateUnit,
  onUpdateCoefficient,
}: {
  title: string;
  addLabel: string;
  units: UnitRow[];
  criteria: Criterion[];
  onAddUnit: () => void;
  onRemoveUnit: (id: string) => void;
  onUpdateUnit: (id: string, patch: Partial<UnitRow>) => void;
  onUpdateCoefficient: (unitId: string, critId: string, value: number) => void;
}) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-[#123640] text-sm">{title}</h2>
        <button onClick={onAddUnit} className="text-xs font-medium text-[#1D6F42] hover:underline">
          {addLabel}
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs border-collapse min-w-[700px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              <th className="text-right py-2 px-2 sticky right-0 bg-gray-50">יחידה</th>
              {criteria.map((c) => (
                <th key={c.id} className="text-right py-2 px-2 min-w-[110px]">
                  {c.name || "קריטריון"}
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
                      onChange={(e) => onUpdateUnit(u.id, { name: e.target.value })}
                      aria-label={`שם יחידה, ${title}, שורה ${i + 1}`}
                      className="w-24 border border-gray-200 rounded px-2 py-1"
                    />
                  </td>
                  {criteria.map((c) => (
                    <td key={c.id} className="py-1.5 px-2">
                      <input
                        type="number"
                        step="0.01"
                        value={u.coefficients[c.id] ?? 1}
                        onChange={(e) => onUpdateCoefficient(u.id, c.id, Number(e.target.value))}
                        aria-label={`מקדם ${c.name || "קריטריון"}, ${title}, שורה ${i + 1}`}
                        className="w-20 border border-gray-200 rounded px-2 py-1"
                      />
                    </td>
                  ))}
                  <td className="py-1.5 px-2">
                    <input
                      type="number"
                      value={u.basePriceNis}
                      onChange={(e) => onUpdateUnit(u.id, { basePriceNis: Number(e.target.value) })}
                      aria-label={`מחיר בסיס, ${title}, שורה ${i + 1}`}
                      className="w-24 border border-gray-200 rounded px-2 py-1"
                    />
                  </td>
                  <td className="py-1.5 px-2 font-medium text-[#14502F]">{total.toFixed(3)}</td>
                  <td className="py-1.5 px-2 font-medium text-[#14502F]">
                    {u.basePriceNis > 0 ? nis(u.basePriceNis * total) : "-"}
                  </td>
                  <td className="py-1.5 px-1">
                    <button
                      onClick={() => onRemoveUnit(u.id)}
                      className="text-gray-400 hover:text-red-500 px-1"
                      aria-label={`מחיקת יחידה, ${title}`}
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
    </section>
  );
}

export default function RankingPage() {
  const [criteria, setCriteria] = useState<Criterion[]>(DEFAULT_CRITERIA);
  const [oldUnits, setOldUnits] = useState<UnitRow[]>(() => [
    makeUnit("דירה ישנה 1", DEFAULT_CRITERIA),
    makeUnit("דירה ישנה 2", DEFAULT_CRITERIA),
  ]);
  const [newUnits, setNewUnits] = useState<UnitRow[]>(() => [
    makeUnit("דירה חדשה 1", DEFAULT_CRITERIA),
    makeUnit("דירה חדשה 2", DEFAULT_CRITERIA),
  ]);
  // עבור כל דירה ישנה: מזהה הדירה החדשה שהדייר בפועל בחר (נבחר ידנית, לא משויך אוטומטית)
  const [choices, setChoices] = useState<Record<string, string>>({});

  function addCriterion() {
    const c = { id: nextId("crit"), name: "" };
    setCriteria((prev) => [...prev, c]);
    const withCoef = (list: UnitRow[]) =>
      list.map((u) => ({ ...u, coefficients: { ...u.coefficients, [c.id]: 1 } }));
    setOldUnits(withCoef);
    setNewUnits(withCoef);
  }

  function removeCriterion(id: string) {
    setCriteria((prev) => prev.filter((c) => c.id !== id));
    const stripCoef = (list: UnitRow[]) =>
      list.map((u) => {
        const { [id]: _removed, ...rest } = u.coefficients;
        return { ...u, coefficients: rest };
      });
    setOldUnits(stripCoef);
    setNewUnits(stripCoef);
  }

  function renameCriterion(id: string, name: string) {
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  function makeGroupHandlers(setUnits: React.Dispatch<React.SetStateAction<UnitRow[]>>, labelPrefix: string) {
    return {
      add: () => setUnits((prev) => [...prev, makeUnit(`${labelPrefix} ${prev.length + 1}`, criteria)]),
      remove: (id: string) => setUnits((prev) => prev.filter((u) => u.id !== id)),
      update: (id: string, patch: Partial<UnitRow>) =>
        setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u))),
      updateCoef: (unitId: string, critId: string, value: number) =>
        setUnits((prev) =>
          prev.map((u) => (u.id === unitId ? { ...u, coefficients: { ...u.coefficients, [critId]: value } } : u))
        ),
    };
  }

  const oldHandlers = makeGroupHandlers(setOldUnits, "דירה ישנה");
  const newHandlers = makeGroupHandlers(setNewUnits, "דירה חדשה");

  // סדר בחירה: מיון הדירות הישנות לפי מקדם כולל יורד. ניקוד גבוה = בוחר קודם.
  // תיקו (מקדם זהה) מסומן לצורך הגרלה, לא נשבר אוטומטית על ידי הכלי.
  const oldRanked = [...oldUnits]
    .map((u) => ({ unit: u, total: totalCoefficient(u, criteria) }))
    .sort((a, b) => b.total - a.total);

  const newUnitsById = new Map(newUnits.map((u) => [u.id, u]));

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">כלי דירוג ובחירת יחידות</h1>
      <p className="text-sm text-gray-500 mb-6">
        לשימוש בפרויקטי פינוי בינוי: דירוג הדירות הישנות של הדיירים הקיימים, וחישוב פער ערך מול
        הדירה החדשה שכל דייר בפועל בחר.
      </p>

      <section className="bg-[#EAF3EC] border border-[#BFE0CC] rounded-xl p-5 mb-8 text-sm text-gray-700 leading-relaxed">
        <div className="font-bold text-[#14502F] mb-2">שיטת העבודה הנהוגה</div>
        <p className="mb-2">
          לכל קריטריון (קומה, נוף, כיוון אוויר וכו&apos;) נקבע לכל דירה <b>מקדם התאמה סביב 1.0</b>:
          בדיוק 1 = ניטרלי, מעל 1 = משביח, מתחת ל-1 = פוגם. <b>המקדם הכולל של דירה הוא מכפלת כל
          המקדמים שלה</b> (לא סכום).
        </p>
        <p className="mb-2">
          <b>הדירוג קובע סדר בחירה, לא שיוך אוטומטי</b>: מקדם הדירה הישנה של כל דייר קובע את התור
          שלו, בעל המקדם הגבוה ביותר בוחר ראשון מתוך הדירות החדשות, וכן הלאה. הדירוג{" "}
          <b>אינו</b> קובע איזו דירה ספציפית מקבלים, וגם לא משפיע על שטח/זכאות הדירה החדשה (זה
          נקבע חוזית בנפרד). כשלשני דיירים מקדם זהה (תיקו), נהוג לשבור אותו בהגרלה הוגנת, לא בכלי
          הזה.
        </p>
        <p>
          לאחר שכל דייר בחר בפועל דירה חדשה, מחשבים את פער המקדם/הערך בין הדירה הישנה לחדשה
          שנבחרה, לצורך תשלום איזון אם נדרש. אין טווחים סטנדרטיים מחייבים לאחוזי ההתאמה, כל פרויקט
          נבדק לגופו לפי שיקול דעת מקצועי.
        </p>
      </section>

      <section className="mb-4 flex items-center justify-between">
        <h2 className="font-bold text-[#123640] text-sm">קריטריונים (משותפים לשתי הקבוצות)</h2>
        <button onClick={addCriterion} className="text-xs font-medium text-[#1D6F42] hover:underline">
          + הוספת קריטריון
        </button>
      </section>

      <div className="overflow-x-auto rounded-lg border border-gray-200 mb-8">
        <table className="w-full text-xs border-collapse min-w-[500px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
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
            </tr>
          </thead>
        </table>
      </div>

      <UnitGroupTable
        title="דירות ישנות (של הדיירים הקיימים)"
        addLabel="+ הוספת דירה ישנה"
        units={oldUnits}
        criteria={criteria}
        onAddUnit={oldHandlers.add}
        onRemoveUnit={oldHandlers.remove}
        onUpdateUnit={oldHandlers.update}
        onUpdateCoefficient={oldHandlers.updateCoef}
      />

      <UnitGroupTable
        title="דירות חדשות (קטלוג הדירות הזמינות בבניין החדש)"
        addLabel="+ הוספת דירה חדשה"
        units={newUnits}
        criteria={criteria}
        onAddUnit={newHandlers.add}
        onRemoveUnit={newHandlers.remove}
        onUpdateUnit={newHandlers.update}
        onUpdateCoefficient={newHandlers.updateCoef}
      />

      <section className="mb-8">
        <h2 className="font-bold text-[#123640] text-sm mb-1">סדר בחירה ופער ערך</h2>
        <p className="text-xs text-gray-500 mb-3">
          ממוין לפי מקדם הדירה הישנה, מהגבוה לנמוך (סדר הבחירה). לכל דייר, בחרו ידנית איזו דירה
          חדשה הוא בפועל לקח.
        </p>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-xs border-collapse min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="text-right py-2 px-2">תור</th>
                <th className="text-right py-2 px-2">דירה ישנה</th>
                <th className="text-right py-2 px-2">מקדם ישן</th>
                <th className="text-right py-2 px-2">דירה חדשה שנבחרה</th>
                <th className="text-right py-2 px-2">מקדם חדש</th>
                <th className="text-right py-2 px-2">פער מקדם</th>
                <th className="text-right py-2 px-2">פער ערך (₪)</th>
              </tr>
            </thead>
            <tbody>
              {oldRanked.map(({ unit, total }, i) => {
                const tie = i > 0 && Math.abs(total - oldRanked[i - 1].total) < 0.0005;
                const chosenId = choices[unit.id] ?? "";
                const chosenUnit = chosenId ? newUnitsById.get(chosenId) : undefined;
                const chosenTotal = chosenUnit ? totalCoefficient(chosenUnit, criteria) : null;
                const coefGap = chosenTotal !== null ? chosenTotal - total : null;
                const valueGap =
                  coefGap !== null && unit.basePriceNis > 0 && chosenUnit
                    ? chosenUnit.basePriceNis * chosenTotal! - unit.basePriceNis * total
                    : null;
                return (
                  <tr key={unit.id} className="border-t border-gray-100 tabular-nums">
                    <td className="py-1.5 px-2 font-medium text-[#14502F]">
                      {i + 1}
                      {tie && (
                        <span className="block text-[10px] font-normal text-amber-600">תיקו, נדרשת הגרלה</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2">{unit.name || "ללא שם"}</td>
                    <td className="py-1.5 px-2">{total.toFixed(3)}</td>
                    <td className="py-1.5 px-2">
                      <select
                        value={chosenId}
                        onChange={(e) => setChoices((prev) => ({ ...prev, [unit.id]: e.target.value }))}
                        aria-label={`דירה חדשה שנבחרה עבור ${unit.name || "דירה ישנה"}`}
                        className="border border-gray-200 rounded px-2 py-1 max-w-[150px]"
                      >
                        <option value="">— טרם נבחר —</option>
                        {newUnits.map((nu) => (
                          <option key={nu.id} value={nu.id}>
                            {nu.name || "ללא שם"}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 px-2">{chosenTotal !== null ? chosenTotal.toFixed(3) : "-"}</td>
                    <td className={`py-1.5 px-2 font-medium ${coefGap !== null && coefGap < 0 ? "text-red-600" : "text-[#14502F]"}`}>
                      {coefGap !== null ? (coefGap >= 0 ? "+" : "") + coefGap.toFixed(3) : "-"}
                    </td>
                    <td className={`py-1.5 px-2 font-medium ${valueGap !== null && valueGap < 0 ? "text-red-600" : "text-[#14502F]"}`}>
                      {valueGap !== null ? (valueGap >= 0 ? "+" : "") + nis(valueGap) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          פער ערך חיובי: הדירה החדשה שווה יותר מהישנה, ייתכן תשלום איזון מהדייר. פער שלילי: הדירה
          החדשה שווה פחות, ייתכן תשלום איזון לדייר.
        </p>
      </section>

      <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-4">
        כלי חישוב עזר בלבד, לשימוש שמאי מקרקעין מוסמך בלבד. המקדמים המוזנים הם באחריות המזין, ואינם
        המלצה שמאית. אינו מהווה חוות דעת שמאית ואינו תחליף לבדיקת שמאי מקרקעין מוסמך.
      </p>
    </main>
  );
}
