import Banner from "./components/Banner";

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

export default function Home() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SERVICE_JSON_LD) }} />

      <section className="text-center mb-10">
        <div className="mb-6">
          <Banner />
        </div>
        <h1 className="text-2xl md:text-3xl font-bold text-[#14502F] leading-snug mb-3">
          כדאיות כלכלית והיתכנות לפרויקט נדל&quot;ן – דוחות אפס
        </h1>
        <p className="text-gray-600 max-w-xl mx-auto leading-relaxed">
          מזינים שטחים, תמהיל דירות או סוגי נכסים ומקבלים דוח אפס - כדאיות כלכלית.
        </p>
      </section>

      <section className="grid sm:grid-cols-2 gap-4 mb-10">
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="font-bold text-[#14502F] mb-1">בנה דוח אפס עצמאי, 980 ₪</div>
          <p className="text-sm text-gray-600 mb-3">
            שטחים, תמהיל דירות, עלויות והכנסות. התשלום כולל את דוח האפס וגם את כל דוחות המעקב
            לאותו פרויקט, ללא תשלום נוסף.
          </p>
          <a href="/dohefes/start/" className="text-sm font-medium text-[#1D6F42] hover:underline">
            פתיחת מחשבון ←
          </a>
        </div>
        <div className="bg-white border border-[#D8AD62] rounded-xl p-5 shadow-sm">
          <div className="font-bold text-[#14502F] mb-1 flex items-center gap-1.5">
            דוח אפס בהתאמה אישית, 1,800 ₪
            <span className="relative group inline-flex">
              <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-xs flex items-center justify-center cursor-help leading-none">
                ?
              </span>
              <span className="absolute bottom-full right-0 mb-1.5 w-64 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg leading-relaxed">
                יש לנו סוכן חכם שקורא את התיאור והקבצים שהעלית ותופר מהם שלד דוח אפס מותאם לפרויקט
                שלך: שטחים, תמהיל ונתונים פיזיים. את הערכים הכספיים (מחירי מכירה וכו&apos;) אתה
                משלים בעצמך בטופס שמתקבל.
              </span>
            </span>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            מתארים את הפרויקט במלל חופשי ובהרחבה, מעלים קבצים שיש ברשותכם (פרוגרמה, Word, Excel,
            PDF), ואנחנו בונים עבורכם את המסגרת לדוח האפס המלא, המותאם לפרויקט שלכם.
          </p>
          <a href="/dohefes/custom/" className="text-sm font-medium text-[#1D6F42] hover:underline">
            מעבר לתיאור הפרויקט ←
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
