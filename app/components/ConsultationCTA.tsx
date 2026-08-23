"use client";

import { CONSULTATION_PRICE_NIS } from "@/lib/supabase";

const CARDCOM_LINK = process.env.NEXT_PUBLIC_CARDCOM_LINK_CONSULTATION;
const WHATSAPP_NUMBER = "972523728828";

export default function ConsultationCTA() {
  function handlePay() {
    if (!CARDCOM_LINK) {
      const text = encodeURIComponent("שלום חיים, אשמח לתאם שיחת ייעוץ על דוח אפס.");
      window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`, "_blank");
      return;
    }
    const url = new URL(CARDCOM_LINK);
    url.searchParams.set("SuccessRedirectUrl", window.location.href);
    window.location.href = url.toString();
  }

  function handleWhatsappConfirm() {
    const text = encodeURIComponent(
      "שלום חיים, מצרף/ת את אישור התשלום שקיבלתי במייל עבור שיחת הייעוץ על דוח אפס, נשמח לתאם מועד."
    );
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`, "_blank");
  }

  return (
    <div className="print:hidden bg-white border border-gray-200 rounded-xl p-4">
      <div className="font-bold text-[#14502F] text-sm mb-1">קביעת שיחת ייעוץ עם חיים אטקין</div>
      <p className="text-xs text-gray-500 leading-relaxed mb-3">
        שיחת הייעוץ היא שיחה מקוונת במערכת ה-Meet של גוגל, שאליה יישלח אליכם קישור. השיחה מוגבלת
        לעד שעה, תוקלט, ובסיומה ההקלטה תישלח אליכם.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={handlePay}
          className="flex-1 bg-[#1D6F42] hover:bg-[#14502F] text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          שיחת ייעוץ על הדוח עם חיים אטקין, {CONSULTATION_PRICE_NIS.toLocaleString("he-IL")} ₪
        </button>
        <button
          onClick={handleWhatsappConfirm}
          className="flex-1 bg-white border border-[#1D6F42] text-[#1D6F42] hover:bg-[#EAF3EC] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          שלח הודעת ווטסאפ עם אישור התשלום שקיבלת במייל לתיאום שיחת הייעוץ
        </button>
      </div>
    </div>
  );
}
