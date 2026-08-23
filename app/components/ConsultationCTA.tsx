"use client";

import { CONSULTATION_PRICE_NIS } from "@/lib/supabase";

const CARDCOM_LINK = process.env.NEXT_PUBLIC_CARDCOM_LINK_CONSULTATION;
const WHATSAPP_NUMBER = "972523728828";

export default function ConsultationCTA() {
  function handleClick() {
    const waText = encodeURIComponent("שלום חיים, שילמתי עבור שיחת ייעוץ על דוח אפס, מתי נוח לך?");
    if (!CARDCOM_LINK) {
      window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${waText}`, "_blank");
      return;
    }
    const url = new URL(CARDCOM_LINK);
    url.searchParams.set("SuccessRedirectUrl", `https://wa.me/${WHATSAPP_NUMBER}?text=${waText}`);
    window.location.href = url.toString();
  }

  return (
    <div className="print:hidden bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <div className="font-bold text-[#14502F] text-sm">קביעת שיחת ייעוץ עם חיים אטקין</div>
        <div className="text-xs text-gray-500">לעבור יחד על הדוח, {CONSULTATION_PRICE_NIS.toLocaleString("he-IL")} ₪</div>
      </div>
      <button
        onClick={handleClick}
        className="bg-[#1D6F42] hover:bg-[#14502F] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        קביעת שיחה ←
      </button>
    </div>
  );
}
