"use client";

import { useState } from "react";
import { BASIC_PRICE_NIS } from "@/lib/supabase";
import type { DealType } from "@/lib/calc/types";

const CARDCOM_LINK = process.env.NEXT_PUBLIC_CARDCOM_LINK_BASIC;
const SITE_URL = "https://haimetkin-lgtm.github.io/dohefes";

const DEAL_TYPES: { id: DealType; title: string; description: string; note?: string }[] = [
  {
    id: "basic",
    title: "דוח אפס בסיסי",
    description: "פרויקט מגורים יזמות רגיל, רכישת קרקע במזומן.",
  },
  {
    id: "tama38",
    title: 'תמ"א 38',
    description: "הריסה ובנייה מחדש.",
  },
  {
    id: "pinuyBinui",
    title: "פינוי בינוי",
    description: "פינוי מבנים קיימים ובנייה מחדש, הדיירים הקיימים מקבלים דירות חדשות.",
    note: "כולל טבלאות לדירוג דירות עם אפשרות לקביעת הפרמטרים לדירוג על ידי המשתמש.",
  },
  {
    id: "kombinatsia",
    title: "קומבינציה בעין",
    description: "בעל הקרקע מקבל חלק מהדירות החדשות, במקום תשלום במזומן.",
  },
  {
    id: "kombinatsiaTemurot",
    title: "קומבינצית תמורות",
    description: "כמו קומבינציה בעין, עם מנגנון ערבות נפרד לבעלי הקרקע.",
  },
  {
    id: "purchaseGroup",
    title: "קבוצת רכישה",
    description: "קבוצת רוכשים בונה עבור עצמה, במקום לרכוש מיזם.",
  },
  {
    id: "mixedUse",
    title: "מעורב מגורים ותעסוקה",
    description: "פרויקט עם מגורים לצד מסחר ו/או משרדים.",
  },
];

export default function StartPage() {
  const [selected, setSelected] = useState<DealType | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handlePay() {
    if (!selected) {
      setError("קודם בוחרים את סוג הפרויקט.");
      return;
    }
    if (!CARDCOM_LINK) {
      setError("התשלום המקוון עדיין לא מוגדר. אפשר לפתוח את מחולל דוחות האפס ישירות בינתיים, או לפנות בוואטסאפ.");
      return;
    }
    const url = new URL(CARDCOM_LINK);
    url.searchParams.set("SuccessRedirectUrl", `${SITE_URL}/calculator/?paid=true&dealType=${selected}`);
    url.searchParams.set("FailedRedirectUrl", `${SITE_URL}/start/?payment=failed`);
    window.location.href = url.toString();
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">בנה דוח אפס עצמאי</h1>
      <p className="text-sm text-gray-500 mb-6">
        תשלום חד פעמי לפרויקט, {BASIC_PRICE_NIS.toLocaleString("he-IL")} ₪. קודם בוחרים את סוג
        הפרויקט, ורק אחר כך עוברים לתשלום.
      </p>

      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        {DEAL_TYPES.map((dt) => (
          <button
            key={dt.id}
            onClick={() => {
              setSelected(dt.id);
              setError(null);
            }}
            className={`text-right border rounded-xl p-4 transition-colors ${
              selected === dt.id ? "border-[#1D6F42] bg-[#EAF3EC]" : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <div className="font-bold text-[#14502F] text-sm mb-1">{dt.title}</div>
            <div className="text-xs text-gray-500 leading-relaxed">{dt.description}</div>
            {dt.note && <div className="text-xs text-[#1D6F42] leading-relaxed mt-1">{dt.note}</div>}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-6">
        <div className="font-bold text-[#123640] mb-2 text-sm">כלול במחיר</div>
        <ul className="text-sm text-gray-700 space-y-1.5 list-disc pr-5">
          <li>מילוי שטחים, תמהיל דירות, עלויות והכנסות</li>
          <li>דוח כדאיות כלכלית מלא, ניתן להורדה כ-Excel ולהדפסה כ-PDF</li>
          <li>כל דוחות המעקב לאותו פרויקט לאורך הביצוע, ללא תשלום נוסף</li>
        </ul>
      </div>

      {error && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">{error}</p>}

      <button
        onClick={handlePay}
        disabled={!selected}
        className="w-full bg-[#1D6F42] hover:bg-[#14502F] disabled:opacity-40 disabled:cursor-default text-white font-bold py-3 rounded-lg transition-colors"
      >
        מעבר לתשלום, {BASIC_PRICE_NIS.toLocaleString("he-IL")} ₪
      </button>

      <p className="text-xs text-gray-400 text-center mt-4">
        <a href="/dohefes/terms/" className="underline">
          תנאי השימוש והגבלת האחריות
        </a>
      </p>
    </main>
  );
}
