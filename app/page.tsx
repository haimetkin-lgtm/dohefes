import Banner from "./components/Banner";
import InfoTooltip from "./components/InfoTooltip";
import { CATALOG, formatPriceNis } from "@/lib/catalog";
import { CUSTOM_PRICE_NIS } from "@/lib/supabase";

const SERVICE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Service",
  serviceType: "הפקת דוחות כדאיות כלכלית לפרויקטי התחדשות עירונית",
  provider: { "@type": "Person", name: "חיים אטקין", jobTitle: "שמאי מקרקעין" },
  areaServed: { "@type": "Country", name: "IL" },
  offers: [
    { "@type": "Offer", name: "דוח אפס עצמאי" },
    { "@type": "Offer", name: "דוח אפס בהתאמה אישית" },
    { "@type": "Offer", name: "דוחות מעקב בנייה" },
  ],
};

const FAQ_ITEMS = [
  {
    q: "מי יכול להשתמש בכלי?",
    a: "כל מי שצריך להעריך כדאיות כלכלית של פרויקט התחדשות עירונית: שמאי מקרקעין, בנקים מלווים, יזמים, עורכי דין, מהנדסים, קבלנים, וגם דיירים שרוצים להבין את הפרויקט לפני שהם חותמים.",
  },
  {
    q: "האם דוח אפס מהכלי מספיק להגשה לבנק בלי בדיקה נוספת?",
    a: 'לא. הכלי הוא כלי חישוב עזר, וכל דוח טעון בקרה, בדיקה ואישור של שמאי מקרקעין בעל רישיון לפני שהוא מוגש לבנק.',
  },
  {
    q: "כמה עולה?",
    a: `דוח אפס עצמאי עולה ${formatPriceNis(CATALOG.baseReport.priceAgorot)} לפרויקט, וכולל דוח מלא לאחר רכישה, צפייה בתוצאות, ייצוא Excel והדפסה/PDF. ${CATALOG.trackingReports.displayName} הם מוצר המשך אופציונלי בתשלום נפרד לדוח קיים, לא כלולים במחיר. דוח בהתאמה אישית, שבו סוכן חכם בונה עבורכם את שלד הדוח מתוך תיאור וקבצים, עולה ${CUSTOM_PRICE_NIS.toLocaleString("he-IL")} ₪.`,
  },
  {
    q: "מה ההבדל בין המסלול העצמאי להתאמה האישית?",
    a: "במסלול העצמאי אתם ממלאים בעצמכם את כל נתוני הפרויקט: שטחים, תמהיל דירות, עלויות והכנסות. במסלול בהתאמה אישית מתארים את הפרויקט במלל חופשי ומעלים קבצים שיש ברשותכם, וסוכן חכם קורא אותם ובונה עבורכם את שלד הדוח, ואתם ממלאים בו רק את הערכים הכספיים.",
  },
  {
    q: "האם דוחות המעקב כלולים בדוח האפס?",
    a: `${CATALOG.trackingReports.displayName} אינם כלולים ברכישת דוח האפס. זהו מוצר המשך אופציונלי ונפרד, במחיר ${formatPriceNis(CATALOG.trackingReports.priceAgorot)}, שניתן לרכוש עבור דוח אפס עצמאי קיים כדי לעקוב אחר התקציב מול הביצוע לאורך הבנייה.`,
  },
  {
    q: "האם כלי דירוג הדירות בתשלום?",
    a: "לא. כלי דירוג הדירות למיזמי פינוי־בינוי פתוח לשימוש חינמי מלא, כולל Excel והדפסה/PDF. הדירוג קובע סדר בחירה ואינו משייך דירות אוטומטית.",
  },
  {
    q: "אילו סוגי עסקה נתמכים?",
    a: 'שבעה סוגי עסקה: דוח אפס בסיסי, תמ"א 38 (הריסה ובנייה מחדש), פינוי בינוי, קומבינציה בעין, קומבינצית תמורות, קבוצת רכישה, ומעורב מגורים ותעסוקה.',
  },
  {
    q: "האם המידע שמוזן שמור ופרטי?",
    a: "כן. כל דוח מקבל קישור ייחודי ופרטי, ורק מי שמחזיק בקישור יכול לצפות בו. אין הרשמה או התחברות, הקישור עצמו הוא ה'מפתח' לדוח שלכם.",
  },
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function Home() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SERVICE_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }} />

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
        <p className="text-sm text-gray-500 max-w-xl mx-auto leading-relaxed mt-2">
          לשמאי מקרקעין, בנקים מלווים, יזמים, עורכי דין, מהנדסים, קבלנים, ודיירים שרוצים להבין את
          הפרויקט לפני שהם חותמים.
        </p>
        <a href="/dohefes/sample/" className="inline-block mt-3 text-sm font-medium text-[#1D6F42] hover:underline">
          צפה בדוגמת דוח ←
        </a>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="font-bold text-[#14502F] mb-1">בנה דוח אפס עצמאי</div>
          <p className="text-sm text-gray-600 mb-3">
            שטחים, תמהיל דירות, עלויות והכנסות. כולל דוח מלא, ייצוא Excel והדפסה/PDF. כלי
            דירוג הדירות למיזמי פינוי־בינוי זמין בחינם לכל משתמש.
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

      <section className="bg-white border border-[#BFE0CC] rounded-xl p-5 shadow-sm mb-10">
        <div className="font-bold text-[#14502F] mb-1">{CATALOG.trackingReports.displayName}</div>
        <p className="text-sm text-gray-600 mb-2">
          מוצר המשך אופציונלי ונפרד לדוח אפס עצמאי קיים: מעקב תקציב מול ביצוע לפי שלבי הבנייה, Excel
          והדפסה/PDF. המחיר הוא {formatPriceNis(CATALOG.trackingReports.priceAgorot)} ואינו כלול
          במחיר דוח האפס.
        </p>
        <a href="/dohefes/tracking-sample/" className="text-sm font-medium text-[#1D6F42] hover:underline">
          צפייה בדוגמת דוח מעקב בנייה ←
        </a>
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

      <section className="mb-4">
        <h2 className="font-bold text-[#14502F] text-lg mb-4">שאלות נפוצות</h2>
        <div className="space-y-5">
          {FAQ_ITEMS.map((item) => (
            <div key={item.q}>
              <div className="font-bold text-[#123640] text-sm mb-1">{item.q}</div>
              <p className="text-sm text-gray-600 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
