import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const SITE_ORIGIN = "https://haimetkin-lgtm.github.io";
const SITE_URL = `${SITE_ORIGIN}/dohefes`;

const TITLE = "דוח אפס | כלכלת פרויקטים לתמ\"א 38, פינוי בינוי וקומבינציה";
const DESCRIPTION =
  "כלי מקוון להפקת דוחות כדאיות כלכלית ודוחות מעקב לפרויקטי התחדשות עירונית, תמ\"א 38, פינוי בינוי, קומבינציה, קבוצות רכישה ועירוב שימושים. מבית השמאי חיים אטקין, מחבר הספר \"בועת נדל\"ן\".";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: TITLE, template: "%s | דוח אפס" },
  description: DESCRIPTION,
  applicationName: "דוח אפס",
  authors: [{ name: "חיים אטקין, שמאי מקרקעין" }],
  creator: "חיים אטקין",
  publisher: "חיים אטקין, בית שמאי",
  category: "נדל\"ן",
  alternates: { canonical: SITE_URL },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "דוח אפס",
    locale: "he_IL",
    type: "website",
  },
};

function BrandLogo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="30" height="30" viewBox="0 0 72 72" role="img" aria-label="לוגו דוח אפס">
        <rect width="72" height="72" rx="14" fill="#1D6F42" />
        <g stroke="#FFFFFF" strokeOpacity=".55" strokeWidth="1.6">
          <line x1="0" y1="24" x2="72" y2="24" />
          <line x1="0" y1="48" x2="72" y2="48" />
          <line x1="24" y1="0" x2="24" y2="72" />
          <line x1="48" y1="0" x2="48" y2="72" />
        </g>
        <rect x="24" y="24" width="24" height="24" fill="#FFFFFF" />
        <text x="36" y="42" fontFamily="ui-monospace, Consolas, monospace" fontSize="16" fontWeight="700" fill="#14502F" textAnchor="middle">
          0
        </text>
      </svg>
      <span className="text-base font-bold text-[#14502F]">דוח אפס</span>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-gray-50">
        <header className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-sm">
          <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
            <a href="/dohefes/">
              <BrandLogo />
            </a>
            <nav className="flex items-center gap-4 text-xs text-gray-500">
              <a href="/dohefes/calculator/" className="hover:text-gray-800 transition-colors">
                מחשבון
              </a>
              <a href="mailto:haimetkin@gmail.com" className="hover:text-gray-800 transition-colors">
                צור קשר
              </a>
            </nav>
          </div>
        </header>

        {children}

        <footer className="text-center py-6 text-xs text-gray-400 border-t border-gray-100 mt-8 px-4">
          <p className="max-w-2xl mx-auto mb-2">
            כלי חישוב עזר בלבד. כל נתון שהוזן הוא באחריות המזין. אינו מהווה חוות דעת שמאית ואינו
            תחליף לבדיקת שמאי מקרקעין מוסמך. השימוש באתר ובכלי כפוף ל
            <a href="/dohefes/terms/" className="underline hover:text-gray-600">
              תנאי השימוש והגבלת האחריות
            </a>
            , ועצם השימוש מהווה הסכמה להם.
          </p>
          <p>
            © כל הזכויות שמורות לחיים אטקין ו/או לבית שמאי ·{" "}
            <a href="mailto:haimetkin@gmail.com" className="underline hover:text-gray-600">
              haimetkin@gmail.com
            </a>{" "}
            ·{" "}
            <a href="https://www.etkin.co.il" target="_blank" className="underline hover:text-gray-600">
              www.etkin.co.il
            </a>
          </p>
        </footer>

        <Script
          id="free_accessibility_plugin_script"
          src="https://accessibility.f-static.com/site/free-accessibility-plugin/accessibility.min.js?lan=he&place=bottom-right&distance=50"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
