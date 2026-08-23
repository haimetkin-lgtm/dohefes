import type { Metadata } from "next";
import Script from "next/script";
import Logo from "./components/Logo";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;800&family=Frank+Ruhl+Libre:wght@700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-gray-50">
        <header className="print:hidden sticky top-0 z-40 bg-white border-b border-gray-100 shadow-sm">
          <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between">
            <a href="/dohefes/">
              <Logo height={58} />
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

        <footer className="print:hidden text-center py-6 text-xs text-gray-400 border-t border-gray-100 mt-8 px-4">
          <p className="max-w-2xl mx-auto mb-2">
            כלי חישוב עזר בלבד. כל נתון שהוזן הוא באחריות המזין. אינו מהווה חוות דעת שמאית ואינו
            תחליף לבדיקת שמאי מקרקעין מוסמך. השימוש באתר ובכלי כפוף ל
            <a href="/dohefes/terms/" className="underline hover:text-gray-600">
              תנאי השימוש והגבלת האחריות
            </a>
            , ועצם השימוש מהווה הסכמה להם. עלויות ברירת המחדל מבוססות על{" "}
            <a
              href="https://landvalue.org.il/loadedFiles/1783338676-KVFVS.pdf"
              target="_blank"
              className="underline hover:text-gray-600"
            >
              אומדן לשכת שמאי המקרקעין יוני 2026
            </a>
            . המחירון יתעדכן מעת לעת בהתאם ובכפוף לעדכוני לשכת שמאי המקרקעין.
          </p>
          <p>
            © כל הזכויות שמורות לחיים אטקין ו/או לבית שמאי<sup>®</sup> ·{" "}
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
