import Banner from "./components/Banner";
import InfoTooltip from "./components/InfoTooltip";

const SERVICE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Service",
  serviceType: "הפקת דוחות כדאיות כלכלית לפרויקטי התחדשות עירונית",
  provider: { "@type": "Person", name: "חיים אטקין", jobTitle: "שמאי מקרקעין" },
  areaServed: { "@type": "Country", name: "IL" },
  offers: [
    { "@type": "Offer", name: "דוח אפס עצמאי" },
    { "@type": "Offer", name: "דוח אפס בהתאמה אישית" },
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
          כדאיות כלכלית והיתכנות לפרויקט נדל&quot;ן
          <br />
          דוחות אפס
        </h1>
        <p className="text-gray-600 max-w-xl mx-auto leading-relaxed">
          מזינים שטחים, תמהיל דירות או סוגי נכסים ומקבלים דוח אפס - כדאיות כלכלית.
        </p>
        <a href="/dohefes/sample/" className="inline-block mt-3 text-sm font-medium text-[#1D6F42] hover:underline">
          צפה בדוגמת דוח ←
        </a>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="font-bold text-[#14502F] mb-1">בנה דוח אפס עצמאי</div>
          <p className="text-sm text-gray-600 mb-3">
            שטחים, תמהיל דירות, עלויות והכנסות. התשלום כולל את דוח האפס וגם את כל דוחות המעקב
            לאותו פרויקט, ללא תשלום נוסף. כולל טבלאות דירוג למיזמי פינוי בינוי.
          </p>
          <a href="/dohefes/start/" className="text-sm font-medium text-[#1D6F42] hover:underline">
            פתיחת מחולל דוחות אפס ←
          </a>
        </div>
        <div className="bg-white border border-[#D8AD62] rounded-xl p-5 shadow-sm">
          <div className="relative font-bold text-[#14502F] mb-1 flex items-center gap-1.5">
            דוח אפס בהתאמה אישית
            <InfoTooltip text="יש לנו סוכן חכם שקורא את התיאור והקבצים שהעלית ותופר מהם שלד דוח אפס מותאם לפרויקט שלך." />
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
          זכויות בנייה ותמהיל הנכסים מוזנים על ידי המשתמש. הכלי מחשב רווחיות. כל דוח טעון בקרה,
          בדיקה, בחינה ואישור של שמאי מקרקעין בעל רישיון טרם הגשתו לבנק, שירות הניתן להרחבה
          ולרכישה. הדוחות ניתנים להורדה בקובץ אקסל ו/או בקובץ PDF. ראה{" "}
          <a href="/dohefes/terms/" className="underline">
            תנאי השימוש והגבלת האחריות
          </a>
          .
        </p>
      </section>
    </main>
  );
}
