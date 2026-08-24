"use client";

import { useState } from "react";
import { CUSTOM_PRICE_NIS } from "@/lib/supabase";

const CARDCOM_LINK = process.env.NEXT_PUBLIC_CARDCOM_LINK_CUSTOM;
const SITE_URL = "https://haimetkin-lgtm.github.io/dohefes";

export default function CustomPage() {
  const [error, setError] = useState<string | null>(null);

  function handlePay() {
    if (!CARDCOM_LINK) {
      setError("התשלום המקוון עדיין לא מוגדר. אפשר לפנות בוואטסאפ בינתיים.");
      return;
    }
    const url = new URL(CARDCOM_LINK);
    url.searchParams.set("SuccessRedirectUrl", `${SITE_URL}/custom/intake/?paid=true`);
    url.searchParams.set("FailedRedirectUrl", `${SITE_URL}/custom/?payment=failed`);
    window.location.href = url.toString();
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">דוח אפס בהתאמה אישית</h1>
      <p className="text-sm text-gray-500 mb-6">
        תשלום חד פעמי לפרויקט, {CUSTOM_PRICE_NIS.toLocaleString("he-IL")} ₪.
      </p>

      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-6">
        <div className="font-bold text-[#123640] mb-2 text-sm">איך זה עובד</div>
        <ol className="text-sm text-gray-700 space-y-2 list-decimal pr-5">
          <li>משלמים כאן.</li>
          <li>אחרי התשלום, ממלאים טופס קצר: שם, נייד, אימייל, ותיאור חופשי ומורחב של הפרויקט, ואפשר להעלות קבצים (פרוגרמה, Word, Excel, PDF).</li>
          <li>
            סוכן חכם של המערכת קורא את התיאור והקבצים, ותופר מהם שלד דוח אפס מותאם לפרויקט שלכם:
            שטחים, תמהיל ונתונים פיזיים אחרים.
          </li>
          <li>
            אתם מקבלים את השלד וממלאים בעצמכם את הערכים הכספיים (מחירי מכירה וכו&apos;), והמערכת
            מפיקה את דוח האפס המלא.
          </li>
          <li>בסוף הדוח, אפשרות לקביעת שיחת ייעוץ עם חיים אטקין.</li>
        </ol>
      </div>

      {error && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">{error}</p>}

      <button
        onClick={handlePay}
        className="w-full bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold py-3 rounded-lg transition-colors"
      >
        מעבר לרכישה ותשלום - {CUSTOM_PRICE_NIS.toLocaleString("he-IL")} ₪
      </button>

      <p className="text-xs text-gray-400 text-center mt-4">
        <a href="/dohefes/terms/" className="underline">
          תנאי השימוש והגבלת האחריות
        </a>
      </p>
    </main>
  );
}
