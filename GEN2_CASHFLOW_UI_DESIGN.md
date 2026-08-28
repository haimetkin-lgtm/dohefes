# תכנון UI לתזרים מזומן ומימון (דור 2)

מסמך תכנון בלבד. **אין בו שינוי React, אין חיבור של `computeCashFlow`/`prepareCashFlowInput` לשום
מסך, ואין פרסום.** נכתב על ענף `gen2-cashflow-ui` שנפתח מ-`main` אחרי מיזוג מנוע דור 2 (`GEN2_CASHFLOW_DESIGN.md`,
commits 1-8d) - המנוע קיים ונבדק, לא מופעל. מטרת המסמך: לתכנן איך אדם מקצועי (שמאי, יזם, בנק
מלווה) בפועל ישתמש במנוע הזה, בלי שהדוח הקיים - שכבר עובד ומשמש לקוחות משלמים - ייפגע או יסתבך.

---

## 0. מטרת הממשק ועקרון ה-opt-in

**דוח האפס הקיים ממשיך לעבוד בדיוק כמו היום, ללא שום שינוי, לכל מי שלא נוגע בתזרים בכלל.** זו
לא סיסמה - היא נגזרת ישירות מהעובדה שהמנוע כולו (`lib/calc/cashflow-*.ts`) הוא שכבה תוספתית
שלא נקראת משום מקום ב-`app/` (אומת ב-audit, ר' §2 למטה). מסלול ה-UI החדש חייב לשמר את התכונה
הזו: **אפס שינוי התנהגות לדוח שלא ביקש תזרים**.

הבחירה האדריכלית המרכזית של המסמך הזה: **לא לשבץ את שדות התזרים בתוך `app/calculator/page.tsx`
הקיים** (שכבר ארוך - 1099 שורות, טופס שטוח אחד עם חישוב חי על כל הקשה). התזרים מקבל **מסלול
ותצוגה נפרדים לגמרי**, על אותו UUID של הדוח הקיים - **אותה ארכיטקטורה בדיוק שכבר קיימת ועובדת
היום** עבור "דוח מעקב בנייה" (`app/tracking/page.tsx`, ר' §1.5): route נפרד, עמודת `jsonb` נפרדת
ואופציונלית בטבלה הקיימת, שמירה רציפה (debounced) נפרדת, קישור "מעבר לניתוח תזרים ←" מהדוח
הקיים. זה כבר דפוס מוכר למשתמש (יש היום "מעבר לדוח מעקב בנייה ←" באותו מקום בדיוק) ומוכח בקוד -
לא תבנית חדשה שצריך להמציא ולהוכיח.

**הבדל מכריע מול התקדים** (ר' §0.1 מיד למטה): דוח המעקב (`tracking`) **כלול במחיר** דוח הכדאיות
- כתוב במפורש ב-`/start` היום ("כל דוחות המעקב לאותו פרויקט לאורך הביצוע, ללא תשלום נוסף"). **ניתוח
התזרים אינו כלול** - הוא מוצר נפרד בתשלום נפרד. שני הכלים חולקים את אותה **תבנית ארכיטקטונית**
(route נפרד, עמודת `jsonb` נפרדת, שמירה עצמאית) אך **לא** את אותו מודל גישה - זו נקודה שחוזרת
לאורך כל המסמך, כדי שלא ייווצר רושם ששני הכלים "אותו דבר" רק כי הם בנויים אותו דבר.

```
דוח כדאיות בסיסי (היום, ללא שינוי)          ניתוח תזרים ומימון מתקדם (חדש, opt-in, בתשלום נפרד)
─────────────────────────────────          ──────────────────────────────────────────────────
/calculator            (טופס שטוח)          /cashflow?id=<uuid>   (wizard בן 7 שלבים)
computeProject()        (Gen1, קיים)         prepareCashFlowInput() + computeCashFlow()  (Gen2)
ReportView.tsx          (ללא שינוי)          CashFlowReportView.tsx (חדש)
dohefes_reports.inputs  (ללא שינוי)          dohefes_reports.cashflow_assumptions (חדש, אופציונלי)
תשלום: 980 ₪ (דוח הכדאיות)                   תשלום נפרד: 980 ₪ (entitlement נפרד, ר' §0.1)
```

---

## 0.1 מודל המוצר והתשלום - החלטה מאושרת

**ניתוח התזרים והמימון הוא מוצר נוסף ונפרד מדוח האפס, לא הרחבה כלולה.** מחירו 980 ₪ - זהה
מספרית לדוח האפס, אך **entitlement נפרד לגמרי**. רכישת דוח האפס **אינה** פותחת אוטומטית את ניתוח
התזרים. ניתוח התזרים נפתח **מתוך** דוח קיים (שייך לאותו `reportId`), אך דורש תשלום נוסף משלו.

### 0.1.1 המנגנון הקיים היום - נבדק בפועל, לא הונח

`app/start/page.tsx` הוא נקודת התשלום היחידה הקיימת היום: בחירת סוג עסקה -> הפניה (redirect,
לא iframe) לקישור Cardcom מוכן-מראש דרך משתנה סביבה (`NEXT_PUBLIC_CARDCOM_LINK_BASIC`, מוזרק
בזמן build דרך `deploy.yml`) -> `SuccessRedirectUrl`/`FailedRedirectUrl` מצורפים כפרמטרי query
על הקישור. `SuccessRedirectUrl` היום: `${SITE_URL}/calculator/?paid=true&dealType=${selected}`.
בצד `/calculator`, `useEffect` (שורות 299-323) קורא `paid=true` מה-URL, יוצר רשומת `dohefes_reports`
חדשה עם `payment_status: "paid"`, ומחליף את ה-URL ב-`?id=<uuid>` הקבוע. **שני מוצרים נוספים
כבר קיימים באותה תבנית בדיוק** - `NEXT_PUBLIC_CARDCOM_LINK_CUSTOM` (1,800 ₪, `app/custom`)
ו-`NEXT_PUBLIC_CARDCOM_LINK_CONSULTATION` (1,180 ₪, `ConsultationCTA.tsx`) - כל אחד עם קישור
Cardcom נפרד (מחיר קבוע מוגדר בצד Cardcom עצמו, לא נשלח דינמית בפרמטר) ו-`SuccessRedirectUrl`
משלו. **זה בדיוק "אותו טופס ותהליך תשלום, זהות מוצר נפרדת"** שההוראה מבקשת - שלושה מוצרים כבר
משתמשים בתבנית הזו, לא צריך להמציא אותה, רק להוסיף מוצר רביעי לפיה: `NEXT_PUBLIC_CARDCOM_LINK_CASHFLOW`.

**ממצא חשוב, לתעד ביושר**: התהליך הקיים **כולו client-side** - האתר הוא static export ל-GitHub
Pages (`deploy.yml`, `actions/deploy-pages`), **אין שרת/serverless function בפרויקט בכלל** (נבדק:
`find`/`grep` רוחבי, 0 תוצאות ל-webhook/function). כלומר גם ה-"אימות תשלום" של דוח האפס היום
הוא בפועל **אך ורק** `paid=true` ב-query string, ללא אימות שרת. §0.1.4 למטה מציג את שתי
האפשרויות (לשמר את אותה רמת סיכון כמו המוצר הקיים, או לבנות תשתית אימות אמיתית חדשה) בלי
להעמיד פנים שתשתית כזו כבר קיימת.

### 0.1.2 שדות מועברים בתהליך התשלום

לפי העיקרון המחייב, מתורגם לשדות בפועל של התהליך הקיים:

| שדה מבוקש | מימוש בפועל בתהליך הקיים |
|---|---|
| `productType` | ערך קבוע חדש, `"cashFlowAnalysis"` (מול `"baseReport"` הקיים מרומז) - **לא נשלח ל-Cardcom עצמו** (הקישור כבר קובע את המחיר), אלא **מקודד ב-`SuccessRedirectUrl`** ונכתב ל-Supabase באסמכתה, ר' §0.1.3 |
| `reportId` | UUID קיים של הדוח - **חובה שיהיה קיים לפני התחלת התשלום** (ר' §0.1.4 סעיף "תשלום עבור דוח אחד") - מקודד ב-`SuccessRedirectUrl`: `.../cashflow/?id=<reportId>&paid=true` |
| `amountNis` | `CASHFLOW_ANALYSIS_PRICE_NIS` - קבוע חדש ב-`lib/supabase.ts`, **ליד** `BASIC_PRICE_NIS` הקיים (לא בתוכו, לא משוכפל) - ר' §0.1.4 "מקור אמת יחיד למחיר" |
| `returnUrl` | `SuccessRedirectUrl`/`FailedRedirectUrl`, בדיוק כמו היום, אך מצביעים ל-`/cashflow/?id=<reportId>...` במקום `/calculator/?...` |

### 0.1.3 הרשאות (entitlement) - עקרון מאושר, טיפוס מתוכנן, Supabase לא משתנה עדיין

**אסור להשתמש ב-`payment_status`/`paid` הקיים על `dohefes_reports` בשביל ניתוח התזרים.** השדה
הזה כבר מייצג "דוח האפס שולם" - שימוש חוזר בו לתזרים היה בדיוק התקלה שהמשתמש מזהיר מפניה: רכישת
דוח האפס הייתה "פותחת" את התזרים בטעות, כי שניהם היו קוראים אותו boolean.

**כיוון מאושר**: מודל entitlement כללי, לא שני booleans נפרדים בטבלה אחת (שגם הם עדיפים על
boolean משותף, אך מודל כללי מתרחב טוב יותר למוצר חמישי עתידי בלי להוסיף עמודה בכל פעם):

```ts
// תכנון בלבד - טיפוס לא נכתב בקוד, אין טבלה חדשה ב-Supabase עדיין
type ProductType = "baseReport" | "cashFlowAnalysis";

interface ProductEntitlement {
  reportId: string;         // uuid, מפנה ל-dohefes_reports.id
  productType: ProductType;
  paymentStatus: "pending" | "paid";
  purchasedAt: string | null;
  paymentReference: string | null;  // אסמכתת Cardcom, כשתהיה זמינה
}
```

**"אין לשנות עדיין Supabase" (הוראה מפורשת) - מה זה אומר בפועל כאן**: אין ליצור טבלת
`dohefes_product_entitlements` (או שם דומה) בשלב התכנון הזה. כשיגיע commit היישום הרלוונטי
(ר' §9, שלב חדש שנוסף), ההצעה התכנונית היא טבלה נפרדת (לא עמודה נוספת על `dohefes_reports`,
כי entitlement הוא ישות ברמת "מוצר×דוח", לא תכונה של הדוח עצמו) - **אך זו עדיין החלטת יישום
עתידית, לא מבוצעת עכשיו**.

### 0.1.3א - עדכון: תשתית האימות האמיתית כבר קיימת ורצה (2026-08-28)

**את §0.1.1/§0.1.4/§10-סעיף-6 יש לקרוא כעת לאור עובדה חדשה, לא כפי שנכתבו במקור**: כשהסעיפים
האלה נכתבו, "אין שרת בפרויקט בכלל" היה נכון עובדתית. זה כבר **לא** נכון - ענף
`secure-payment-deployment` מוזג ל-`main`, וה-migration שמקים אותו (`dohefes_payment_orders`,
`dohefes_product_entitlements`, RLS ללא policies אנונימיות, RPCs) **רץ בפועל** מול הפרויקט
המרוחק (ר' `SECURE_PAYMENT_DEPLOYMENT_RUNBOOK.md` §3 "מצב בפועל"). שלוש Edge Functions
(`dohefes-create-payment-order`, `dohefes-cardcom-payment-indicator`, `dohefes-get-product-access`)
קיימות בקוד, מוכנות לפריסה (טרם פרוסות בפועל - זה עתידי, ר' §0.1.3 ברנבוק).

**המשמעות**: "אפשרות 2" ב-§0.1.4 למטה (אימות אמיתי בצד שרת) **הוכרעה בפועל** - היא **חובה**,
לא עוד שאלה פתוחה. §10 סעיף 6 (למטה) **הוכרע**: אימות תשלום עובר תמיד דרך
`dohefes-get-product-access`, לעולם לא query parameter. **המודל ב-§0.1.3 המקורי (טבלת
`ProductEntitlement` הכללית שהדפדפן היה קורא ישירות)`** גם הוא מוחלף בפועל: הדפדפן **לעולם לא**
קורא לטבלאות (`dohefes_payment_orders`/`dohefes_product_entitlements`) ישירות - גם לא לקריאה
בלבד, גם לא עם ה-anon key - כי אין להן שום RLS policy אנונימי (deny-all בכוונה). כל בדיקת סטטוס,
כולל עבור `cashFlowAnalysis`, עוברת אך ורק דרך `dohefes-get-product-access` (`{status: "active" |
"pending" | "unavailable"}` - ר' `supabase/functions/dohefes-get-product-access/index.ts`).

**מיפוי מדויק בין השדות המתוכננים כאן לבין מה שכבר קיים בקוד**:

| מתוכנן כאן (§0.1.2/§0.1.3) | קיים בפועל היום |
|---|---|
| `productType:"cashFlowAnalysis"` | ✅ כבר תומך - `_shared/payment-products.ts` מכיל `"cashFlowAnalysis"` לצד `"baseReport"`, כולל תלות שדוח הבסיס כבר `paid` (ר' רנבוק §6) |
| `ProductEntitlement` (טיפוס מתוכנן) | ✅ קיים כטבלה אמיתית, `dohefes_product_entitlements` |
| בדיקת סטטוס תשלום מהדפדפן | ✅ קיימת - `dohefes-get-product-access`, לא הטבלה ולא `payment_status` |
| יצירת הזמנה + כתובת checkout | ✅ קיימת - `dohefes-create-payment-order` (מחזיר `{orderId, checkoutUrl, accessToken, status:"pending"}`) |
| מניעת חיוב כפול (§0.1.4) | ✅ קיימת ברמת שרת (claim/lease אטומי + partial unique index) - **חזקה יותר** ממה שתוכנן כאן (`insertedRef`/`useRef` בצד לקוח בלבד) |

**מה עדיין באמת פתוח**, ורק זה: ה-**UI עצמו** שקורא לפונקציות האלה (§3-§9 למטה) - כלום מזה לא
נכתב בעבר. §0.1.5 ולמטה (חלק ב' של הביקורת מ-2026-08-28) קובעים את כתובות ה-URL הסופיות
לזרימת החזרה מ-Cardcom, שהיו עד כה placeholder בלבד.

### 0.1.5 - כתובות סופיות לזרימת הרכישה/חזרה (סוכם 2026-08-28, מתוקן 2026-08-28 - ר' 0.1.5א)

**ארבע הכתובות, ועיקרון-העל שמחבר ביניהן**: אף אחת מהן לא "יודעת" לבד שהתשלום אושר - כל אחת
בודקת בעצמה מול `dohefes-get-product-access` בכל טעינה, בלי לסמוך על כתובת ה-URL שהביאה אליה.

| # | תפקיד | כתובת (יחסית ל-basePath `/dohefes`) |
|---|---|---|
| 1 | חזרה מ-Cardcom, הצלחה | `/payment-return/?outcome=success` |
| 2 | חזרה מ-Cardcom, ביטול/כשל | `/payment-return/?outcome=cancelled` |
| 3 | רכישת `cashFlowAnalysis` | `/cashflow/?id=<reportId>` (מצב "לא נרכש עדיין", ר' §3.1 - **אותה כתובת** כמו #4, לא כתובת נפרדת - ר' הסבר למטה) |
| 4 | המוצר עצמו לאחר הרשאה | `/cashflow/?id=<reportId>` (מצב "נרכש", אותה כתובת, ה-wizard/תוצאות) |

**למה #3 ו-#4 הן אותה כתובת, לא שתיים נפרדות**: זה בדיוק המודל התלת-מצבי שכבר **הוכרע** ב-§3.1/§3.2
למטה (לפני העדכון הזה) - `/cashflow/?id=` בודק בעצמו (`dohefes-get-product-access`) האם המוצר
נרכש, ומציג מסך רכישה **או** תוכן בפועל **מאותה כתובת בדיוק**, בלי הפניה נוספת. זה שונה מהתקדים
`/start` מול `/calculator` (לדוח הבסיס) - שם יש היסטורית שתי כתובות כי `/start` נבנה **לפני**
שהיה `reportId` בכלל (הדוח נוצר רק אחרי התשלום). כאן ה-`reportId` **כבר קיים** (תנאי סף, ר' §10)
לפני שהרכישה מתחילה - אין סיבה טכנית לשתי כתובות, ואיחוד לכתובת אחת מונע מצב שבו קישור ישן
("לרכישה") ממשיך לעבוד גם אחרי שהמוצר כבר נרכש. **אם בעתיד יוחלט אחרת** (שתי כתובות נפרדות),
זו חריגה מהמסמך הזה שדורשת עדכון מפורש כאן, לא הנחה בשקט.

**כתובת #1/#2 - אותה כתובת בפועל, `outcome` הוא רמז ניסוח בלבד, לעולם לא סטטוס תשלום (כלל 8)**:
שתיהן מובילות לאותו קובץ (`app/payment-return/page.tsx`, טרם נכתב) - ה-querystring
`outcome=success|cancelled` קובע רק איזה טקסט ראשוני מוצג ("מאמתים את התשלום..." מול "נראה
שהתשלום לא הושלם, בודקים בכל זאת...") - **שתיהן**, בלי יוצא מהכלל, קוראות ל-`dohefes-get-product-access`
ומחליטות לפי התשובה בפועל, לא לפי `outcome`. גם משתמש שמקליד ידנית `?outcome=success` (ר' §0.1.6,
תרחיש בדיקה) לא מקבל שום דבר מעבר לרענון תצוגה - אין השפעה על סטטוס אמיתי.

### 0.1.5א - תיקון 2026-08-28: קישור נכון בין החזרה מ-Cardcom להזמנה (ReturnValue/paymentContextId)

**הסעיף הקודם (0.1.5) הניח בטעות ש-`localStorage` יחיד ("רשומת pending payment אחת") מספיק,
ושלא צריך לקרוא שום דבר מה-URL בחזרה.** זה שגוי בשני מובנים, ותוקן:

**(א) תיעוד Cardcom הרשמי נבדק בפועל** (`cardcomapinametovalue.zendesk.com`, מאמר "Low profile
interface - EN (Step 1+2)", 2026-08-28) - פרמטר #18, `ReturnValue`: **"Value to transfer to the
clearing system to be returned on the success page / INDICATOR"** - כלומר Cardcom **כן** מתעדת
במפורש ש-`ReturnValue` (אותו ערך שנשלח ביצירת ה-LowProfile session, ר' §0.1.5ב למטה) חוזר גם
לעמוד ההצלחה, לא רק ל-Indicator. **אין להתעלם מזה** - זה בדיוק המזהה שצריך לקשר בין החזרה
להזמנה הנכונה, גם כשיש כמה הזמנות פתוחות בו-זמנית (כמה לשוניות).

**(ב) אבל: אין בתיעוד דוגמת query string מפורשת דווקא ל-`SuccessRedirectUrl`/`ErrorRedirectUrl`
עצמן** (בניגוד ל-`IndicatorUrl`, שיש לה דוגמה מפורשת: `...Indicator.aspx?terminalnumber=1000&...`).
**וממצא קריטי מאותה דוגמה עצמה**: הדוגמה הזו כותבת `terminalnumber`/`lowprofilecode` (lowercase)
למרות שבכל שאר המסמך אותם פרמטרים מוצהרים ב-PascalCase (`TerminalNumber`/`LowProfileCode`) -
**חוסר-עקביות casing מתועד רשמית על ידי Cardcom עצמה**, לא רק חשש תיאורטי. בנוסף, אותו מסמך
מזהיר במפורש (סעיף `IndicatorUrl`): **"Do not rely on the success page, its an open for bugs,
the card holder can receive POPUP and exit the page and then your server did not know about
making the order."** - קרי, Cardcom עצמה אומרת שדף ההצלחה עלול שלא לטעון כלל (popup שנסגר)
ושה-Indicator (server-to-server, שכבר ממומש ומאומת - ר' `dohefes-cardcom-payment-indicator`) הוא
מקור האמת היחיד למצב תשלום. **זו בדיוק ההצדקה הרשמית לארכיטקטורה שכבר קיימת כאן** - עמוד החזרה
לעולם לא קובע סטטוס, רק מנחה לאיזו הזמנה לשאול.

**המסקנה ההנדסית**: לקרוא את `ReturnValue` מה-querystring של עמוד החזרה **case-insensitively**
(להתאים כל מפתח ששווה ל-`"returnvalue"` אחרי `toLowerCase()`, לא רק `ReturnValue` המדויק), **ולא
להניח שהוא בהכרח יגיע** - אם הוא חסר, זו אפשרות תקנית וצפויה (לא שגיאה), ר' זרימה מתוקנת למטה.

### 0.1.5ב - `paymentContextId`: המזהה הציבורי, המקור, והמגבלות עליו

**המקור**: `provider_order_reference` הפנימי (כבר קיים בקוד - `generateProviderOrderReference()`
ב-`_shared/payment-security.ts`: 16 בתים אקראיים מוצפנים → `"po_" + hex`, **לא UUID, לא נגזר
מקלט לקוח בשום צורה**) - זה בדיוק הערך שכבר נשלח ל-Cardcom כ-`ReturnValue` בכל בקשת יצירת
LowProfile session (`advanceOrderToCheckout` → `cardcomClient.createLowProfile({returnValue:
order.providerOrderReference, ...})`, `_shared/payment-order-service.ts`).

**מה בוצע בפועל (commit נפרד, ר' §9 המעודכן)**: `dohefes-create-payment-order` **כבר מחזיר**
אותו בתגובת ההצלחה, תחת שם ציבורי מכוון - `paymentContextId` - **לא** `providerOrderReference`
ולא שום שם שחושף שמדובר בקארדקום. תגובת ה-200 המלאה כעת: `{orderId, checkoutUrl, accessToken,
paymentContextId, status:"pending"}`. נבדק (`payment-order-service.test.ts`, "paymentContextId -
זהה בדיוק ל-ReturnValue..."): `paymentContextId` בתגובה שווה **בדיוק** ל-`returnValue` שנשלח
בפועל ל-`cardcomClient.createLowProfile` - לא ערך מקורב, לא מחושב מחדש בנפרד.

**כלל האבטחה, ואיך הוא ממומש בפועל** (לא רק כהצהרה):
- `paymentContextId` הוא מזהה הקשר בלבד - **לא** secret, **לא** access token, **לא** הוכחת תשלום.
- ידיעתו **לבדה** אינה מאפשרת גישה, קריאה או שינוי כלשהם: הוא **לעולם לא נשלח בחזרה לשום Edge
  Function** - לא ל-`dohefes-get-product-access` (מקבלת רק `reportId`/`productType`+`X-Access-Token`,
  ללא שדה כזה כלל בחוזה שלה), ולא לשום endpoint אחר. הוא נשאר **local-only** בצד הלקוח, משמש
  אך ורק כמפתח למפת ה-`pendingPurchases` (ר' §0.1.5ג). **נבדק במפורש** (בדיקת-תיעוד שנייה ב-
  `payment-order-service.test.ts`): אין שום מתודת `PaymentOrderDatabase` שמאפשרת חיפוש לפי
  `providerOrderReference`/`paymentContextId`/`returnValue` - מבנית, אין דרך לשאול עליו בכלל.
- ההרשאה בפועל תמיד וממשיכה להיקבע רק על ידי: Indicator מאומת (server-to-server, קיים) → RPC
  אטומי (`dohefes_finalize_verified_payment`, קיים) → `dohefes-get-product-access` (קיים) - שרשרת
  שלמה שלא נוגעת ב-`paymentContextId` בשום נקודה.

### 0.1.5ג - אחסון בצד הלקוח: שני מאגרים נפרדים (תוקן 2026-08-28 - ר' 0.1.5ז)

**פער אמיתי שנמצא ותוקן**: הגרסה הקודמת של הסעיף הזה תכננה מפה יחידה (`dohefes.pendingPurchases`)
שנמחקת ברגע `active`. **אבל ה-access token ששוכן בה הוא ה-credential היחיד לגישה למוצר** -
מחיקתו הייתה מונעת רענון של `/cashflow`, חזרה למוצר ביום אחר, פתיחה מחדש מאותו מכשיר, ובדיקת
entitlement חוזרת אחרי `revoked`/`refunded`. **תוקן**: שני מאגרים נפרדים, ומודול ממומש בפועל
(`lib/payment/payment-storage.ts`, 28 בדיקות - ר' §0.1.6) - לא רק תכנון עוד.

**מאגר 1 - `dohefes.pendingPurchases`** (זמני, לשימוש מעבר-וחזרה מ-Cardcom בלבד):

```ts
type PendingPurchases = Record<string /* paymentContextId, מהשרת */, {
  reportId: string;
  productType: ProductType;
  accessToken: string;
  createdAt: string; // ISO, לצורך TTL
}>;
```

**מאגר 2 - `dohefes.productAccess`** (קבוע, ה-credential לגישה חוזרת למוצר שכבר נרכש):

```ts
type ProductAccess = Record<string /* `${reportId}:${productType}` */, {
  accessToken: string;
  activatedAt: string; // ISO
  lastVerifiedAt: string; // ISO, מתעדכן בכל בדיקה חוזרת מוצלחת
}>;
```

**מעבר בין המאגרים - סדר פעולות מחייב, לא "תעביר את זה"** (`promoteToActive` ב-
`payment-storage.ts`): (1) קריאת ה-`accessToken` מרשומת ה-pending, (2) כתיבתו ל-`productAccess`,
(3) **רק אם** הכתיבה הצליחה בפועל (נבדק - לא רק "לא זרקה חריגה", גם לא quota error) - מחיקת
רשומת ה-pending. אם הכתיבה נכשלת - הפונקציה מחזירה `ok:false`, **ורשומת ה-pending נשארת שלמה**
(נבדק: "כשל כתיבה ל-productAccess (quota) - pending נשאר שלם") - כדי שניסיון חוזר בטעינה הבאה
עדיין ימצא את ה-token, במקום לאבד אותו.

**כללים משותפים לשני המאגרים**:
- **המפתח ב-pending הוא `paymentContextId` שהשרת יצר** - הלקוח לעולם לא ממציא מפתח.
- **access token לעולם לא ב-URL** - רק ב-`localStorage`, ונשלח בחזרה רק ב-header `X-Access-Token`.
- **אין פרטי Cardcom או PII נשמרים** באף אחד מהמאגרים.
- **כמה לשוניות/הזמנות לא דורסות זו את זו** - מבנית: `paymentContextId` ייחודי לכל הזמנה, המאגר
  שומר לפי מפתח, לא דורס ערך תחת מפתח שונה (נבדק: "שתי הזמנות עם paymentContextId שונה נשמרות
  שתיהן").
- **ניקוי ממוקד בלבד** - `active` מוחק **רק** את מפתח ה-pending שאומת (נבדק: "קידום לשונית אחת
  לא מוחק pending של לשונית אחרת"); `revokeActiveAccess` (revoked/refunded/unavailable) מוחקת
  **רק** את `reportId:productType` הספציפי מ-`productAccess`, לא נוגעת במוצר אחר על אותו דוח או
  באותו מוצר על דוח אחר (נבדק).
- **`productAccess` ללא TTL אוטומטי** - בניגוד ל-pending, המוצר נרכש לשימוש חוזר, לא חד-פעמי -
  `cleanupPending` (המנקה pending לפי TTL) **לעולם לא נוגעת** ב-`productAccess` (נבדק במפורש).
  ראה §0.1.5ז למגבלות שנובעות מהיעדר תפוגה אוטומטית.
- **אם אין `paymentContextId` תקין בחזרה** - מסך "unavailable" גנרי, בלי ניחוש "ההזמנה האחרונה"
  (ר' §0.1.5ח לזרימת fallback הנכונה, לא ניחוש).

### 0.1.5ד - TTL של `pendingPurchases`: 24 שעות, מדיניות שלנו - לא ערך מתועד של Cardcom

**נבדק בפועל, לא הונח**: תיעוד Cardcom הרשמי (שני המאמרים העיקריים שנקראו על LowProfile,
`cardcomapinametovalue.zendesk.com`) **אינו מציין שום זמן תפוגה רשמי** ל-session של LowProfile
עצמו. **לכן**: אין להתייחס לשום TTL כאן כ"זמן Cardcom" - `PENDING_TTL_MS` (`lib/payment/payment-storage.ts`)
= **24 שעות, מדיניות שלנו בלבד**, שמרנית בכוונה - מספיק זמן לחזור לתשלום שהתחיל ולא הושלם (כולל
3DS/העברה לאפליקציית בנק), קצר מספיק שלא יצטבר "זבל" לצמיתות. ה-30 דקות שהופיעו כאן בטיוטה קודמת
**היו ניחוש שגוי** שהוצג כאילו הוא קשור למשך session אמיתי אצל Cardcom - תוקן.

**מגבלות מפורשות על ה-TTL**: (1) **לא מוחק pending פעיל באמצע polling** - `resolvePendingByContext`
מריץ ניקוי TTL לפי הזמן שקיבל, לא לפי טיימר עצמאי - polling תכוף (כל 2-5 שניות, ר' §0.1.5ה) לא
"מזדמן" לחצות את סף ה-24 שעות; (2) `productAccess` **אינו** כפוף לאותו TTL כלל (ר' §0.1.5ג) - אם
נשמר ללא תפוגה אוטומטית, הוא נשאר במכשיר עד ניקוי נתוני הדפדפן, `revoked`/`refunded` מהשרת, או
פעולה מפורשת של המשתמש (ר' §0.1.5ז).

### 0.1.5ה - `sessionStorage` מול `localStorage` - נבדק, לא הונח

חל על שני המאגרים כאחד (`pendingPurchases`+`productAccess`) - שניהם צריכים לשרוד מעבר לחיי
לשונית בודדת (`productAccess` בפרט - כל מטרתו לשרוד ליום אחר). **נבדק**: הזרימה הקיימת (למוצר
הבסיסי, `app/start/page.tsx`) היא הפניה מלאה של הדפדפן (`window.location`, לא iframe/popup - ר'
§0.1.1) - במקרה כזה `sessionStorage` **היה שורד** טכנית לצורך ה-pending בלבד (לא ל-`productAccess`,
שצריך לשרוד ממילא ימים/שבועות - שם `sessionStorage` פסול מבנית, לא רק "לא אידיאלי"). **גם עבור
ה-pending, `localStorage` נבחר, מנומק**:

1. **אזהרת Cardcom הרשמית עצמה** (0.1.5א): "the card holder can receive POPUP and exit the
   page" - הזרימה הרשמית של Cardcom לא מבטיחה הפניה מלאה באותה לשונית תמיד (PayPal/Bit - שני
   כפתורי תשלום חלופיים באותו עמוד LowProfile, שמעבירים לאפליקציה/אתר חיצוני).
2. **מצבי רקע במובייל** - דפדפן מושהה בזמן 3DS/אימות בנק ארוך עלול לאבד `sessionStorage`.

**ההקשחה שמפצה על הבחירה ב-`localStorage`**: TTL של 24 שעות ל-pending בלבד (0.1.5ד); שמות מפתח
ייעודיים (`dohefes.pendingPurchases`/`dohefes.productAccess`, לא namespace גנרי); ניקוי מיידי
וממוקד של pending שאומת (0.1.5ג); **אין סקריפטים צד-שלישי בעמודי התשלום** - נבדק: `package.json`
כולל רק `xlsx`+`@supabase/supabase-js` כתלויות ריצה - תנאי-סף ל-`app/cashflow`/`app/payment-return`
העתידיים: לא להוסיף סקריפט צד-שלישי לעמודים האלה בלי בדיקת ההשפעה על שני המאגרים במפורש.

### 0.1.5ו - זרימת `/payment-return/` המתוקנת (שלבים 1-8)

1. **קריאת ה-`ReturnValue`** מה-querystring, **case-insensitive** (0.1.5א).
2. **איתור הרשומה** ב-`pendingPurchases` (`resolvePendingByContext`, מריץ ניקוי TTL קודם). אם
   `returnValue` חסר, לא נמצא, או פג-תוקף → §0.1.5ח (fallback לפי `reportId`+`productType` אם
   ידוע מה-URL של הדף עצמו) ואז §0.1.5ט ("unavailable") אם גם זה לא מניב תוצאה חד-משמעית.
3. **קריאה ל-`dohefes-get-product-access`** עם `reportId`/`productType`/`accessToken` מהרשומה.
4. `active` → **`promoteToActive`** (0.1.5ג - כותב ל-`productAccess` **לפני** מחיקת ה-pending,
   לא מוחק קודם), ואז מעבר (`router.replace`) לכתובת #4 (`/cashflow/?id=<reportId>`), בלי דגל
   ב-URL. אם `promoteToActive` מחזירה `ok:false` (כשל כתיבה) - **לא** ממשיכים למחיקה/מעבר -
   מוצגת הודעת שגיאה זמנית עם "נסה שוב" (לא "unavailable" - זו לא בעיית הרשאה, אלא כשל storage
   מקומי).
5. `pending` → polling מוגבל עם backoff: כל 2 שניות (עד כ-10 ניסיונות), אחר כך כל 5 שניות, עד
   תקרה כוללת (מוצע 90 שניות).
6. `unavailable` → §0.1.5ט, הודעה גנרית + `revokeActiveAccess` **אם** קיימת רשומת `productAccess`
   ישנה לאותו `reportId`+`productType` (מכסה `revoked`/`refunded` שהתגלו רק עכשיו, ר' §0.1.5ז).
7. **תום זמן (timeout)** - כפתור "בדוק שוב" ידני, ממשיך לבדוק **אותה** הזמנה, **לא** קורא
   ל-`dohefes-create-payment-order` מחדש.
8. `outcome=success|cancelled` הוא **תמיד** רמז ניסוח בלבד - אף שלב לא בודק אותו לצורך החלטה.

### 0.1.5ז - מגבלות שיש להציג ביושר, והודעה למשתמש אחרי רכישה

**בהיעדר משתמשים מחוברים או מנגנון recovery** (לא בהיקף המסמך הזה, ר' §10):
- הגישה נשמרת **במכשיר ובדפדפן שבהם בוצעה הרכישה** בלבד.
- ניקוי `localStorage`/נתוני האתר עלול לאבד את הגישה המקומית.
- **אין כרגע שחזור אוטומטי במכשיר אחר** - אם המשתמש עובר מכשיר, אין דרך היום לשחזר גישה בלי
  לפנות אליי ישירות (אין מנגנון "שלח לי קישור" - ר' למטה, לא נבנה בלי החלטה נפרדת).
- אין `accessToken` בשום URL רגיל, query string, לוג, או analytics - נבדק (`lib/payment/payment-storage.test.ts`,
  "אין access token בפלט שגיאה/חריגה").
- **לא נבנה כרגע** קישור שיתוף או מערכת שחזור - דורש החלטה נפרדת (טרייד-אוף בין נוחות שחזור
  לחשיפת credential בקישור נשלח/מאוחסן במקום נוסף).

**הודעה קצרה שתוצג למסך המוצר מיד אחרי רכישה מוצלחת** (`status:"active"` לראשונה):

> הגישה למוצר נשמרת בדפדפן הזה. מומלץ לא למחוק את נתוני האתר.

### 0.1.5ח - Fallback כשה-`ReturnValue` חסר: איתור לפי `reportId`+`productType`

`/payment-return/` **לעולם לא מנחשת הזמנה** (0.1.5ג). **אבל** אם המשתמש חוזר **ידנית** אל
`/dohefes/cashflow/?id=<reportId>` (לא דרך `/payment-return/` בכלל - למשל שמר את הקישור וחזר
מאוחר יותר, או ש-`ReturnValue` אבד בדרך) - עמוד `/cashflow` עצמו (לא `/payment-return`) רשאי
להשתמש ב-`resolvePendingByReportAndProduct(storage, reportId, productType, now)` כדי לאתר
**התאמה מדויקת** ב-`pendingPurchases` לפי `reportId`+`productType` הידועים מה-URL של העמוד הזה
עצמו (לא מנחש `reportId` - הוא כבר ב-URL), ולבדוק אותה מול השרת לפני הצגת מסך רכישה. **אם יש
יותר מהתאמה אחת** (לא אמור לקרות בזרימה תקינה - claim/lease מונע שתי הזמנות פעילות לאותו
report+product בשרת - אך המודול לא סומך על כך) - `resolvePendingByReportAndProduct` מחזירה
`{ok:false, reason:"ambiguous"}`, **לא בוחרת אחת מהן** - מוצג מסך רכישה רגיל (לא "unavailable" -
פשוט מתעלמים מהמצב הלא-חד-משמעי ומתחילים זרימת רכישה נקייה, שתעבור בעצמה דרך ה-claim בשרת).

### 0.1.5ט - מסך "unavailable"/אין הקשר - זהה בכל מקרה, לא חושף פרטים

הודעה גנרית **זהה** לכל אחת מהסיבות הבאות - `ReturnValue` חסר, לא נמצא ב-pending, פג-תוקף, טוקן
שגוי, מוצר שלא נרכש, או `revoked`/`refunded` (תואם במדויק את התגובה האחידה של
`dohefes-get-product-access` עצמה) - עם קישור חזרה ל-`/cashflow/?id=<reportId>` (אם `reportId`
ידוע; אם לא - קישור כללי חזרה לדוח, בלי לנחש `reportId`).

### 0.1.6 - שכבת האחסון: ממומשת ובדוקה בפועל (`lib/payment/payment-storage.ts`)

**בניגוד לשאר §0.1.5 (עדיין תכנון בלבד, אין React) - שכבת האחסון עצמה כבר ממומשת ובדוקה**, כמודול
טהור ללא תלות ב-React/`window` (ר' `StorageLike` - הזרקת storage, לא גישה ישירה ל-`window.localStorage`).
28 בדיקות (`lib/payment/payment-storage.test.ts`), כולן ירוקות:

- `active` מעביר token ל-`productAccess` **לפני** מחיקת ה-pending; כשל כתיבה ל-`active` **לא**
  מוחק את ה-pending; `paymentContextId` לא-קיים לא נוגע בכלום.
- רענון (`reload`) מוצא `active` token מחדש (נבדק דרך storage "טרי" עם אותו raw JSON, לא state
  בזיכרון).
- שתי לשוניות: pending אחד לא נדרס על ידי אחר; קידום אחד לא מוחק pending של הזמנה אחרת.
- `revokeActiveAccess` מוחקת **רק** את `report+product` המתאים - לא מוצר אחר/דוח אחר.
- JSON פגום (בשני המאגרים), `schemaVersion` לא תואם, וצורה לא-צפויה (למשל מערך) - כולם "נכשל
  סגור" למאגר ריק, אף פעם לא חריגה.
- TTL: pending שפג מנוקה; רשומה בדיוק בגבול ה-TTL עדיין תקפה; pending לא נמחק **באמצע** polling
  (סימולציה של 10 קריאות רצופות); `cleanupPending` (TTL של pending) **אף פעם** לא נוגעת ב-`productAccess`,
  גם כש-"עכשיו" רחוק שנה קדימה.
- `localStorage` quota error - `setItem` שזורק חריגה מטופל, לא מפיל את הפונקציה, מוחזר `ok:false`.
- אין מוטציה של אובייקט הקלט שהועבר ל-`addPending`.
- אין `accessToken` בשום `JSON.stringify` של תוצאת שגיאה/כשל.
- `resolvePendingByReportAndProduct`: התאמה יחידה נמצאת; אין התאמה → `not_found`; מוצר שונה על
  אותו דוח לא נחשב התאמה; **שתי התאמות סותרות → `ambiguous`, נכשל סגור, לא בוחר אחת** (0.1.5ח).
- `touchActiveAccess` מעדכנת `lastVerifiedAt` בלבד, לא נוגעת ב-`accessToken`/`activatedAt`; אין
  רשומה קיימת → לא יוצרת חדשה, לא זורקת.

**מה עדיין לא ממומש/בדוק** (ברמת ה-UI, כשייכתב `app/payment-return`/`app/cashflow` בפועל):
1. קריאת `ReturnValue` בפועל מ-`window.location.search` (case-insensitive) וחיבורה למודול הזה.
2. polling מול `dohefes-get-product-access` אמיתי (fetch מדומה ב-Vitest, לא Cardcom אמיתי - ר'
   §0.1.7) - כולל backoff, timeout, וכפתור "בדוק שוב" ידני.
3. משתמש שמקליד ידנית `?outcome=success` בלי הקשר תקין - unavailable, לא "success" מזויף.
4. בדיקת network-level שאין `accessToken` בשום מקום מלבד header `X-Access-Token` (הבדיקה שקיימת
   כרגע מוודאת רק היעדרו מ-JSON.stringify של תוצאות שגיאה, לא בדיקת רשת אמיתית - ר' §0.1.6 לעיל
   "אין accessToken בשום JSON.stringify").

### 0.1.7 - סביבת הבדיקות הרשמית של Cardcom - קיימת, לא הופעלה (החלטה מפורשת)

אותרה בפועל סביבת בדיקות/sandbox רשמית של Cardcom (support.cardcom.solutions, "התנסות במערכת
טסטים"). **הוחלט במפורש שלא להפעיל אותה** - לא נוצרה עסקה, גם לא עסקת בדיקה, בסביבת ה-sandbox
הזו או בכל סביבה אחרת של Cardcom. כל הבדיקות (527+ קיימות, ור' §0.1.6 העתידיות) נשארות אוטומטיות/
מדומות בלבד (Vitest + fakes) - תיעוד זה קיים כדי שהחלטה זו לא תישחק בטעות בעתיד ("הרי יש סביבת
בדיקות, למה לא להשתמש בה") בלי דיון מפורש חדש.

### 0.1.4 בטיחות תשלום - תכנון בלבד

- **מניעת חיוב כפול ברענון/חזרה**: `SuccessRedirectUrl` מכיל `paid=true` - אם המשתמש מרענן את
  `/cashflow/?id=X&paid=true` (או חוזר אליו מההיסטוריה), אסור ליצור אסמכתת תשלום שנייה. תכנון:
  בדיוק כמו `insertedRef` הקיים ב-`app/calculator/page.tsx:168,328` (דגל `useRef` שמונע `insert`
  כפול) - `/cashflow` ישתמש באותו דפוס, **ובנוסף** יבדוק קודם אם כבר קיים `ProductEntitlement`
  עם `paymentStatus:"paid"` לאותו `reportId`+`productType` לפני שהוא כותב חדש (לא רק מגן על
  ריצה כפולה באותו טעינת-דף, גם על חזרה מאוחרת יותר לאותו URL).
- **אימות בצד השרת, לא רק query parameter**: **פער אמיתי, לא רק תכנון** - כרגע (ר' §0.1.1) **אין
  שרת בפרויקט בכלל**, גם דוח האפס עצמו לא מאומת בצד שרת היום. שתי אפשרויות, לא הכרעתי ביניהן
  (מעבר להיקף התכנון הזה - זו החלטת תשתית, לא רק UI):
  1. **לשמר את אותה רמת סיכון כמו המוצר הקיים** (query-param בלבד) - עקבי, לא מוסיף תשתית, אך
     לא עונה על הדרישה המילולית "לא לפי query parameter בלבד".
  2. **לבנות אימות שרת אמיתי** (למשל Supabase Edge Function שמקבלת webhook מ-Cardcom ורק היא
     כותבת `paymentStatus:"paid"`, לא הלקוח) - עונה על הדרישה במלואה, אך תשתית חדשה שלא קיימת
     היום לאף מוצר, כולל דוח האפס - היקף גדול מ"UI לתזרים".
- **`productType` נשמר עם אסמכתת התשלום** - שדה `paymentReference`/`productType` יחד באותה שורת
  `ProductEntitlement` (ר' §0.1.3), לא בשני מקומות נפרדים שעלולים להתפצל.
- **`returnUrl` מוגבל לדוח ולמוצר הנכונים** - `SuccessRedirectUrl` מקודד גם `reportId` וגם
  יעד `/cashflow` (לא `/calculator`) - כתובת אחת לכל שילוב דוח×מוצר, לא כתובת גנרית.
- **תשלום עבור דוח אחד לא פותח תזרים בדוח אחר** - נאכף מבנית על ידי `ProductEntitlement.reportId`
  ספציפי בבדיקה (§0.1.3) - `/cashflow/?id=Y` בודק entitlement עבור `Y` בדיוק, לא "יש למשתמש
  הזה תשלום כלשהו".
- **מקור אמת יחיד למחיר** - `CASHFLOW_ANALYSIS_PRICE_NIS` ב-`lib/supabase.ts` (ליד `BASIC_PRICE_NIS`
  הקיים) - כל מקום שמציג "980 ₪" לניתוח התזרים (מסך הכניסה §3.1, כפתור רכישה, Excel אם רלוונטי)
  קורא לקבוע הזה, **לא כותב `980` ישירות בשום קומפוננטה**.
- **ניסוח המחיר ומע"מ - בלי מדיניות חדשה**: נבדק בפועל - `/start` היום **אינו** מציין התייחסות
  מע"מ למחיר עצמו (980 ₪ מוצג כמספר יחיד, "תשלום חד פעמי לפרויקט"). אין קביעה קיימת להעתיק
  מעבר לזה. ניתוח התזרים ישתמש **באותה נוסחת ניסוח בדיוק**: "תשלום חד פעמי, {מחיר} ₪" - בלי
  להוסיף שורת מע"מ שלא קיימת היום למוצר הבסיסי.

---

## 1. תיאור מסלול המשתמש הקיים

נבדק בפועל (קריאת קוד מלאה) בכל הקבצים תחת `app/calculator`, `app/report`, `app/sample`,
`app/components`, `lib/report` - הרשימה אותרה בעצמי (`find`), לא הונחה מראש:

```
app/calculator/page.tsx        (1099 שורות) - הטופס + התצוגה החיה
app/calculator/ReportView.tsx  (428 שורות)  - רכיב תצוגת הדוח, טהור (inputs+result -> JSX)
app/report/page.tsx            (92 שורות)   - צפייה בדוח שמור לפי ?id=, קריאה בלבד
app/sample/page.tsx            (118 שורות)  - דוגמה קבועה בקוד (SAMPLE_INPUTS), אותו ReportView
app/components/Banner.tsx      (105 שורות)  - באנר שיווקי עליון
app/components/ConsultationCTA.tsx (53 שורות) - כפתור "קביעת שיחת ייעוץ" בתחתית הדוח
app/components/InfoTooltip.tsx (27 שורות)   - "?" קליק-לפתיחה, טולטיפ טקסט - דפוס עזרה קיים
app/components/Logo.tsx        (59 שורות)   - לוגו בכותרת הדוח
lib/report/exportExcel.ts      (148 שורות)  - buildWorkbook/downloadWorkbook, xlsx (SheetJS), 3 גיליונות
```

**זרימה בפועל**:

1. `/calculator` (בלי `?id=`): טופס שטוח אחד - שם פרויקט, סוג עסקה (7 כפתורים), עלויות בנייה
   (ברירת מחדל מאומדן לשכת שמאי המקרקעין לפי אזור+גובה), קרקע (משתנה לפי `landMechanism`), תמהיל
   דירות (טבלה דינמית), מימון, ואקורדיון "מיסים ועלויות עקיפות, מתקדם" (`showAdvanced`, מכווץ
   כברירת מחדל - **דפוס "הגדרות מתקדמות" קיים כבר, ר' §6**). **אין כפתור "חשב"** - `computeProject`
   רץ בכל הקשה (`useMemo`, `app/calculator/page.tsx:296`), והדוח (`ReportView`) מוצג מיד מתחת לטופס.
2. תשלום (980 ₪, חיצוני לריפו) מחזיר עם `?dealType=X&paid=true` -> נוצרת רשומה ב-`dohefes_reports`
   (`insert`, פעם אחת, `app/calculator/page.tsx:326-350`) -> מקבל `id`, מוצג "הקישור הקבוע שלו".
3. מאותו רגע, **כל שינוי בטופס נשמר אוטומטית** debounced 1500ms (`app/calculator/page.tsx:353-368`)
   ל-`dohefes_reports.inputs`/`results` (עדכון `update`, לא `insert` נוסף).
4. `/calculator/?id=<uuid>`: `applyLoadedInputs` (שורה 177) טוען וממזג עם ברירות מחדל (דוחות
   שנבנו על ידי הסוכן החכם ב-`insure-vda` שומרים רק `dealType`/`projectName`/`units` בלי עלויות
   כלל - ר' ההערה בקוד). ממשיך לערוך באותו טופס, עדיין שומר אוטומטית.
5. `/report/?id=<uuid>`: **צפייה בלבד**, לא ניתן לערוך. טוען `inputs` מ-Supabase, **מחשב
   `computeProject` מחדש בצד הלקוח מ-`inputs`** (לא סומך על `results` השמור - מקור אמת יחיד
   הוא תמיד `inputs`+`computeProject`, לא cache). קישור חזרה לעריכה + קישור למעקב בנייה.
6. `/sample`: אותו `ReportView` בדיוק, על `SAMPLE_INPUTS` קבוע בקוד (לא Supabase) - זה בדיוק מה
   שנבדק ב-smoke test אחרי המיזוג ל-`main`.

**§1.5 - התקדים הישיר**: `app/tracking/page.tsx` (322 שורות, קיים כבר ב-`main` מלפני ענף המנוע) הוא
כלי **שני, נפרד, opt-in** לאותו UUID של דוח - לא נספח ל-`/calculator`. אותה תבנית בדיוק: route
נפרד, `dohefes_reports.tracking jsonb` נפרד (עמודה שנוספה ב-migration `alter table ... add column
if not exists`), טעינה+שמירה עצמאיות (`useEffect` נפרד, `debounce` נפרד), Excel נפרד
(`lib/report/exportTrackingExcel.ts`), קישור "מעבר לדוח מעקב בנייה ←" מוצג ב-`/calculator` (שורה
387-389) ו-`/report` (שורה 68-70) **רק כש-`reportId` קיים** (כלומר הדוח נשמר/שולם). **זה בדיוק
המודל שהמסמך הזה מאמץ לתזרים** - לא תבנית היפותטית, תבנית שכבר רצה בפרודקשן.

---

## 2. נקודות החיבור המדויקות בקוד

| מה | קובץ:שורה | מצב היום | מה ישתנה |
|---|---|---|---|
| חישוב Gen1 | `app/calculator/page.tsx:296` | `computeProject(inputs)` ב-`useMemo`, כל הקשה | **ללא שינוי** |
| רכיב דוח | `app/calculator/ReportView.tsx` | מציג `ProjectResult` (Gen1) בלבד | **ללא שינוי** - רכיב חדש נפרד `CashFlowReportView.tsx`, לא תוספת בתוכו |
| קישור אופציונלי מהדוח | `app/calculator/page.tsx:386-390`, `app/report/page.tsx:67-71` | קישור קיים ל-`/tracking/?id=` מוצג רק כש-`reportId` קיים | **הוספה**: אותו תבנית בדיוק, קישור נוסף "מעבר לניתוח תזרים ומימון מתקדם ←" ל-`/cashflow/?id=` |
| שמירת דוח | `app/calculator/page.tsx:329-338` (`insert`), `:356-365` (`update`) | כותב ל-`dohefes_reports.inputs`/`results` | **ללא שינוי** - עמודת התזרים נכתבת רק מ-`/cashflow`, לעולם לא מ-`/calculator` |
| טעינת דוח | `app/calculator/page.tsx:306-319`, `app/report/page.tsx:23-37` | `.select("inputs")` בלבד | **ללא שינוי** - `/cashflow` יטען בנפרד `.select("inputs, cashflow_assumptions")` |
| Excel | `lib/report/exportExcel.ts` (`buildWorkbook`) | 3 גיליונות מ-`ProjectResult` בלבד | **הרחבה מותנית**: 4 גיליונות נוספים רק כשיש `CashFlowResult` שלם (`status:"complete"`) - ר' §7 |
| מסך תוצאות תזרים | לא קיים | - | **חדש**: `app/cashflow/page.tsx` (wizard+תוצאות), אנלוגי ל-`app/tracking/page.tsx` |

**אין שום נקודת חיבור אוטומטית** - `computeCashFlow`/`prepareCashFlowInput` ייקראו **רק** מתוך
`app/cashflow/page.tsx` שייכתב בשלב הבא, לא מ-`app/calculator/page.tsx` ולא מ-`useMemo` כלשהו
שרץ כברירת מחדל.

---

## 3. Wireframe טקסטואלי

### 3.1 נקודת הכניסה (בתוך `/calculator` ו-`/report`, ליד הקישור הקיים ל-tracking)

לא מוצגת כלל כשאין `reportId` (דוח הכדאיות עצמו לא נשמר/לא שולם עדיין - **תנאי סף מאושר**, ר' §10) -
בדיוק כמו קישור המעקב היום. **כשיש `reportId`**, שלושה מצבים אפשריים לפי `ProductEntitlement`
(§0.1.3) עבור `productType:"cashFlowAnalysis"` באותו `reportId` - שלושה ניסוחים נפרדים, לא
טקסט אחד עם תנאי מוסתר:

```
┌─────────────────────────────────────────────────────────┐   לא נרכש עדיין:
│ הדוח נשמר אוטומטית עם כל שינוי. הקישור הקבוע שלו: ...    │
│ מעבר לדוח מעקב בנייה ←                    (קיים היום)   │
│                                                            │
│ ניתוח תזרים ומימון מתקדם                                 │
│ מוצר נוסף — 980 ₪                                        │
│ [ לרכישה ולהתחלת הניתוח ]                                 │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐   נרכש, טרם התחיל:
│ ...                                                       │
│ ניתוח תזרים ומימון מתקדם                                 │
│ [ פתיחת ניתוח התזרים ]                                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐   נרכש, טיוטה קיימת:
│ ...                                                       │
│ ניתוח תזרים ומימון מתקדם                                 │
│ [ המשך עריכת ניתוח התזרים ]                                │
└─────────────────────────────────────────────────────────┘
```

המצב נקבע לפי שילוב `ProductEntitlement.paymentStatus` (לא נרכש/נרכש) **וגם**
`dohefes_reports.cashflow_assumptions` (null/לא-null - "התחיל" ≠ "שולם", שני תנאים נפרדים
שנבדקים בנפרד, לא משולבים לדגל אחד). כפתור "לרכישה" מוביל ל-`/start`-מקביל לתזרים (זהה בתבנית
ל-`app/start/page.tsx` הקיים, ר' §0.1.1) עם `SuccessRedirectUrl` שמצביע חזרה ל-`/cashflow/?id=<reportId>&paid=true`.

### 3.2 מסך פתיחה של `/cashflow/?id=` (אחרי רכישה, לפני תחילת ה-wizard)

**נגיש רק כש-`ProductEntitlement.paymentStatus==="paid"` לאותו `reportId`.** ניסיון גישה בלי
entitlement (למשל שיתוף קישור, או חזרה ל-URL ישן) מציג את מסך הרכישה (וריאציית 3.1 הראשונה,
ללא הצגת תוכן ה-wizard כלל) במקום שגיאת גישה גנרית - "צריך לרכוש כדי להמשיך", לא "אין הרשאה".

```
┌─────────────────────────────────────────────────────────┐
│  ניתוח תזרים ומימון מתקדם                                │
│  פרויקט טיפוסי - רחוב X, עיר Y            [חזרה לדוח ←]  │
│                                                            │
│  מוסיף לוח תזרים חודשי מלא: מתי בדיוק נכנס ויוצא כסף,     │
│  מה שיא החוב, האם יש חודש עם גירעון מימון. משלים את דוח   │
│  הכדאיות שכבר יש לך - לא מחליף אותו.                       │
│                                                            │
│  דורש כמה נתונים נוספים שדוח הכדאיות לא כולל: מתי כל       │
│  קבוצת דירות נמכרת בפועל, מסגרת האשראי שסוכמה עם הבנק,     │
│  והאם יש ערבויות. כ-10 דקות, אפשר לעצור ולחזור.            │
│                                                            │
│                  [ התחלת ניתוח התזרים ← ]                 │
└─────────────────────────────────────────────────────────┘
```

אם `cashflow_assumptions` כבר קיים (טיוטה מהרצה קודמת): "המשך מאיפה שהפסקת" + סטטוס אחרון
(טיוטה / הושלם / חסרות הנחות).

### 3.3 שלד ה-wizard - progress + ניווט

```
┌─────────────────────────────────────────────────────────┐
│ ניתוח תזרים ומימון          [חזרה לדוח הרגיל]  [שמור וצא]│
│                                                            │
│  ①──②──③──④──⑤──⑥──⑦                                    │
│ זמנים מכירות תקבולים עלויות ערבויות מימון  בדיקה          │
│         ▲ כאן                                             │
│                                                            │
│  [ תוכן השלב הנוכחי ]                                     │
│                                                            │
│                          [ ← הקודם ]      [ הבא → ]        │
└─────────────────────────────────────────────────────────┘
```

עקרונות (ר' §6 UX המלא): כל שלב נשמר עם יציאה ממנו (לא רק בסוף), ניתן לדלג קדימה/אחורה חופשי בין
שלבים שכבר בוצעו, שלב לא-שלם מסומן (●) לא חוסם מעבר אך מוצג ב-שלב 7 כרשימת "עוד לא הושלם".

### 3.4 שלב 7 - בדיקה והרצה

```
┌─────────────────────────────────────────────────────────┐
│ שלב 7 מתוך 7: בדיקה והרצה                                 │
│                                                            │
│  ✓ לוח זמנים                                              │
│  ✓ מכירות וקצב מכירה - 2 שורות יחידות                     │
│  ✓ לוח תקבולים                                            │
│  ● תזמון עלויות - 3 סעיפים עדיין ללא תזמון  [להשלמה →]   │
│  ✓ ערבויות                                                 │
│  ✓ הון, מסגרת, ריבית ועמלות                                │
│                                                            │
│  [ הרצת התזרים ]  (מושבת כל עוד יש ● למעלה)                │
└─────────────────────────────────────────────────────────┘
```

לחיצה על "הרצת התזרים" קוראת `prepareCashFlowInput` ואז (אם `status:"ready"`) `computeCashFlow` -
**זו נקודת החיבור היחידה בכל התכנון** למנוע Gen2, ומתרחשת רק בלחיצה מפורשת, לא אוטומטית.

### 3.5 מסך התוצאות (לאחר הרצה מוצלחת)

```
┌─────────────────────────────────────────────────────────┐
│  ✓ הניתוח הושלם                          [עריכת הנחות ←] │
│                                                            │
│  הסבר קצר: "הפרויקט ממומן במלואו לאורך הבנייה. שיא החוב    │
│  הוא 8.2 מיליון ₪ בחודש 14, בתוך מסגרת של 10 מיליון ₪.     │
│  אין גירעון מימון באף חודש."                                │
│                                                            │
│  ┌─ גרף: תקבולים מול תשלומים לפי חודש ──────────────────┐ │
│  │  (עמודות ירוקות=תקבולים, אדומות=תשלומים, לפי חודש)    │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌─ גרף: יתרת מזומן ויתרת חוב לאורך הפרויקט ────────────┐ │
│  │  (שני קווים על אותו ציר X חודשים)                     │ │
│  └────────────────────────────────────────────────────┘ │
│                                                            │
│  שיא חוב: 8,200,000 ₪ (חודש 14)     הזרמת הון עצמי: 2.0M ₪│
│  סה"כ ריבית: 410,000 ₪               ערבויות: 180,000 ₪   │
│  עמלת פתיחת תיק: 45,000 ₪            עמלת אי-ניצול: 22,000₪│
│  גירעון מימון: אין          חריגת מסגרת: אין               │
│                                                            │
│  ⚠ ערבות קומבינציה פעילה מעבר לגבול התחזית (אם רלוונטי)    │
│                                                            │
│  ▸ טבלה חודשית מפורטת (לחיצה לפתיחה)                       │
│                                                            │
│  [ הורדת קובץ Excel ]        [ הדפסה / PDF ]                │
└─────────────────────────────────────────────────────────┘
```

**מסך זה מוצג אך ורק כש-`status:"complete"`.** שני המצבים האחרים (ר' §5) מציגים מסך שונה
לגמרי, לא גרסה "חלקית" של המסך הזה.

---

## 4. טבלת כל השדות

מקרא העמודות: **מקור** = ממולא מהדוח הקיים / קלט חדש · **ברירת מחדל** = בטוחה אם יש, אחרת "אין
(מפורש)" · **אישור** = דורש אימות מקצועי · **מתקדם** = מוצג רק תחת "הגדרות מתקדמות"

### שלב 1 - לוח זמנים

| שדה (בטיפוס) | מקור | ברירת מחדל | אישור מקצועי | מתקדם | הודעת עזרה |
|---|---|---|---|---|---|
| `permitMonths` | ✅ מ-`costs.permitMonths` הקיים | - | לא | לא | "כמה חודשים עד תחילת הבנייה בפועל - כבר הוזן בדוח הכדאיות, ר' כאן רק לאישור." |
| `constructionMonths` | ✅ מ-`costs.constructionMonths` הקיים | - | לא | לא | "משך הבנייה בחודשים - כבר הוזן בדוח הכדאיות." |
| `handoverMonthIndex` (דריסה) | 🆕 חדש, אופציונלי | נגזר אוטומטית (היתר+בנייה) | לא, אלא אם נדרס | ✅ מתקדם | "רק אם המסירה בפועל שונה מסכום פשוט של היתר+בנייה (למשל עיכוב ידוע)." |

### שלב 2 - מכירות וקצב מכירה

| שדה | מקור | ברירת מחדל | אישור מקצועי | מתקדם | הודעת עזרה |
|---|---|---|---|---|---|
| שיוך שורת יחידה (`sourceUnitIndex`→`unitRowId`) | ✅ מוצע אוטומטית מסדר `units` הקיים | - | ✅ **כן** - לוודא שההתאמה נכונה | לא | "כל שורה מהתמהיל שהזנת בדוח הכדאיות - כאן קובעים מתי בפועל היא נמכרת." |
| `batches` (כמה יחידות, באיזה חודש) | 🆕 חדש חובה, לכל שורה שנמכרת | אין (מפורש) | ✅ כן | לא | "לדוגמה: '6 דירות בחודש 3, 4 דירות בחודש 10' - אפשר לפצל מכירה למספר גלים." |
| `isBuyerSaleLawEligible` | 🆕 חדש, checkbox לכל שורה | **לא מסומן** (אין ברירת מחדל שקטה) | ✅ כן | לא | "מסומן = הכספים שהתקבלו מהרוכשים בשורה הזו מוגנים בערבות חוק מכר. משפיע על עלות הערבות בשלב 5." |

### שלב 3 - לוח תקבולים

| שדה | מקור | ברירת מחדל | אישור מקצועי | מתקדם | הודעת עזרה |
|---|---|---|---|---|---|
| `salesSchedule.model` | 🆕 חדש | **preset מוצע**: "לוח תשלומים סטנדרטי" (`explicitSchedule`) | ✅ סומן "דורש אימות" | לא | "איך מתפרסים תשלומי הרוכשים על פני הזמן. ברירת המחדל: 15% בחתימה, 70% לאורך הבנייה, 15% במסירה - אימות מול החוזה בפועל." |
| `byCategory` (tranches לכל קטגוריה) | 🆕 חדש | preset 15/70/15 לכל קטגוריה שיש בה מכירה | ✅ כן | לא | "אם יש כמה סוגי נכסים (למשל מגורים ומסחר), אפשר לוח תשלומים שונה לכל אחד." |
| `saleMonthByCategory` | 🆕 חדש, תיעודי | - | לא (לא משפיע על החישוב, ר' cashflow-project-adapter §13.4) | ✅ מתקדם | "מועד חתימת החוזה הטיפוסי לקטגוריה - לתיעוד בלבד." |

### שלב 4 - תזמון עלויות

| שדה | מקור | ברירת מחדל | אישור מקצועי | מתקדם | הודעת עזרה |
|---|---|---|---|---|---|
| `costTimingOverrides` לכל סעיף חיובי (27 סעיפים אפשריים, בפועל רק אלה עם סכום > 0 בדוח) | ✅ **סכום** מגיע מהדוח הקיים; 🆕 **תזמון** חדש | **presets לפי סוג סעיף** - למשל בנייה→"פרוס על פני הבנייה", היטל השבחה→"בתחילת הבנייה" | ✅ סעיפים עם כלל `salesCurve`/`requiresProjectAgreement` **חובה** | סעיפים בסכום 0 מוסתרים אוטומטית (אינם רלוונטיים) | "מתי בפועל משולם הסעיף הזה - חד-פעמי בחודש מסוים, או פרוס על פני תקופה." לכל rule kind הודעה ספציפית |
| עוגני זמן (`constructionStartMonthIndex` וכו') | ✅ נגזר משלב 1 | - | לא | ✅ מתקדם (מוצג רק אם המשתמש בחר כלל שדורש עוגן שלא נגזר אוטומטית) | - |

### שלב 5 - ערבויות

| שדה | מקור | ברירת מחדל | אישור מקצועי | מתקדם | הודעת עזרה |
|---|---|---|---|---|---|
| רשימת מנגנוני ערבות (`guarantees[]`) | 🆕 חדש. **התחלה מוצעת**: אם יש שורות עם `isBuyerSaleLawEligible=true` משלב 2 → שורת `buyerSaleLaw` מוצעת אוטומטית (ריקה, לא ממולאת) | **אין** (אין ברירת מחדל שקטה לזכאות/שיעור/מסגרת ערבות) | ✅ **כן, תמיד** | לא | "אילו ערבויות בנקאיות קיימות בפרויקט: ערבות חוק מכר לרוכשים, ערבות לבעל הקרקע (קומבינציה), ערבות לדיירים המקבלים דירת תמורה." |
| `annualRateFraction` לכל מנגנון | 🆕 חדש | אין | ✅ כן | לא | "אחוז העמלה השנתי שגובה הבנק על יתרת הערבות - מוצג באחוזים, למשל 0.85%." |
| `releaseMonthIndex`/`durationMonths`/`startMonthIndex` | 🆕 חדש | אין | ✅ כן | לא | "מתי הערבות מתחילה ומתי היא משתחררת - למשל במסירת הדירה." |

### שלב 6 - הון, מסגרת, ריבית ועמלות

| שדה | מקור | ברירת מחדל | אישור מקצועי | מתקדם | הודעת עזרה |
|---|---|---|---|---|---|
| `equityCapNis` | ✅ מ-`costs.equityNis` הקיים | - | לא | לא | "הון עצמי שכבר הוזן בדוח הכדאיות. תקרה - לא בהכרח מוזרם בבת אחת." |
| `creditFacilityLimitNis` | 🆕 חדש חובה (אלא אם `purchaseGroup`) | **אין** - נדחה במפורש חישוב אוטומטי משיא חוב/מהאומדן הסטטי (ר' `GEN2_CASHFLOW_DESIGN.md` §4.1, §11) | ✅ **כן, תמיד** | לא | "מסגרת האשראי שסוכמה בפועל עם הבנק המלווה - מספר מפורש, לא הערכה." |
| `annualInterestRate` | ✅ מ-`costs.annualInterestRate` הקיים | - | לא | לא | "ריבית שנתית, כבר הוזנה בדוח הכדאיות. מוצג באחוזים." |
| `minimumCashBalanceNis` | 🆕 חדש | **0** (בטוחה - "אין מינימום נדרש") | לא | ✅ מתקדם | "יתרת מזומן מינימלית שהבנק דורש לשמור בכל חודש, אם יש." |
| `openingFee` (עמלת פתיחת תיק) | הסכום ✅ **מחושב אוטומטית** מ-`costs.accountOpeningCommissionRate` הקיים (helper משותף מ-`engine.ts`); `chargeMonthIndex` 🆕 חדש | סכום: מהדוח. חודש: **אין** | ✅ החודש כן, הסכום לא | לא | "מתי בפועל נגבית עמלת פתיחת התיק - בדרך כלל בתחילת משיכת האשראי." |
| `unusedFacilityCommission` (בסיס/שיעור/חלון) | השיעור ✅ מ-`costs.unusedCreditCommissionRate`; בסיס+חלון 🆕 חדשים | אין ברירת מחדל לבסיס | ✅ כן | ✅ מתקדם (בסיס - "יתרת פתיחה"/"יתרת סגירה"/"ממוצע" - הבדל טכני שרוב המשתמשים לא צריכים לבחור בעצמם, presets עם הסבר) | "עמלה שהבנק גובה על החלק הפנוי במסגרת שלא נוצל." |

---

## 5. מסך התוצאות - פירוט לפי מצב

`computeCashFlow` מחזיר union תלת-מצבי (`cashflow-engine.ts`) - **שלושה מסכי תוצאה שונים, לא
אחד עם "התראה"**:

### 5.1 `status:"complete"` - המסך המלא (ר' wireframe §3.5)

- **גרף תקבולים מול תשלומים** - עמודות חודשיות, `operatingInflowsNis` מול `totalCashOutflowsNis`
  (מ-`CompleteFinancingMonth`, `cashflow-complete-financing.ts`).
- **יתרת מזומן** ו**יתרת חוב** - שני קווים, `closingCashBalanceNis`/`closingDebtBalanceNis` לכל חודש.
- **הזרמת הון עצמי** - `summary.totalEquityInjectedNis`, ואפשר לסמן על הגרף את החודשים עם `equityInjectionNis>0`.
- **שיא חוב ומועדו** - `summary.peakClosingDebtBalanceNis`/`peakClosingDebtMonthIndex`.
- **ריבית, ערבויות ועמלות** - `summary.totalInterestExpenseNis`/`totalGuaranteeExpenseNis`/`totalOpeningFeeExpenseNis`/`totalUnusedFacilityCommissionNis`.
- **גירעון מימון וחריגת מסגרת** - `summary.peakFundingDeficitNis`/`firstFundingDeficitMonthIndex`,
  `summary.facilityExceeded` - "אין" ירוק כש-0/false, אדום עם הסבר כשיש.
- **אזהרה ערבויות מעבר לתחזית** - `summary.activeGuaranteesBeyondForecast`, ואזהרות טקסט נוספות מ-`warnings[]`.
- **טבלה חודשית מפורטת** - `<details>`/accordion (לא accordion מותאם - `<details>` תקני, פחות
  JS), כל שדה מ-`CompleteFinancingMonth` בשורה, עם שמות עברית (לא `monthIndex`, ר' §6).
- **הסבר מילולי** - תבנית טקסט פשוטה שממלאת ערכים מ-`summary` (לא AI, לא חופשי - "הפרויקט ממומן
  במלואו... שיא החוב הוא X בחודש Y..."), 2-3 משפטים.

### 5.2 `status:"incompleteAssumptions"` - מסך חוסר, לא "תוצאה חלקית"

```
┌─────────────────────────────────────────────────────────┐
│  ⚠ עדיין חסרות הנחות להשלמת הניתוח                        │
│                                                            │
│  לא ניתן להריץ תזרים מלא בלי הפרטים האלה:                 │
│  • תזמון עלות: היטל השבחה (שלב 4)                         │
│  • ערבויות: שיעור עמלה ל"ערבות חוק מכר" (שלב 5)            │
│                                                            │
│  [ חזרה להשלמת שלב 4 ]  [ חזרה להשלמת שלב 5 ]              │
└─────────────────────────────────────────────────────────┘
```

**אין גרפים, אין מספרים, אין "כמעט תוצאה".** רק רשימת מה חסר וקישור ישיר לשלב הרלוונטי -
ממופה מ-`missingAssumptions: string[]` (הודעות שכבר קיימות מהמנוע) ל-`MissingCashFlowAssumption`
המובנה מ-`prepareCashFlowInput` (`code`/`path`/`message`/`severity`) כדי לדעת לאיזה שלב wizard
לקשר (מיפוי `code`→שלב, טבלה קבועה בקוד ה-UI).

### 5.3 `status:"notConverged"` - מסך כשל חישובי, לא כשל קלט

```
┌─────────────────────────────────────────────────────────┐
│  ⚠ החישוב לא התייצב                                       │
│                                                            │
│  הלולאה הפנימית לא הגיעה להתכנסות אחרי 60 סבבים. זה לא     │
│  אומר שההנחות שגויות - ייתכן תרחיש קיצוני (למשל מסגרת       │
│  קטנה ביחס להיקף הפרויקט) שגורם לחישוב לא להתייצב.          │
│                                                            │
│  מומלץ לבדוק את מסגרת האשראי (שלב 6) ולנסות שוב.            │
│                                                            │
│  [ חזרה לשלב 6 ]                    [ הצג בכל זאת ]         │
└─────────────────────────────────────────────────────────┘
```

"הצג בכל זאת" (משני, לא ברירת מחדל) חושף את מסך 5.1 המלא **עם באנר אדום קבוע בראש**: "תוצאה זו
לא סופית - לא הגיעה להתכנסות חישובית". לעולם לא מוצג כתוצאה תקינה רגילה.

**עיקרון-על לשלושתם**: "אין להציג תוצאה לא מלאה כאילו היא דוח תקין" (הנחיית המשתמש) - ממומש
על ידי כך שה-3 מצבים הם 3 קומפוננטות React נפרדות (`CompleteResultView`/`IncompleteAssumptionsView`/
`NotConvergedView`), לא ענף `if` בתוך אותה קומפוננטה עם `??`/`||` על שדות חסרים.

---

## 6. עקרונות UX

| דרישה | יישום מתוכנן |
|---|---|
| בלי שמות טכניים (`unitRowId`, `monthIndex`, `annualRateFraction`) | כל שדה טכני ממופה לתווית עברית קבועה בקובץ מיפוי אחד (`lib/cashflow-ui/labels.ts`, מתוכנן, לא נכתב) - אין `unitRowId` גולמי מוצג למשתמש בשום מקום, גם לא בטבלה המפורטת |
| שיעורים באחוזים, המרה רק בגבול הקלט | ה-state של ה-wizard מחזיק אחוזים (`6` ולא `0.06`); ההמרה ל-`annualRateFraction`/`fraction` קורית **פעם אחת בלבד**, ברגע בניית `ProjectCashFlowAssumptions` לפני הקריאה ל-`prepareCashFlowInput` - לא בכל שלב ביניים. מבטל מבנית את מחלקת הבאג "6 שהוזן במקום 0.06" מ-UI (הבדיקה ב-`cashflow-project-adapter.ts` נשארת כהגנה נוספת, לא הראשונה) |
| חודשים כשמות שלבים / "חודש 1, חודש 2" + הסבר על חודש 0 | פונקציית תווית חודש אחת (`monthLabel(monthIndex, axis)`, מתוכננת): "חודש 1" (1-based בתצוגה, `monthIndex+1` בפנים) + תגית שלב כשרלוונטי ("חודש 1 (תחילת היתרים)", "חודש 9 (תחילת בנייה)", "חודש 28 (מסירה)"). הסבר קבוע ב-wireframe §3.2/מסך פתיחה: "חודש 1 = החודש הראשון של תהליך ההיתרים, לא היום הזה בדיוק" |
| progress ברור | ①-⑦ קבוע בראש ה-wizard (ר' §3.3), שלב נוכחי מודגש, שלבים שהושלמו מסומנים ✓ |
| "חזור לדוח הרגיל" תמיד זמין | כפתור קבוע בראש כל מסך ב-`/cashflow`, גם באמצע wizard, גם במסכי תוצאה - מוביל ל-`/calculator/?id=` (לא `/report`, כדי לאפשר עריכה חוזרת אם צריך) |
| לא לדרוש עשרות שדות בבת אחת | 7 שלבים נפרדים (לא טופס ארוך אחד כמו `/calculator` היום); בתוך שלב - שדות מקובצים לפי ישות (שורת יחידה, מנגנון ערבות) עם "+ הוספה" בדיוק כמו תבנית `+ הוספת טיפוס דירה`/`+ הוספת סעיף` הקיימת |
| presets עם "דורש אימות" | כל preset (15/70/15, כלל תזמון עלות ברירת מחדל) מוצג עם badge צהוב קבוע "דורש אימות" עד שהמשתמש נוגע בערך בפועל - לא נעלם אוטומטית, רק כשנשמר עריכה מפורשת |
| אין ברירת מחדל שקטה לזכאות ערבות/מסגרת/עיתוי לא ודאי | ר' §4 - `isBuyerSaleLawEligible` מתחיל לא-מסומן, `creditFacilityLimitNis` מתחיל ריק (לא 0, לא ניחוש), כללי תזמון `salesCurve`/`requiresProjectAgreement` חוסמים מעבר לשלב 7 |

---

## 7. Excel ודוח - תכנון בלבד

**מקור אמת יחיד**: פונקציית ה-Excel של התזרים מקבלת `CashFlowResult` **מוכן** (התוצאה שכבר
חושבה ב-wizard, `status:"complete"` בלבד) - **לא קוראת ל-`computeCashFlow` בעצמה ולא מחשבת שום
דבר מחדש**, בדיוק כמו ש-`buildWorkbook` הקיים (`lib/report/exportExcel.ts`) מקבל `ProjectResult`
מוכן ולא קורא ל-`computeProject`.

**שילוב בדוח הקיים, לא מחיקה**: `buildWorkbook(inputs, result, cashFlowResult?)` - פרמטר שלישי
אופציונלי. שלושת הגיליונות הקיימים (פרטי פרויקט/תמהיל דירות/תוצאות) **נשארים זהים**. ארבעה
גיליונות חדשים **מתווספים בסוף** רק כש-`cashFlowResult` סופק **וגם** `status==="complete"`:

| גיליון חדש | תוכן | מקור |
|---|---|---|
| סיכום תזרים | שיא חוב+מועד, סה"כ ריבית/ערבויות/עמלות, גירעון מימון, חריגת מסגרת | `CashFlowSummary` |
| תזרים חודשי | שורה לכל `monthIndex`: תקבולים, תשלומים, יתרת מזומן, יתרת חוב, הון/אשראי/פירעון | `CompleteFinancingResult.months[]` |
| הנחות | תמצית `ProjectCashFlowAssumptions` שהוזנה - לוח תשלומים, תזמון עלויות, ערבויות, מסגרת/ריבית - לשקיפות ותיעוד, לא לחישוב חוזר | `ProjectCashFlowAssumptions` |
| בדיקות ואזהרות | `warnings[]`, `isConverged`/`iterationsUsed`, כל דגל (`facilityExceeded` וכו') | `CashFlowResult` |

הדפסה/PDF: אותו דפוס `window.print()` + מחלקות `print:hidden`/`print:block` הקיימות ב-`app/tracking/page.tsx`
(תצוגת הדפסה נפרדת, טבלאית, בלי גרפים - גרפים לא מודפסים היטב).

---

## 8. תאימות ושמירה

- **`schemaVersion`** - `ProjectCashFlowAssumptions.schemaVersion` **כבר קיים בטיפוס** (commit
  8c). כל שמירה ל-Supabase כוללת אותו. עדיין אין קוד migration בין גרסאות (רק גרסה 1 קיימת) - זה
  יתווסף כשתהיה גרסה 2 בפועל, לא מראש.
- **שמירה אופציונלית ונפרדת** - עמודה חדשה `dohefes_reports.cashflow_assumptions jsonb`, **אותה
  תבנית migration בדיוק** כמו `tracking`/`ai_notes` הקיימים: `alter table dohefes_reports add
  column if not exists cashflow_assumptions jsonb;`. `null` = "לא התחיל תזרים בכלל" - זה המצב של
  **כל** דוח קיים היום, אין להם השפעה כלל.
- **טעינת דוח ישן ללא תזרים** - `/cashflow/?id=<uuid>` על דוח עם `cashflow_assumptions=null` מציג
  את מסך הפתיחה (§3.2), שלב 1 מתחיל ריק (עם הפרפילים מ-`inputs` הקיים, ר' §4 עמודת "מקור").
  `/calculator`/`/report`/`/sample` **לא בודקים את העמודה הזו בכלל** - בלי שינוי קוד בהם מעבר
  לקישור האופציונלי (§2), אין להם שום תלות בקיומה.
- **מצב טיוטה** - נשמר debounced (כמו היום) **גם כשלא הושלם** - אין "publish" נפרד לשמירה עצמה
  (זהה לדפוס הקיים: `/calculator` שומר כל הקשה, גם לפני שהדוח "מוכן"). מה שכן **חדש** לעומת כל
  מה שקיים במערכת היום: **חסימת ייצוא/הצגה** כשההנחות חסומות (§5.2/5.3) - Excel והמסך המלא לא
  זמינים כש-`status !== "complete"`, רק המסך המתאים (חוסר/אי-התכנסות).
- **שתי migrations נפרדות, לא אחת** - `cashflow_assumptions` (העמודה הזו) נכתבת רק מ-commit 7
  (חיבור המנוע, ר' §9). טבלת ה-entitlement (§0.1.3) נכתבת מוקדם יותר, ב-commit 2, **לפני** שיש
  בכלל wizard - שתי הרצות `SQL Editor` נפרדות בזמנים שונים, לא migration אחת גדולה.
- **migration עתידי, לא עכשיו** - אין שינוי סכמה בפועל בשלב התכנון הזה. תידרש הרצה ידנית ב-SQL
  Editor של Supabase (כמו כל migration קודם בפרויקט - `tracking`, `ai_notes`) בכל אחד משני
  השלבים הנ"ל - מתועד כאן כדי שלא יופתעו, לא מבוצע.

---

## 9. תכנית Commits

**הערה - הרשימה למטה קדמה לתשתית האמיתית (ר' §0.1.3א/§0.1.5) וטרם עודכנה במלואה**: בפרט,
commit 2 מתאר `NEXT_PUBLIC_CARDCOM_LINK_CASHFLOW`/טבלת `ProductEntitlement` גנרית - **אלה כבר
קיימים בפועל בצורה אחרת** (`DOHEFES_CARDCOM_*` secrets, `dohefes_product_entitlements` אמיתית,
`dohefes-create-payment-order` שכולל כעת גם `paymentContextId`). כשיתחיל commit 1 בפועל, יש
לעדכן את הרשימה כאן לפני שממשיכים - **אל תבצע commit 2 כפי שמתואר מילולית למטה**.

1. **טיפוסי מצב UI + המרות** - `lib/cashflow-ui/` (חדש): מיפוי תוויות עברית, `monthLabel()`,
   פונקציות אחוז↔שבר, טיפוסי wizard state. **ללא React, ללא חיבור מנוע.**
2. **רכישה ו-entitlement** - `CASHFLOW_ANALYSIS_PRICE_NIS` ליד `BASIC_PRICE_NIS` (`lib/supabase.ts`),
   `NEXT_PUBLIC_CARDCOM_LINK_CASHFLOW`, נקודת רכישה (אנלוגית ל-`/start`), טבלת `ProductEntitlement`
   (ר' §0.1.3 - **זו נקודת ה-migration היחידה בתכנית הזו**, `payment_status`/`inputs`/`results`/`tracking`
   הקיימים לא נוגעים). **עדיין בלי wizard עצמו** - רק "שולם/לא שולם" נכתב ונקרא.
3. **מסך opt-in תלת-מצבי + שלד wizard** - `app/cashflow/page.tsx` חדש: קריאת `ProductEntitlement`
   (מ-2), שלושת המצבים (§3.1: לרכישה/פתיחה/המשך), progress ①-⑦, ניווט בין שלבים, **שלבים עצמם
   עדיין ריקים/placeholder**. קישור מ-`/calculator`/`/report`.
4. **שלבים 1-2**: לוח זמנים + מכירות וקצב מכירה, כולל טבלת שיוך שורות ומוסיף batches.
5. **שלבים 3-4**: לוח תקבולים (presets) + תזמון עלויות (לכל סעיף מהדוח הקיים).
6. **שלבים 5-6**: ערבויות + הון/מסגרת/ריבית/עמלות.
7. **חיבור המנוע** - שלב 7 בפועל: `prepareCashFlowInput` + `computeCashFlow`, שלושת מסכי המצב
   (§5.1-5.3). **זו הפעם הראשונה שהמנוע נקרא מ-UI בכלל.** דורש גם את ה-migration מ-§8 (`cashflow_assumptions`).
8. **תצוגת תוצאות מלאה** - גרפים (SVG יד, ר' החלטה בסעיף הבא), טבלה חודשית, הסבר מילולי.
9. **Excel** - הרחבת `buildWorkbook` ב-4 גיליונות מותנים (§7).
10. **שמירה ותאימות מתקדמת** - **רק אחרי החלטה נפרדת**: גרסאות/migration אמיתי, אולי caching של
    תוצאה מחושבת, אימות תשלום בצד שרת (§0.1.4 אפשרות 2, אם תוחלט). לא חלק מהיקף האישור הנוכחי.

---

## 10. החלטות שדורשות אישור

**הוכרעו (עודכן)**: תנאי הסף לכניסה ל-`/cashflow` (דורש דוח בסיס קיים, ר' §0.1) ומודל התמחור/גישה
(מוצר נפרד, 980 ₪, entitlement נפרד - ר' §0.1) **הוכרעו במלואם**, לא ברשימה זו יותר.

1. **מיקום נקודת הכניסה**: route נפרד `/cashflow` (מומלץ, תואם תקדים `/tracking`) מול הטמעה
   בתוך `/calculator` הקיים. המסמך מניח route נפרד בכל מקום למעלה.
2. **גרפים**: SVG יד (מומלץ - אין תלות npm חדשה, האתר כבר "רזה" בתלויות: `xlsx`+`supabase` בלבד,
   `package.json` נבדק) מול הוספת ספריית גרפים (`recharts` וכו').
3. **שם עמודת Supabase**: `cashflow_assumptions` (מומלץ, תואם מוסכמת `tracking`/`ai_notes`) -
   וכן שם הטבלה החדשה ל-entitlement (§0.1.3, `dohefes_product_entitlements` מוצע, לא סופי).
4. **presets אוטומטיים לפי `dealType`** - האם שלב 3/4 מציעים preset ברירת מחדל שונה ל-`purchaseGroup`
   (למשל) לעומת `tama38`, או preset אחיד לכולם עם badge "דורש אימות" בכל מקרה (מומלץ - פשוט
   יותר, פחות ניחוש שקט לפי סוג עסקה).
5. **`maxIterations`** - נשאר פרמטר פנימי בלבד (מומלץ, כבר מתועד ב-`cashflow-complete-financing.ts`
   כ"לבדיקות בלבד"), לא נחשף למשתמש בשום UI.
6. ~~**אימות תשלום בצד שרת** (§0.1.4)~~ - **הוכרע ב-2026-08-28, ר' §0.1.3א**: אימות אמיתי בצד
   שרת (`dohefes-get-product-access`) הוא התשתית שכבר קיימת ורצה - לא עוד שאלה פתוחה. שאלת
   הרחבתה **גם** לדוח האפס הקיים (`baseReport`, שממשיך כרגע ב-`?paid=true` הישן) נשארת פתוחה,
   אך מחוץ להיקף המסמך הזה.

---

## 11. סיכוני תאימות

- **סיכון נמוך לדוח הקיים**: כל שינוי מוגבל ל-קובץ חדש (`app/cashflow/page.tsx`) + שתי הוספות
  קישור-בלבד קיימות (`app/calculator/page.tsx`, `app/report/page.tsx`, ליד קישור ה-tracking
  הקיים) + הרחבה מותנית ל-`buildWorkbook`. `ReportView.tsx`, `computeProject`, ה-Supabase columns
  הקיימים (`inputs`/`results`/`tracking`) - **לא נוגעים כלל**.
- **סיכון בינוני**: עומס-יתר על ה-wizard אם 7 השלבים לא נשמרים לעיתים קרובות מספיק (משתמש
  שמאבד קלט שמילא) - ממותן על ידי debounced-save לפי שלב, לא רק בסוף.
- **סיכון שטרם נפתר, לתשומת לב ב-commit 3**: מה קורה אם משתמש פותח `/cashflow` בשני טאבים
  (כמו הבעיה הפוטנציאלית הידועה כבר ב-`/calculator` עם ה-debounce - לא ייחודי לתזרים, אך
  ה-wizard רב-השלבים עלול להחמיר עקב יותר עדכונים חלקיים).
- **תלות ב-migration**: commit 7 (חיבור המנוע, ר' §9 המעודכן) לא יכול לרוץ בפרודקשן בלי הרצת
  ה-`alter table` (§8) קודם - סדר פעולות שצריך לתאם בזמן, לא סיכון קוד.
- **סיכון תשלום - entitlement משותף בטעות**: הסיכון המרכזי שהוביל ל-§0.1 - שימוש חוזר ב-`payment_status`
  הקיים היה גורם לרכישת דוח האפס "לפתוח" תזרים בטעות. ממותן על ידי `ProductEntitlement` נפרד
  לחלוטין (§0.1.3) - **תנאי קבלה ל-commit 2 (§9)**: בדיקה מפורשת שרכישת `baseReport` בלבד
  (בלי רכישת `cashFlowAnalysis`) לא מציגה `[פתיחת ניתוח התזרים]`, רק `[לרכישה]`.
- **סיכון תשלום - חיוב כפול**: רענון/חזרה ל-`?paid=true` בלי הגנה יכול לכתוב אסמכתת תשלום כפולה.
  ממותן ב-§0.1.4 (דגל `useRef` + בדיקת entitlement קיים לפני כתיבה) - **לא פתור אוטומטית רק כי
  התבנית הקיימת (`insertedRef`) כבר עובדת לדוח האפס**, צריך את אותה הגנה שוב במפורש ב-`/cashflow`.
- **פער אמיתי, לא רק תיאורטי**: כל תהליך התשלום היום (גם דוח האפס הקיים, לא רק תזרים) הוא
  client-side בלבד, ללא אימות שרת - `NEXT_PUBLIC_CARDCOM_LINK_*`/`paid=true` נסמכים על אמון
  בדפדפן. §0.1.4/§10 סעיף 6 מתעדים זאת ביושר במקום להניח תשתית שלא קיימת.

---

## 12. סטטוס

מסמך תכנון בלבד לגבי ה-UI (React) עצמו. **לא נכתב שום קוד React, לא נקרא `computeCashFlow`/
`prepareCashFlowInput` משום מקום, לא נוצרה עמודת Supabase, לא בוצע פרסום, לא נפרסה שום Edge
Function, לא הוגדר שום secret, לא בוצעה פנייה ל-Cardcom (כולל לא לסביבת הבדיקות הרשמית שאותרה -
ר' §0.1.7).**

**עודכן 2026-08-28 (סבב ראשון)**: כתובות סופיות לזרימת רכישה/חזרה (§0.1.5), תיקון קישור
ReturnValue/`paymentContextId` מול תיעוד Cardcom הרשמי (§0.1.5א-ב).

**עודכן 2026-08-28 (סבב שני - audit מחזור חיים של access token)**: זוהה ותוקן פער אמיתי - מפת
`pendingPurchases` יחידה שנמחקת ב-`active` הייתה משאירה את המשתמש בלי שום credential לגישה
חוזרת (רענון/יום אחר/מכשיר אותו/revoked מחדש). תוקן למודל שני-מאגרים (`pendingPurchases`+
`productAccess`, §0.1.5ג), TTL של 24 שעות **מתועד כמדיניות שלנו** (לא ערך Cardcom - §0.1.5ד),
מגבלות שימוש-במכשיר-אחד מתועדות ביושר + הודעת משתמש אחרי רכישה (§0.1.5ז), ו-fallback מפורש
כש-`ReturnValue` חסר שלא בוחר "התאמה אחרונה" בעת ריבוי (§0.1.5ח).

**שכבת האחסון (`lib/payment/payment-storage.ts`) כבר ממומשת ובדוקה בפועל - 28 בדיקות, לא רק
תכנון** (§0.1.6) - זה היחיד מבין הרכיבים שתוארו כאן שכבר יש לו קוד אמיתי, כי הוא לא תלוי ב-React
כלל. שינוי הקוד השני שבוצע בעקבות הסבבים: `paymentContextId` בתגובת `dohefes-create-payment-order`
(commit נפרד). עדיין אין `app/payment-return`/`app/cashflow` בפועל. ממתין לאישור סעיף 10 לפני
commit 1 של ה-UI עצמו.
