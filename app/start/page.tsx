"use client";

import { useState } from "react";
import { CATALOG, formatPriceNis } from "@/lib/catalog";
import type { DealType } from "@/lib/calc/types";
import { generateIdempotencyKey, purchaseProduct } from "@/lib/payment/payment-client";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { SITE_PATHS } from "@/lib/site";

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
    note: "כולל טבלאות לדירוג דירות עם אפשרות לקביעת הפרמטרים לדירוג על ידי המשתמש, ללא תשלום נוסף.",
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
  const [submitting, setSubmitting] = useState(false);

  async function handlePay() {
    if (!selected) {
      setError("קודם בוחרים את סוג הפרויקט.");
      return;
    }
    if (!supabaseConfigured) {
      setError("התשלום המקוון אינו זמין כרגע. אפשר לנסות שוב מאוחר יותר.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await purchaseProduct(
      supabase.functions,
      window.localStorage,
      { productType: "baseReport", dealType: selected, idempotencyKey: generateIdempotencyKey() },
      new Date()
    );
    if (result.kind === "redirect") {
      window.location.assign(result.checkoutUrl);
      return;
    }
    if (result.kind === "already_paid" && result.reportId) {
      window.location.assign(SITE_PATHS.calculatorReport(result.reportId));
      return;
    }
    setSubmitting(false);
    setError(
      result.kind === "storage_failed"
        ? "לא ניתן לשמור את פרטי ההמשך לתשלום בדפדפן. התשלום לא נפתח."
        : result.kind === "retryable"
          ? "שירות התשלום אינו זמין זמנית. לא בוצע חיוב; אפשר לנסות שוב."
          : "לא ניתן לפתוח את התשלום כרגע. לא בוצע חיוב."
    );
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-xl font-bold text-[#14502F] mb-1">בנה דוח אפס עצמאי</h1>
      <p className="text-sm text-gray-500 mb-6">
        תשלום חד פעמי לפרויקט, {formatPriceNis(CATALOG.baseReport.priceAgorot)}. קודם בוחרים את
        סוג הפרויקט, ורק אחר כך עוברים לתשלום.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {DEAL_TYPES.map((dt) => (
          <div
            key={dt.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              setSelected(dt.id);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                setSelected(dt.id);
                setError(null);
              }
            }}
            className={`text-right border rounded-xl p-4 transition-colors cursor-pointer ${
              selected === dt.id ? "border-[#1D6F42] bg-[#EAF3EC]" : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <div className="font-bold text-[#14502F] text-sm mb-1">{dt.title}</div>
            <div className="text-xs text-gray-500 leading-relaxed">{dt.description}</div>
            {dt.note && <div className="text-xs text-[#1D6F42] leading-relaxed mt-1">{dt.note}</div>}
            {dt.id === "pinuyBinui" && (
              <a
                href="/dohefes/ranking-sample/"
                onClick={(e) => e.stopPropagation()}
                className="block text-xs font-medium text-[#1D6F42] underline mt-1"
              >
                דוח דירוג דירות לדוגמה ←
              </a>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-6">
        <div className="font-bold text-[#123640] mb-2 text-sm">כלול במחיר</div>
        <ul className="text-sm text-gray-700 space-y-1.5 list-disc pr-5">
          <li>מילוי שטחים, תמהיל דירות, עלויות והכנסות</li>
          {CATALOG.baseReport.includedFeatures.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <p className="text-xs text-gray-500 mt-3 leading-relaxed">
          אינו כולל {CATALOG.cashFlowAnalysis.displayName} או {CATALOG.trackingReports.displayName} - אלה
          מוצרי המשך נפרדים בתשלום לדוח קיים.
        </p>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          {CATALOG.trackingReports.displayName}: מוצר המשך אופציונלי לדוח קיים,{" "}
          {formatPriceNis(CATALOG.trackingReports.priceAgorot)} נוספים.
        </p>
      </div>

      {error && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">{error}</p>}

      <button
        onClick={handlePay}
        disabled={!selected || submitting}
        className="w-full bg-[#1D6F42] hover:bg-[#14502F] disabled:opacity-40 disabled:cursor-default text-white font-bold py-3 rounded-lg transition-colors"
      >
        {submitting ? "מכינים מעבר מאובטח לתשלום..." : `מעבר לרכישה ותשלום - ${formatPriceNis(CATALOG.baseReport.priceAgorot)}`}
      </button>

      <p className="text-xs text-gray-400 text-center mt-4">
        <a href="/dohefes/terms/" className="underline">
          תנאי השימוש והגבלת האחריות
        </a>
      </p>
    </main>
  );
}
