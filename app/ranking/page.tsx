"use client";

import { useState } from "react";
import { downloadRankingWorkbook } from "@/lib/report/exportRankingExcel";
import {
  calculateValueGap,
  availableNewUnits,
  coefficientIssue,
  criterionContribution,
  rankUnits,
  totalCoefficient,
  validateRankingInputs,
  type RankingCriterion as Criterion,
  type RankingUnit as UnitRow,
} from "@/lib/ranking";

const DEFAULT_CRITERIA: Criterion[] = [
  { id: "floor", name: "קומה", weight: 1 },
  { id: "aspect", name: "כיוון אוויר ומספר חזיתות", weight: 1 },
  { id: "view", name: "נוף", weight: 1 },
  { id: "elevator", name: "מרחק ממעלית/מבואה", weight: 1 },
  { id: "attachments", name: "הצמדות (חניה/מחסן/גינה)", weight: 1 },
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
    <section className="min-w-0 mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-[#123640] text-sm">{title}</h2>
        <button onClick={onAddUnit} className="text-xs font-medium text-[#1D6F42] hover:underline">
          {addLabel}
        </button>
      </div>
      <div className="w-full max-w-full overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs border-collapse min-w-[700px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              <th className="text-right py-2 px-2 sticky right-0 bg-gray-50">יחידה</th>
              {criteria.map((c) => (
                <th key={c.id} className="text-right py-2 px-2 min-w-[110px]">
                  {c.name || "קריטריון"}
                  <span className="block text-[10px] font-normal">משקל {c.weight}</span>
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
                  {criteria.map((c) => {
                    const value = u.coefficients[c.id] ?? 1;
                    const issue = coefficientIssue(value);
                    return (
                    <td key={c.id} className="py-1.5 px-2">
                      <input
                        type="number"
                        min="0.01"
                        max="3"
                        step="0.01"
                        value={value}
                        onChange={(e) => onUpdateCoefficient(u.id, c.id, Number(e.target.value))}
                        aria-label={`מקדם ${c.name || "קריטריון"}, ${title}, שורה ${i + 1}`}
                        aria-invalid={issue === "invalid"}
                        title={`תרומה משוקללת: ${criterionContribution(value, c.weight).toFixed(3)}`}
                        className={`w-20 border rounded px-2 py-1 ${issue === "invalid" ? "border-red-500 bg-red-50" : issue === "unusual" ? "border-amber-400 bg-amber-50" : "border-gray-200"}`}
                      />
                    </td>
                    );
                  })}
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
    const c = { id: nextId("crit"), name: "", weight: 1 };
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
        const coefficients = { ...u.coefficients };
        delete coefficients[id];
        return { ...u, coefficients };
      });
    setOldUnits(stripCoef);
    setNewUnits(stripCoef);
  }

  function renameCriterion(id: string, name: string) {
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  function updateCriterionWeight(id: string, weight: number) {
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, weight } : c)));
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
  const oldRanked = rankUnits(oldUnits, criteria);

  const newUnitsById = new Map(newUnits.map((u) => [u.id, u]));
  const validation = validateRankingInputs(criteria, oldUnits, newUnits, choices);
  const canExport = validation.blockingErrors.length === 0;

  return (
    <main className="w-full min-w-0 max-w-5xl mx-auto px-4 py-8 overflow-x-hidden">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">כלי דירוג ובחירת יחידות</h1>
      <p className="text-sm text-gray-500 mb-4">
        כלי חינמי מלא לפרויקטי פינוי בינוי: דירוג הדירות הישנות של הדיירים הקיימים וחישוב פער
        ערך מול הדירה החדשה שכל דייר בפועל בחר. אין צורך ברכישה או בדוח קיים.
      </p>

      <div className="print:hidden flex flex-col sm:flex-row gap-2 mb-6">
        <button
          onClick={() => downloadRankingWorkbook(criteria, oldUnits, newUnits, choices)}
          disabled={!canExport}
          className="flex-1 bg-[#1D6F42] hover:bg-[#14502F] disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          הורדת קובץ Excel
        </button>
        <button
          onClick={() => window.print()}
          className="flex-1 bg-white border border-[#1D6F42] text-[#1D6F42] hover:bg-[#EAF3EC] font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          הדפסה / שמירה כ-PDF
        </button>
      </div>

      <section className="bg-[#EAF3EC] border border-[#BFE0CC] rounded-xl p-5 mb-8 text-sm text-gray-700 leading-relaxed">
        <div className="font-bold text-[#14502F] mb-2">שיטת העבודה הנהוגה</div>
        <p className="mb-2">
          לכל קריטריון (קומה, נוף, כיוון אוויר וכו&apos;) נקבע לכל דירה <b>מקדם התאמה סביב 1.0</b>:
          בדיוק 1 = ניטרלי, מעל 1 = משביח, מתחת ל-1 = פוגם. <b>המקדם הכולל של דירה הוא מכפלת כל
          התרומות שלה</b> (לא סכום). לכל קריטריון ניתן גם משקל: 1 = השפעה מלאה, 0.5 = חצי השפעה,
          ו־0 = הקריטריון מוצג אך אינו משפיע. התרומה המחושבת היא מקדם בחזקת המשקל; לכן כל
          משקלי ברירת המחדל 1 משמרים בדיוק את שיטת המכפלה המקורית.
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

      {(validation.blockingErrors.length > 0 || validation.warnings.length > 0) && (
        <div className="print:hidden mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          {validation.blockingErrors.length > 0 && <div className="mb-1"><b>הייצוא נעול עד לתיקון:</b> {validation.blockingErrors.join(" ")}</div>}
          {validation.warnings.length > 0 && <div>{validation.warnings.join(" ")}</div>}
        </div>
      )}

      <section className="mb-4 flex items-center justify-between">
        <h2 className="font-bold text-[#123640] text-sm">קריטריונים (משותפים לשתי הקבוצות)</h2>
        <button onClick={addCriterion} className="text-xs font-medium text-[#1D6F42] hover:underline">
          + הוספת קריטריון
        </button>
      </section>

      <div className="w-full max-w-full overflow-x-auto rounded-lg border border-gray-200 mb-8">
        <table className="w-full text-xs border-collapse min-w-[500px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              {criteria.map((c) => (
                <th key={c.id} className="text-right py-2 px-2 min-w-[140px]">
                  <div className="flex items-center gap-1 mb-1">
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
                  <label className="flex items-center gap-1 font-normal text-[10px] text-gray-500">
                    משקל
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={c.weight}
                      onChange={(e) => updateCriterionWeight(c.id, Number(e.target.value))}
                      aria-label={`משקל קריטריון ${c.name || "ללא שם"}`}
                      aria-invalid={!Number.isFinite(c.weight) || c.weight < 0 || c.weight > 2}
                      className={`w-16 border rounded px-1 py-0.5 bg-white ${!Number.isFinite(c.weight) || c.weight < 0 || c.weight > 2 ? "border-red-500" : "border-gray-200"}`}
                    />
                  </label>
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
      onRemoveUnit={(id) => {
        oldHandlers.remove(id);
        setChoices((prev) => {
          const { [id]: removedChoice, ...rest } = prev;
          void removedChoice;
          return rest;
        });
      }}
        onUpdateUnit={oldHandlers.update}
        onUpdateCoefficient={oldHandlers.updateCoef}
      />

      <UnitGroupTable
        title="דירות חדשות (קטלוג הדירות הזמינות בבניין החדש)"
        addLabel="+ הוספת דירה חדשה"
        units={newUnits}
      criteria={criteria}
      onAddUnit={newHandlers.add}
      onRemoveUnit={(id) => {
        newHandlers.remove(id);
        setChoices((prev) => Object.fromEntries(Object.entries(prev).filter(([, chosenId]) => chosenId !== id)));
      }}
        onUpdateUnit={newHandlers.update}
        onUpdateCoefficient={newHandlers.updateCoef}
      />

      <section className="min-w-0 mb-8">
        <h2 className="font-bold text-[#123640] text-sm mb-1">סדר בחירה ופער ערך</h2>
        <p className="text-xs text-gray-500 mb-3">
          ממוין לפי מקדם הדירה הישנה, מהגבוה לנמוך (סדר הבחירה). לכל דייר, בחרו ידנית איזו דירה
          חדשה הוא בפועל לקח.
        </p>
        <div className="w-full max-w-full overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-xs border-collapse min-w-[980px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="text-right py-2 px-2">תור</th>
                <th className="text-right py-2 px-2">דירה ישנה</th>
                <th className="text-right py-2 px-2">מקדם ישן</th>
                <th className="text-right py-2 px-2">דירה חדשה שנבחרה</th>
                <th className="text-right py-2 px-2">מקדם חדש</th>
                <th className="text-right py-2 px-2">פער מקדם</th>
                <th className="text-right py-2 px-2">פער מחיר בסיס</th>
                <th className="text-right py-2 px-2">ערך ישן מתואם</th>
                <th className="text-right py-2 px-2">ערך חדש מתואם</th>
                <th className="text-right py-2 px-2">פער ערך (₪)</th>
              </tr>
            </thead>
            <tbody>
              {oldRanked.map(({ unit, coefficient: total, rank, tie }) => {
                const chosenId = choices[unit.id] ?? "";
                const chosenUnit = chosenId ? newUnitsById.get(chosenId) : undefined;
                const chosenTotal = chosenUnit ? totalCoefficient(chosenUnit, criteria) : null;
                const gap = chosenUnit && unit.basePriceNis > 0 && chosenUnit.basePriceNis > 0
                  ? calculateValueGap(unit, chosenUnit, criteria)
                  : null;
                return (
                  <tr key={unit.id} className="border-t border-gray-100 tabular-nums">
                    <td className="py-1.5 px-2 font-medium text-[#14502F]">
                      {rank}
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
                        {availableNewUnits(newUnits, choices, chosenId).map((nu) => (
                          <option key={nu.id} value={nu.id}>
                            {nu.name || "ללא שם"}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 px-2">{chosenTotal !== null ? chosenTotal.toFixed(3) : "-"}</td>
                    <td className={`py-1.5 px-2 font-medium ${gap && gap.coefficientGap < 0 ? "text-red-600" : "text-[#14502F]"}`}>
                      {gap ? `${gap.coefficientGap >= 0 ? "+" : ""}${gap.coefficientGap.toFixed(3)} (${gap.coefficientGapPercent >= 0 ? "+" : ""}${(gap.coefficientGapPercent * 100).toFixed(1)}%)` : "-"}
                    </td>
                    <td className="py-1.5 px-2">{gap ? (gap.basePriceGapNis >= 0 ? "+" : "") + nis(gap.basePriceGapNis) : "-"}</td>
                    <td className="py-1.5 px-2">{gap ? nis(gap.oldAdjustedValueNis) : "-"}</td>
                    <td className="py-1.5 px-2">{gap ? nis(gap.newAdjustedValueNis) : "-"}</td>
                    <td className={`py-1.5 px-2 font-medium ${gap && gap.valueGapNis < 0 ? "text-red-600" : "text-[#14502F]"}`}>
                      {gap ? (gap.valueGapNis >= 0 ? "+" : "") + nis(gap.valueGapNis) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          ערך מתואם = מחיר בסיס × מקדם כולל. פירוט מחיר הבסיס והמקדם מוצג בנפרד כדי להבהיר מה
          יצר את הפער. פער חיובי עשוי להצביע על תשלום איזון מהדייר; פער שלילי עשוי להצביע על
          תשלום איזון לדייר, בכפוף לקביעה מקצועית ולהסכמות הפרויקט.
        </p>
      </section>

      <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-4">
        כלי חישוב עזר בלבד, לשימוש שמאי מקרקעין מוסמך בלבד. המקדמים המוזנים הם באחריות המזין, ואינם
        המלצה שמאית. אינו מהווה חוות דעת שמאית ואינו תחליף לבדיקת שמאי מקרקעין מוסמך.
      </p>
    </main>
  );
}
