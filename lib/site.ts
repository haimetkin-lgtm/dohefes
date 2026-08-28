// מקור אמת יחיד לנתיבי האתר - basePath (ר' next.config.ts) לא מוזרק אוטומטית לתגי <a> רגילים
// (רק ל-next/link, שהריפו הזה לא משתמש בו בכוונה - כל הדפים הקיימים כבר משתמשים ב-<a href>
// עם /dohefes מוזרק ידנית - app/report, app/start, app/tracking). SITE_PATHS מרכז את זה במקום
// אחד במקום לשכפל את המחרוזת "/dohefes" בכל קובץ חדש - כל שינוי עתידי ל-basePath (next.config.ts)
// דורש עדכון כאן בלבד עבור app/payment-return ו-app/cashflow.
//
// **אין להשתמש בזה עבור checkoutUrl של Cardcom** - זו כתובת חיצונית מוחלטת (https://secure.cardcom.solutions/...),
// לא נתיב באתר הזה - basePath לעולם לא רלוונטי לה, ואסור לצרף אליה כאן.

const BASE_PATH = "/dohefes";

export const SITE_PATHS = {
  calculator: `${BASE_PATH}/calculator/`,
  cashflow: (reportId: string) => `${BASE_PATH}/cashflow/?id=${encodeURIComponent(reportId)}`,
  paymentReturn: (paymentContextId: string, outcome: "success" | "cancelled") =>
    `${BASE_PATH}/payment-return/?ReturnValue=${encodeURIComponent(paymentContextId)}&outcome=${outcome}`,
} as const;
