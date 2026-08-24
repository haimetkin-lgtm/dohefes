const CRITERIA = ["קומה", "כיוון אוויר ומספר חזיתות", "נוף", "מרחק ממעלית/מבואה", "הצמדות (חניה/מחסן/גינה)"];

interface SampleUnit {
  name: string;
  coefficients: number[];
  basePriceNis: number;
}

function total(coefficients: number[]): number {
  return coefficients.reduce((acc, c) => acc * c, 1);
}

function nis(n: number): string {
  return Math.round(n).toLocaleString("he-IL") + " ₪";
}

const OLD_UNITS: SampleUnit[] = [
  { name: "דירה ישנה, קומה 1", coefficients: [0.9, 0.95, 1.0, 1.0, 1.0], basePriceNis: 1_800_000 },
  { name: "דירה ישנה, קומה 2", coefficients: [0.97, 1.0, 1.0, 1.0, 1.0], basePriceNis: 1_800_000 },
  { name: "דירה ישנה, קומה 3", coefficients: [1.03, 1.02, 1.05, 1.0, 1.0], basePriceNis: 1_800_000 },
  { name: "דירה ישנה, קומה 4 (גג)", coefficients: [1.1, 1.05, 1.15, 0.98, 1.05], basePriceNis: 1_800_000 },
];

const NEW_UNITS: SampleUnit[] = [
  { name: "דירה חדשה, פנטהאוז קומה 8", coefficients: [1.15, 1.1, 1.2, 1.0, 1.08], basePriceNis: 2_300_000 },
  { name: "דירה חדשה, קומה 5", coefficients: [1.05, 1.0, 1.05, 1.0, 1.0], basePriceNis: 2_300_000 },
  { name: "דירה חדשה, קומה 3", coefficients: [0.97, 1.0, 1.0, 1.0, 1.0], basePriceNis: 2_300_000 },
  { name: "דירה חדשה, קומה 1", coefficients: [0.9, 0.95, 0.97, 1.02, 1.0], basePriceNis: 2_300_000 },
];

// לפי סדר הבחירה (מהדירוג הגבוה ביותר), כל דייר בחר בפועל דירה חדשה
const CHOSEN_NEW_INDEX = [0, 1, 2, 3]; // מקביל, אחרי מיון יורד, לדירות החדשות לפי סדר עדיפות שבחרו

