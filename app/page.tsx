const SERVICE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Service",
  serviceType: "הפקת דוחות כדאיות כלכלית לפרויקטי התחדשות עירונית",
  provider: { "@type": "Person", name: "חיים אטקין", jobTitle: "שמאי מקרקעין" },
  areaServed: { "@type": "Country", name: "IL" },
  offers: [
    { "@type": "Offer", priceCurrency: "ILS", price: "980", name: "דוח אפס עצמאי" },
    { "@type": "Offer", priceCurrency: "ILS", price: "1800", name: "דוח אפס בהתאמה אישית" },
  ],
};

const WHATSAPP_TEXT = encodeURIComponent("שלום חיים, אני מעוניין בדוח אפס בהתאמה אישית לפרויקט שלי");

export default function Home() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SERVICE_JSON_LD) }} />

      <section className="text-center mb-10">
        <h1 className="text-2xl md:text-3xl font-bold text-[#14502F] leading-snug mb-3">
          כדאיות כלכלית לפרויקט התחדשות עירונית,
          <br />
          בלי לפתוח את האקסל.
        </h1>
        <p className="text-gray-600 max-w-xl mx-auto leading-relaxed">
          מזינים שטחים, תמהיל דירות ועלויות, מקבלים דוח כדאיות כלכלית מלא: עלויות בנייה, הכנסות
          צפויות ורווח לעלות, לפרויקטי תמ&quot;א 38 וקומבינציה. עלויות ברירת המחדל מבוססות על
          אומדן לשכת שמאי המקרקעין.
        </p>
        <div className="mt-6">
          <a
            href="/dohefes/calculator/"
            className="inline-block bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold px-6 py-3 rounded-lg transition-colors"
          >
            פתח מחשבון, 980 ₪
          </a>
        </div>
      </section>

      <section className="grid sm:grid-cols-2 gap-4 mb-10">
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="font-bold text-[#14502F] mb-1">דוח אפס עצמאי, 980 ₪</div>
          <p className="text-sm text-gray-600 mb-3">
            ממלאים בעצמכם שטחים, תמהיל דירות, עלויות והכנסות. התשלום כולל את דוח האפס וגם את כל
            דוחות המעקב לאותו פרויקט, ללא תשלום נוסף.
          </p>
          <a href="/dohefes/calculator/" className="text-sm font-medium text-[#1D6F42] hover:underline">
            פתיחת מחשבון ←
          </a>
        </div>
        <div className="bg-white border border-[#D8AD62] rounded-xl p-5 shadow-sm">
          <div className="font-bold text-[#14502F] mb-1">דוח אפס בהתאמה אישית, 1,800 ₪</div>
          <p className="text-sm text-gray-600 mb-3">
            מתארים את הפרויקט בחופשיות ומעלים קבצים (פרוגרמה, Word, Excel, PDF), ואנחנו בונים
            עבורכם את הדוח המלא, כולל שיחת ייעוץ בסיום.
          </p>
          <a
            href={`https://wa.me/972523728828?text=${WHATSAPP_TEXT}`}
            target="_blank"
            className="text-sm font-medium text-[#1D6F42] hover:underline"
          >
            השארת פרטים בוואטסאפ ←
          </a>
        </div>
      </section>

      <section className="bg-[#EAF3EC] border border-[#BFE0CC] rounded-xl p-5 mb-10">
        <div className="font-bold text-[#14502F] mb-2">חשוב לדעת</div>
        <p className="text-sm text-gray-700 leading-relaxed">
          הכלי לא מפרש ולא קובע זכויות בנייה, ולא קובע תמהיל דירות, אלה נתונים שאתם מזינים לפי
          שיקול דעתכם. הכלי מחשב מהם רווחיות בלבד. כל דוח טעון בדיקה, עריכה ואישור של שמאי מקרקעין
          בעל רישיון לפני הגשה לבנק. ר&apos;{" "}
          <a href="/dohefes/terms/" className="underline">
            תנאי השימוש והגבלת האחריות
          </a>
          .
        </p>
      </section>
    </main>
  );
}
