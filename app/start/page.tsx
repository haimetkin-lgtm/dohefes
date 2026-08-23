"use client";

import { useState } from "react";
import { BASIC_PRICE_NIS } from "@/lib/supabase";

const CARDCOM_LINK = process.env.NEXT_PUBLIC_CARDCOM_LINK_BASIC;
const SITE_URL = "https://haimetkin-lgtm.github.io/dohefes";

export default function StartPage() {
  const [error, setError] = useState<string | null>(null);

  function handlePay() {
    if (!CARDCOM_LINK) {
      setError("התשלום המקוון עדיין לא מוגדר. אפשר לפתוח את המחשבון ישירות בינתיים, או לפנות בוואטסאפ.");
      return;
    }
    const url = new URL(CARDCOM_LINK);
    url.searchParams.set("SuccessRedirectUrl", `${SITE_URL}/calculator/?paid=true`);
    url.searchParams.set("FailedRedirectUrl", `${SITE_URL}/start/?payment=failed`);
    window.location.href = url.toString();
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">בנה דוח אפס עצמאי</h1>
      <p className="text-sm text-gray-500 mb-6">
        תשלום חד פעמי לפרויקט, {BASIC_PRICE_NIS.toLocaleString("he-IL")} ₪. אחרי התשלום תעברו ישר
        לתבנית שאתם ממלאים בעצמכם.
      </p>

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
        className="w-full bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold py-3 rounded-lg transition-colors"
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
