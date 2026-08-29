// מקור אמת יחיד לנתיבי האתר - basePath (ר' next.config.ts) לא מוזרק אוטומטית לתגי <a> רגילים
// (רק ל-next/link, שהריפו הזה לא משתמש בו בכוונה - כל הדפים הקיימים כבר משתמשים ב-<a href>
// עם /dohefes מוזרק ידנית - app/report, app/start, app/tracking). SITE_PATHS מרכז את זה במקום
// אחד במקום לשכפל את המחרוזת "/dohefes" בכל קובץ חדש - כל שינוי עתידי ל-basePath (next.config.ts)
// דורש עדכון כאן בלבד עבור app/payment-return.
//
// **אין להשתמש בזה עבור checkoutUrl של Cardcom** - זו כתובת חיצונית מוחלטת (https://secure.cardcom.solutions/...),
// לא נתיב באתר הזה - basePath לעולם לא רלוונטי לה, ואסור לצרף אליה כאן.
//
// **reconciliation מול gen2-cashflow-ui-implementation (Commit 5b)**: המקור בענף התזרים הכיל
// רק calculator/cashflow/paymentReturn. tracking נוסף כאן. cashflow **נשאר במיפוי** (payment-return
// צריך לדעת להפנות productType='cashFlowAnalysis' למקום-מה בעתיד, ר' ההנחיה המפורשת - "מותר
// להשאיר את הנתיב במיפוי, אך אל תיצור/תחשוף route של /cashflow") - **אין** app/cashflow/page.tsx
// בענף הזה, הקישור הזה כרגע "מת" (לא route קיים), זה בכוונה ומתועד, לא טעות.

const BASE_PATH = "/dohefes";

export const SITE_PATHS = {
  calculator: `${BASE_PATH}/calculator/`,
  calculatorReport: (reportId: string) => `${BASE_PATH}/calculator/?id=${encodeURIComponent(reportId)}`,
  tracking: (reportId: string) => `${BASE_PATH}/tracking/?id=${encodeURIComponent(reportId)}`,
  trackingSample: `${BASE_PATH}/tracking-sample/`,
  /** **אין route בענף הזה** - `app/cashflow/page.tsx` לא הובא (ר' ההערה למעלה). המחרוזת קיימת
   *  רק כדי ש-payment-return.ts ידע למפות productType='cashFlowAnalysis' לכתובת-יעד עתידית,
   *  בלי לנחש/להמציא נתיב אחר כשה-route הזה ייפתח בפועל. */
  cashflow: (reportId: string) => `${BASE_PATH}/cashflow/?id=${encodeURIComponent(reportId)}`,
  paymentReturn: (paymentContextId: string, outcome: "success" | "cancelled") =>
    `${BASE_PATH}/payment-return/?ReturnValue=${encodeURIComponent(paymentContextId)}&outcome=${outcome}`,
} as const;