function UnitTable({ title, units }: { title: string; units: SampleUnit[] }) {
  return (
    <div className="mb-6">
      <div className="font-bold text-[#123640] text-sm mb-2">{title}</div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs border-collapse min-w-[640px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              <th className="text-right py-2 px-2">יחידה</th>
              {CRITERIA.map((c) => (
                <th key={c} className="text-right py-2 px-2 min-w-[100px]">
                  {c}
                </th>
              ))}
              <th className="text-right py-2 px-2 min-w-[100px]">מחיר בסיס</th>
              <th className="text-right py-2 px-2 min-w-[80px]">מקדם כולל</th>
              <th className="text-right py-2 px-2 min-w-[100px]">מחיר מתואם</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const t = total(u.coefficients);
              return (
                <tr key={u.name} className="border-t border-gray-100 tabular-nums">
                  <td className="py-1.5 px-2">{u.name}</td>
                  {u.coefficients.map((c, i) => (
                    <td key={i} className="py-1.5 px-2">
                      {c.toFixed(2)}
                    </td>
                  ))}
                  <td className="py-1.5 px-2">{nis(u.basePriceNis)}</td>
                  <td className="py-1.5 px-2 font-medium text-[#14502F]">{t.toFixed(3)}</td>
                  <td className="py-1.5 px-2 font-medium text-[#14502F]">{nis(u.basePriceNis * t)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RankingSamplePage() {
  const oldRanked = [...OLD_UNITS].sort((a, b) => total(b.coefficients) - total(a.coefficients));

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <h1 className="text-lg font-bold text-[#14502F] mb-1">דוגמת דירוג ובחירת יחידות, פינוי בינוי</h1>
        <p className="text-sm text-gray-500">
          נתונים לדוגמה בלבד, כדי להראות איך הכלי עובד. לא פרויקט אמיתי.
        </p>
      </div>

      <section className="bg-[#EAF3EC] border border-[#BFE0CC] rounded-xl p-5 mb-8 text-sm text-gray-700 leading-relaxed">
        <div className="font-bold text-[#14502F] mb-2">שיטת העבודה</div>
        <p className="mb-2">
          בניין ישן בן 4 קומות, דירה אחת בכל קומה. הדירוג של הדירה הישנה של כל דייר, לפי מכפלת
          המקדמים (קומה, כיוון אוויר, נוף וכו&apos;), קובע את <b>סדר הבחירה</b> שלו מתוך הדירות
          החדשות: דירת הגג (המקדם הגבוה ביותר, 1.367) בוחרת ראשונה, וכן הלאה.
        </p>
        <p>
          שימו לב: גם כשדייר בוחר דירה חדשה בעלת מקדם דומה או נמוך במקצת מהדירה הישנה שלו (למשל
          קומה 2 מול קומה 3), עדיין נוצר פער ערך חיובי, כי מחיר הבסיס של הדירה החדשה (בנייה חדשה)
          גבוה ממחיר הבסיס של הדירה הישנה. זה טיפוסי, לא טעות בחישוב.
        </p>
      </section>

      <UnitTable title="דירות ישנות (של הדיירים הקיימים)" units={OLD_UNITS} />
      <UnitTable title="דירות חדשות (קטלוג הדירות בבניין החדש)" units={NEW_UNITS} />

      <section className="mb-8">
        <div className="font-bold text-[#123640] text-sm mb-1">סדר בחירה ופער ערך</div>
        <p className="text-xs text-gray-500 mb-3">ממוין לפי מקדם הדירה הישנה, מהגבוה לנמוך (סדר הבחירה).</p>
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
                <th className="text-right py-2 px-2">פער ערך</th>
              </tr>
            </thead>
            <tbody>
              {oldRanked.map((oldUnit, i) => {
                const oldTotal = total(oldUnit.coefficients);
                const newUnit = NEW_UNITS[CHOSEN_NEW_INDEX[i]];
                const newTotal = total(newUnit.coefficients);
                const coefGap = newTotal - oldTotal;
                const valueGap = newUnit.basePriceNis * newTotal - oldUnit.basePriceNis * oldTotal;
                return (
                  <tr key={oldUnit.name} className="border-t border-gray-100 tabular-nums">
                    <td className="py-1.5 px-2 font-medium text-[#14502F]">{i + 1}</td>
                    <td className="py-1.5 px-2">{oldUnit.name}</td>
                    <td className="py-1.5 px-2">{oldTotal.toFixed(3)}</td>
                    <td className="py-1.5 px-2 font-medium text-[#1D6F42]">{newUnit.name}</td>
                    <td className="py-1.5 px-2">{newTotal.toFixed(3)}</td>
                    <td className={`py-1.5 px-2 font-medium ${coefGap < 0 ? "text-red-600" : "text-[#14502F]"}`}>
                      {(coefGap >= 0 ? "+" : "") + coefGap.toFixed(3)}
                    </td>
                    <td className="py-1.5 px-2 font-medium text-[#14502F]">
                      {(valueGap >= 0 ? "+" : "") + nis(valueGap)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          פער ערך חיובי: הדירה החדשה שווה יותר, ייתכן תשלום איזון מהדייר. פער שלילי: הדירה החדשה
          שווה פחות, ייתכן תשלום איזון לדייר.
        </p>
      </section>

      <div className="text-center">
        <a
          href="/dohefes/ranking/"
          className="inline-block bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold px-6 py-3 rounded-lg transition-colors"
        >
          בניית טבלת דירוג לפרויקט שלי ←
        </a>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-4 mt-8 text-center">
        כלי חישוב עזר בלבד, לשימוש שמאי מקרקעין מוסמך בלבד. אינו מהווה חוות דעת שמאית ואינו תחליף
        לבדיקת שמאי מקרקעין מוסמך.
      </p>
    </main>
  );
}
