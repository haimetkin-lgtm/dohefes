# תשתית תשלום והרשאות משותפת (baseReport + cashFlowAnalysis)

מסמך audit ותכנון בלבד. **אין בו שינוי קוד, Supabase, Edge Functions, או תהליך תשלום פעיל.**
נכתב על ענף `gen2-cashflow-ui`. נדרש **לפני** תחילת React ל-`/cashflow` (ר' `GEN2_CASHFLOW_UI_DESIGN.md`
§0.1) - הממצא המרכזי כאן משנה את §0.1: **אסור** לבנות מוצר נוסף על מנגנון ה"שולם" הקיים, כי הוא
לא רק "client-side בלי אימות שרת" (כפי שכבר תועד ב-§0.1.1/§0.1.4) אלא, כפי שנחשף כאן, **גם ניתן
לכתיבה ישירה מהדפדפן ללא שום תלות בתשלום בפועל** - ר' §2, חומרה קריטית.

---

## 0. סקר תשתיות תשלום קיימות במיזמים אחרים (reuse audit)

**נבדק בפועל, לא הונח**: ארבעת המיזמים נמצאו ונקראו במלואם - `insure-vda`, `hetel-hasbaha` (היטל
השבחה/machria), `rami`, ו-`shlish-dira` (ויאז'ה) - כולם ריפו-git נגישים מקומית. שלושת הראשונים
חולקים **את אותו פרויקט Supabase** (מתועד גם ב-`dohefes/supabase/schema.sql` וגם ב-`hetel-hasbaha/supabase/schema.sql`:
"להריץ בפרויקט Supabase הקיים של insure-vda... הגענו למגבלת 2 פרויקטים חינמיים"). `insure-vda`
הוא **היחיד מבין הארבעה עם שרת Next.js אמיתי** (`output` לא `"export"`, `experimental.serverActions`,
`app/api/*/route.ts` רבים) - מפורס כנראה ב-Vercel (לפי הזיכרון), **לא** GitHub Pages. `dohefes`/`rami`/
`hetel-hasbaha` הם כולם static export ל-GitHub Pages (`output:"export"` בכל שלושתם, נבדק) - **אין
לאף אחד משלושתם שרת עצמאי** - כל קריאת שרת אצלם היא קריאה חוצת-מקור (`fetch` עם CORS) ל-API
routes ב-`insure-vda` (ב-`insure.co.il`). `shlish-dira` נמצא **ללא** entitlement/reportId - מוצר
תשלום יחיד ("שיחת ייעוץ", 780 ₪ אצלו) בלי מעקב סטטוס בכלל - לא רלוונטי לדגם ה-reuse המבוקש.

### 0.1 טבלת ממצאים לפי מיזם (עשר השאלות)

| # | שאלה | `insure-vda` (ליבה: `cases`) | `rami` (+ `insure-vda/api/rami/generate-report`) | `hetel-hasbaha`/machria (+ `insure-vda/api/machria/generate-report`) | `shlish-dira` |
|---|---|---|---|---|---|
| 1 | יצירת עסקה/הפניה | `POST /api/create-case` (שרת אמיתי, `formData`) - **מחיר נקבע בצד שרת** (`price = validatedCode ? 399 : 499`, `src/app/api/create-case/route.ts:47`), לא מהלקוח | `insert` ישיר מהלקוח ל-`rami_cases` (anon key), ואז redirect ל-Cardcom | `insert` ישיר מהלקוח ל-`machria_cases`, ואז redirect | `window.location.href = CARDCOM_URL` קבוע - **אין יצירת רשומה כלל** |
| 2 | success/cancel return | `SuccessRedirectUrl` נבנה **בצד שרת** (`create-case/route.ts:129`) ל-`/case/<id>?paid=true`, `FailedRedirectUrl` ל-`/submit?payment=failed` | `SuccessRedirectUrl` נבנה בצד לקוח (rami, לא נקרא כאן ישירות אך אותה תבנית כמו dohefes/`/start`) | דומה - `check/page.tsx:99`, ל-`/report/?case=<id>` (בלי `?paid=true` בכלל!) | אין return מיוחד מתועד בקוד - כנראה מוגדר בצד Cardcom עצמו |
| 3 | webhook/Edge Function/אימות ספק | **אין בשום מקום בארבעתם** - `case/[id]/page.tsx:101` קורא `?paid=true` ומפעיל `/api/analyze-case` **בלי שום אימות מול Cardcom** | אין - `insure-vda/api/rami/generate-report` מופעל מ-`?paid=true` שהלקוח מדווח, לא מאומת | אותו דבר בדיוק, `insure-vda/api/machria/generate-report` | אין תשתית מעקב תשלום בכלל |
| 4 | מי מסמן "משולם" | **שרת** - `POST /api/analyze-case` (service role, `supabaseAdmin`), אך על סמך `?paid=true` בלבד מהלקוח - "שרת" לא "מאומת" | **שרת** (`insure-vda` API, service role) - אותה חולשה: מסתמך על `case_id` שנשלח, לא על אימות תשלום | **שרת**, אותו דבר | לא רלוונטי - אין entitlement |
| 5 | קשר לפרויקט/מוצר | `case_id` יחיד בטבלה יחידה (`cases`) - אין ריבוי מוצרים לאותו תיק | `case_id` ב-`rami_cases`, מוצר יחיד | `case_id` ב-`machria_cases`, מוצר יחיד (אין ריבוי כמו `baseReport`/`cashFlowAnalysis` באף אחד מהם) | - |
| 6 | מניעת URL מזוייף | **חלקית בלבד** - `create-case` קובע מחיר בצד שרת (טוב), אך ה-`paid=true` בחזרה עדיין **לא מאומת מול הספק** בשום מקום, בשום מיזם | אותה חולשה בדיוק | אותה חולשה בדיוק | - |
| 7 | טבלאות + RLS | **אין שום קובץ RLS בריפו הזה בכלל** (נבדק: `grep` רוחבי ל-"row level security" בכל `*.sql` - 0 תוצאות) - לא ניתן לדעת אם RLS מופעלת על `cases` בלי גישה ל-Dashboard | `rami_cases`: RLS מופעלת, אך `for update using (true)` - **פתוחה לגמרי**, זהה ל-dohefes (§2.1) | `machria_cases`: RLS מופעלת, **אין policy select/update לאנונימי בכלל** (רק insert) - הכי מגבילה מבין הארבעה. **אך** `machria_stage2_cases` (שלב 2 של אותו מיזם) חוזר ל-`using(true)` הפתוח - חוסר עקביות בתוך אותו מיזם | לא נבדק - אין entitlement |
| 8 | idempotency / מניעת אסמכתה כפולה | **יש** - `case/[id]/page.tsx:106`: `if (isPaid && caseData.status !== 'pending_payment') return` - לא יורה פעמיים | **יש**, אותו דפוס בדיוק - `generate-report/route.ts:37`: `if (caseRow.status !== "pending_payment") return` | **יש**, אותו דפוס | - |
| 9 | פעולה אוטומטית לאחר תשלום | כן - `/api/analyze-case` מפעיל ניתוח AI אמיתי | כן - סיווג/הפקת דוח (`submitYishuvClassification`/`generateAndSendRamiReport`) | כן, מקביל | לא - מעבר ל-WhatsApp ידני |
| 10 | secrets נדרשים (שמות בלבד) | `SUPABASE_SERVICE_ROLE_KEY`-סגנון (ב-`supabase-admin`), `CARDCOM_LINK_499`/`NEXT_PUBLIC_CARDCOM_LINK` (שני קישורים - לפי מחיר) | קורא ל-service role של `insure-vda` (לא לקוח נפרד) | אותו דבר | קישור Cardcom קבוע בקוד (`PaymentSP` URL) - לא env var נפרד |

### 0.2 מסקנה - מה כן ראוי למחזר, מה לא

**כן למחזר**:
- **דפוס "צד שרת קובע מחיר וקישור Cardcom"** (`insure-vda/create-case`) - עקרון 1 ב-§4.1 של המסמך
  הזה כבר תואם את זה, **מאושר כתקדים אמיתי, לא רק המלצה תיאורטית**.
- **דפוס idempotency לפי `status`** (`if status !== 'pending_payment' return`) - קיים ועובד בשלושה
  מיזמים, נבדק כזהה בכולם. `payment_order.status` המוצע ב-§5 יכול להשתמש באותו רעיון בדיוק.
- **דפוס "שרת עם service role כותב, לא הלקוח עם anon key"** (rami/machria API routes) - **כיוון
  נכון, אך לא מספיק כמו שהוא** - ר' למטה.
- **RLS "insert-only, בלי select/update" של `machria_cases`** (לא `machria_stage2_cases`) - **הכי
  קרוב** מבין כל מה שנמצא ל-מה ש-§5 של המסמך הזה כבר ממליץ עליו לאנונימי מול `product_entitlements`.

**לא למחזר - אף אחד מהם לא "פתרון מוכן"**:
- **אף אחד מארבעת המיזמים לא מבצע אימות תשלום אמיתי מול Cardcom** (לא webhook חתום, לא שאילתת
  API סטטוס) - כולם, כולל `insure-vda` עם השרת האמיתי שלו, סומכים בסופו של דבר על `?paid=true`
  שהלקוח מדווח בחזרה. **הפער שזוהה ב-§2.3/§2.5 של המסמך הזה קיים בכל ארבעת המיזמים, לא רק
  ב-dohefes** - זה לא ידע קיים שצריך להעביר, זו בעיה משותפת שצריך לפתור מהתחלה בכל מקרה (ר' §8,
  לא השתנה).
- **`rami_cases`/`insure-vda cases` אינם reference implementation ל-RLS** - שניהם פתוחים (או לא
  ניתנים לאימות) באותה צורה כמו dohefes היום.
- **אין באף מיזם דגם `productType`/ריבוי-מוצרים לאותו פרויקט** - `ProductEntitlement` (§0.1.3
  ב-`GEN2_CASHFLOW_UI_DESIGN.md`, §4 כאן) הוא מבנה חדש, לא קיים לשכפול ממקום אחר.

**מסקנה מעשית**: §4/§5 של המסמך הזה (הארכיטקטורה המוצעת) **נשארים כפי שהם** - הסקר לא חושף
פתרון מוכן שאפשר "פשוט להעתיק". שני שיפורים קונקרטיים נכנסים לארכיטקטורה בעקבות הסקר: (1) אימוץ
מפורש של RLS "insert-only" (כמו `machria_cases`, לא `machria_stage2_cases`) כברירת המחדל ל-`dohefes_payment_orders`
גם ל-select, לא רק ל-entitlements - ר' עדכון ב-§5; (2) שאלה חדשה ל-§8: האם `insure-vda` יכול
לשמש כבר עכשיו כ"שרת המשותף" (יש לו כבר Vercel + API routes + service role) במקום Supabase Edge
Function נפרדת - זול/מהיר יותר להקמה, אך יוצר תלות cross-repo. **לא הוכרע כאן.**

### 0.3 החלטות מאושרות (לאחר ה-audit) - מחליפות את §8.1 ואת חלק מ-§8

השאלה ב-§0.2/§8.1 ("האם insure-vda יכול לשמש שרת משותף") **הוכרעה**: **לא**. שתי סיבות נוספות
על מה שכבר תועד שם: תלות cross-repo (כבר עלתה כחיסרון), וגם **עיקרון מוצהר עכשיו**: אין להשתמש
בשרת של מיזם אחד עבור מוצר של מיזם שני - כל מיזם עומד בפני עצמו מבחינת תשתית תשלום. הוכרע גם
שהמנגנון שייבנה כאן, לאחר שייבדק, הוא המועמד להעברה לשאר המיזמים - לא ההפך.

שמונה החלטות מאושרות, ממופות לסעיפים המפורטים שעודכנו בהתאם:

1. תשתית התשלום של דוהפס תשתמש ב-Supabase Edge Functions, לא בשרת של insure-vda - ר' §4/§4.2.
2. אין להעתיק את מנגנון `?paid=true` מאף מיזם - אף אחד מארבעת המיזמים לא נחשב reference
   implementation לאימות עצמו (§0.2), רק לתבניות משנה שכן תועדו כטובות (idempotency, מחיר בצד שרת).
3. `SuccessRedirectUrl` הוא חוויית משתמש בלבד, לעולם לא הוכחת תשלום - ר' §4 (הדיאגרם עודכן).
4. הרשאה רק אחרי אימות שרת אמיתי מול Cardcom, דרך LowProfileCode/GetLowProfileIndicator (או
   webhook מאומת אם יתברר שקיים) - העדכון המהותי ביותר במסמך, ר' §4/§4.2 - סוגר בפועל את הפער
   שה-audit הראה שמשותף לכל המיזמים, לא רק תיאורטי יותר מהם.
5. מחיר ו-productType נקבעים בצד שרת - כבר היה עיקרון מאושר (§4.1), מוקצה כעת במפורש ל-`dohefes-create-payment-order`.
6. Rollout מדורג (תשתית → הפעלה ל-cashFlowAnalysis תחילה → בדיקות אמיתיות → מעבר baseReport →
   סגירת policies ישנות רק בסוף) - ר' §6.2 המעודכן לגמרי.
7. אין לשנות מיד את ה-RLS הקיים על dohefes_reports - נשאר בדיוק כפי שהוא עד שהאתר הישן
   (`/calculator`) עצמו עבר לתשתית החדשה, כדי לא להשבית דוחות קיימים.
8. בסוף התהליך - לא נשארת ל-anon שום הרשאת select/update עם `using(true)`, גם לא על
   dohefes_reports עצמו - ר' §6.2 שלב 5 (חדש).

---

## 1. הזרימה הקיימת בפועל

נקרא בפועל: `app/start/page.tsx`, `app/calculator/page.tsx` (השורות הרלוונטיות), `lib/supabase.ts`,
`supabase/schema.sql`, `next.config.ts`, וכן שני קבצים נוספים שנמצאו רלוונטיים בעצמי תוך כדי
המעקב (לא הונחו מראש): `app/custom/page.tsx`, `app/custom/intake/page.tsx` - זרימת תשלום שנייה
קיימת (1,800 ₪, "דוח בהתאמה אישית"), אותה תבנית בדיוק, עם ממצא משלה (ר' §2.7).

### 1.1 תרשים הזרימה - דוח אפס בסיסי (`baseReport`)

```
משתמש בוחר סוג עסקה (/start)
        │
        ▼
window.location.href = CARDCOM_LINK + SuccessRedirectUrl + FailedRedirectUrl
   (redirect מלא, לא iframe - הדפדפן עוזב את האתר שלנו)
        │
        ▼
[ עמוד תשלום Cardcom - חיצוני לגמרי, לא נראה בריפו הזה בכלל ]
        │  (הצלחה)                              (כישלון/ביטול)
        ▼                                              ▼
GET /calculator/?paid=true&dealType=X          GET /start/?payment=failed
        │
        ▼
useEffect קורא params.get("paid")==="true"
        │
        ▼
supabase.from("dohefes_reports").insert({
  payment_status: "paid",   ← המילה "paid" נכתבת כאן, מהדפדפן, תמיד
  deal_type, inputs, results
})
        │
        ▼
מקבל id (uuid) בחזרה, מחליף URL ל-?id=<uuid>
        │
        ▼
"הדוח שלכם נשמר" - reportId קיים מעכשיו = "משולם" בעיני שאר האתר
```

**ליד כל מעבר**:

| מעבר | מי שולט בנתון | ניתן לזייף מהדפדפן? | חתימה/אסמכתה? | אימות מול הספק? | idempotent? |
|---|---|---|---|---|---|
| בחירת סוג עסקה → redirect ל-Cardcom | הדפדפן (URL query שהאתר בעצמו בונה) | כן - זו רק כתובת redirect, אין בה עדיין שום דבר "מאובטח" | לא | - | - |
| Cardcom (חיצוני, לא בריפו) | **לא ניתן לאמת מהריפו** - ר' §3 | - | **לא ידוע** אם Cardcom חותם משהו בחזרה (לא נראה בקוד) | - | - |
| `SuccessRedirectUrl` חזרה לאתר | **הדפדפן** - זו כתובת רגילה שהדפדפן פונה אליה, בלי שום אימות שהיא באמת הגיעה מ-Cardcom | **כן, לגמרי** - כל אחד יכול להקליד `.../calculator/?paid=true&dealType=basic` ידנית בשורת הכתובת, בלי לשלם בכלל | **אין** | **אין** | - |
| `useEffect` → `insert` ל-Supabase | **הדפדפן** - קורא ל-Supabase REST API ישירות עם `NEXT_PUBLIC_SUPABASE_ANON_KEY` (מפתח ציבורי, מוטבע ב-JS) | כן - הבקשה עצמה נבנית ונשלחת מהלקוח | אין חתימה על הבקשה עצמה | אין | **לא** - כל טעינה עם `paid=true` יכולה ליצור `insert` (ממותן חלקית ב-`insertedRef`, ר' §2.4) |
| `reportId` נוצר | `gen_random_uuid()` בצד Supabase (`pgcrypto`), לא הלקוח | לא (הערך עצמו כן אקראי-קריפטוגרפית) | - | - | - |
| "מתי הדוח נחשב משולם" | **`payment_status` בשורת `dohefes_reports`, נכתב ישירות על ידי הלקוח** | **כן - לגמרי, ר' §2.1** | - | - | - |
| מניעת גישה לדוח אחר | **UUID כ"capability URL"** - מי שיודע את ה-`id` יכול לקרוא/לערוך אותו דוח (ר' §2.2) | תלוי בסודיות ה-UUID בלבד, לא בהרשאה אמיתית | - | - | - |

### 1.2 זרימת "דוח בהתאמה אישית" (`app/custom` + `app/custom/intake`) - נקראה כהשוואה

זהה לגמרי בעיקרון (`CARDCOM_LINK` נפרד, `SuccessRedirectUrl` ל-`/custom/intake/?paid=true`), אך
עם הבדל מהותי: `app/custom/intake/page.tsx` **לא קורא את `?paid=true` מה-URL בכלל** (נבדק
במפורש - אין `useEffect`/`URLSearchParams` בקובץ). הטופס עצמו כותב `paid: true` **ללא תנאי**
בכל שליחה (`handleSubmit`, שורה 59) - ניתן להגיע ישירות ל-`/custom/intake/` בלי לעבור ב-`/custom`
או ב-Cardcom בכלל, למלא טופס, ולקבל `paid:true`+ קריאה ל-`insure.co.il/api/dohefes/build-skeleton`.
**זה לא בתוך היקף `baseReport`/`cashFlowAnalysis` המבוקש, ולא מתוקן כאן** (אין שינוי קוד) - אך
הוא מדגים בפועל, בפרודקשן, את אותה מחלקת בעיה בדיוק שהמסמך הזה נועד למנוע. מתועד ב-§2.7, לא
מטופל.

---

## 2. ממצאי אבטחה לפי חומרה

### 2.1 קריטי - RLS מאפשרת כתיבה בלתי-מוגבלת ל-`payment_status`

`supabase/schema.sql` שורות 42-47:

```sql
create policy "anyone can update a dohefes report by id" on dohefes_reports
  for update using (true) with check (true);
```

`using (true) with check (true)` = **כל בעל מפתח anon (שהוא ציבורי לפי עיצוב Supabase, מוטבע
ב-JS) יכול לעדכן כל שדה בכל שורה, כולל `payment_status`, ישירות מ-REST API, בלי לעבור דרך
`/calculator` בכלל.** למשל, מהדפדפן (או `curl`):

```js
supabase.from("dohefes_reports").update({ payment_status: "paid" }).eq("id", "<any-uuid>")
```

הופך דוח כלשהו ל"משולם" ללא שום תשלום. **זה בדיוק הסיכון "כתיבת entitlement ישירות מהלקוח"**
שהמשתמש ביקש לבדוק - הוא כבר קיים היום, לא תיאורטי, ולא ייחודי לתזרים.

### 2.2 גבוה - RLS מאפשרת קריאה בלתי-מוגבלת (חשיפת נתונים)

```sql
create policy "anyone can read a dohefes report by id" on dohefes_reports
  for select using (true);
```

השם ("...by id") מטעה - המדיניות **לא** בודקת התאמת `id`, רק `true`. בקשת `GET /rest/v1/dohefes_reports?select=*`
עם מפתח ה-anon הציבורי מחזירה **את כל השורות בטבלה** - כל שמות הפרויקטים, סוגי עסקה, `inputs`
(כולל הנחות עלות/מכירה של לקוחות), לא רק דוח בודד לפי `id` ידוע. מודל "UUID כקישור-הרשאה"
(§1.1, "מניעת גישה לדוח אחר") **לא ממומש בפועל** - ה-UUID מגן רק על מי שלא יודע לשאול "תני לי
הכל", לא הגנה אמיתית.

### 2.3 גבוה - אין קשר אמיתי בין תשלום בפועל לרשומה שנוצרת

גם בלי (2.1), עצם ה-`insert` ב-`app/calculator/page.tsx:329-338` מותנה **רק** ב-`paid=true`
ב-query string (§1.1) - לא בשום אסמכתה מ-Cardcom. הקלדת ה-URL ידנית (בלי לשלם) יוצרת דוח עם
`payment_status:"paid"` באותה קלות בדיוק כמו תשלום אמיתי.

### 2.4 בינוני - הגנה חלקית בלבד מפני יצירה כפולה

`insertedRef` (`app/calculator/page.tsx:168,328`) מונע `insert` כפול **באותה טעינת עמוד** (דגל
`useRef` שמתאפס ברענון מלא). רענון הדפדפן על `?paid=true&dealType=X` **לפני** שה-URL הוחלף
ל-`?id=` (חלון קצר אך אמיתי, למשל אם הרשת איטית) יוצר `insert` שני. אין unique constraint או
idempotency key שמזהה "זו אותה עסקת תשלום" בצד השרת - אין צד שרת בכלל.

### 2.5 בינוני - אין הבחנה בין "חזר מהתשלום בהצלחה" ל"שילם בפועל"

מבחינת המערכת, "חזר עם `paid=true`" **הוא** "שילם" - אין ערוץ נפרד (webhook) שיכול לאשר תשלום
גם אם המשתמש סגר את הדפדפן/נפל החיבור לפני ה-`redirect` חזרה. הפוך גם נכון: `redirect` יכול
לקרות (או להיות מדומה) בלי שהתשלום בפועל הצליח בצד Cardcom.

### 2.6 נמוך - אין הפרדת סוגי מוצר במבנה הקיים

`payment_status` הוא שדה יחיד על `dohefes_reports`, לא קשור ל"איזה מוצר". זו בדיוק הסיבה
ש-`GEN2_CASHFLOW_UI_DESIGN.md` §0.1 כבר זיהה שאסור להשתמש בו לתזרים - אך הממצאים 2.1-2.3 מראים
שהבעיה עמוקה יותר מ"שדה משותף" - **גם שדה נפרד לגמרי (`ProductEntitlement`) יירש את אותה חולשה
אם ה-RLS שלו ייבנה באותה תבנית** (`using(true)`). §7 למטה בונה סכימה חדשה שלא חוזרת על זה.

### 2.7 מידע (out of scope, מתועד לשקיפות) - `dohefes_custom_orders` כבר "שבור" בפועל

ר' §1.2 - `app/custom/intake/page.tsx` כותב `paid:true` **ללא תנאי כלל**, לא רק "ניתן לזיוף" -
פשוט תמיד קורה. זה מוצר שלישי (`custom`, לא `baseReport`/`cashFlowAnalysis`), לא בהיקף המבוקש,
ולא מתוקן במסמך הזה. מתועד כי הוא ממחיש בפרודקשן את בדיוק סוג התקלה שהארכיטקטורה ב-§4 נועדה
למנוע.

---

## 3. מגבלות שלא ניתן לאמת מהריפו

**נכתב במפורש כדי לא להציג הנחה כעובדה**, לפי ההוראה:

- **יכולות Cardcom בפועל** - האם ה"LowProfile"/עמוד המוכן שהאתר מפנה אליו תומך ב-IPN/webhook
  צד-שרת עם חתימה (Cardcom כספק בישראל בדרך כלל תומך ב-API נפרד ל"ApiName"/"ApiPassword" ו/או
  IndicatorURL עם חתימה - אך זו ידיעה כללית על הספק, **לא אימות של ההגדרות בפועל בחשבון הזה**).
  אין בריפו שום מפתח API/סוד של Cardcom (`NEXT_PUBLIC_CARDCOM_LINK_*` הם רק קישורי redirect
  ציבוריים) - לא ניתן לדעת מכאן אם המנגנון הזה כבר מופעל בצד Cardcom או לא.
- **הרשאות/הגדרות בפועל של פרויקט ה-Supabase המשותף** - `schema.sql` הוא מקור-אמת מוצהר
  ("אותו פרויקט Supabase המשותף... כמו insure-vda/rami/hetel-hasbaha"), אך ריפו זה לא יכול
  לאמת שאין policies/functions נוספים שנוצרו ידנית ב-Dashboard ולא הוזנו כאן.
- **`insure.co.il/api/dohefes/build-skeleton`** - נקודת קצה שרת אמיתית שכבר קיימת וכבר מקבלת
  POST לא-מאומת מהאתר הסטטי הזה (ר' §1.2/§2.7). ייתכן שבריפו `insure-vda` (לא נגיש מכאן) יש
  כבר תשתית API routes/Edge Functions שיכולה לשמש בסיס למה שמוצע ב-§4/§5 - **לא ניתן לאמת**.
- **תוכנית Supabase (Free/Pro) והאם Edge Functions זמינות/מופעלות** - קובע מגבלות (זמן ריצה,
  concurrency, cold start) שרלוונטיות ל-§4 - לא ניתן לדעת מהריפו.
- **האם קיימת כבר טבלת `payment_status`/היסטוריה נוספת שלא ב-`schema.sql`** - הקובץ מתועד
  כ"מריצים פעם אחת ב-SQL Editor", ייתכנו migrations ידניים נוספים שלא תועדו בקובץ עצמו.

---

## 4. ארכיטקטורה מוצעת

**עיקרון-על**: מקור אמת אחד, בצד שרת, שהוא **היחיד** שיכול לכתוב `paid`. ה-UI (גם הקיים, גם
`/cashflow` העתידי) קורא בלבד, לעולם לא כותב.

```
משתמש                    האתר הסטטי (GitHub Pages)         Supabase Edge Function        Cardcom
  │                              │                                  │                         │
  │  בוחר מוצר (baseReport/      │                                  │                         │
  │  cashFlowAnalysis)           │                                  │                         │
  │─────────────────────────────▶│                                  │                         │
  │                              │  יוצר payment_order               │                         │
  │                              │  (status:"created", productType, │                         │
  │                              │   reportId, amountNis-לא נקבע     │                         │
  │                              │   כאן - רק מוצג)                  │                         │
  │                              │─────────────────────────────────▶│                         │
  │                              │                                  │  קובע מחיר אמיתי לפי     │
  │                              │                                  │  productType (לא לפי מה  │
  │                              │                                  │  שהלקוח שלח), status→    │
  │                              │                                  │  "pending", מייצר         │
  │                              │                                  │  orderId ייחודי           │
  │                              │◀─────────────────────────────────│                         │
  │                              │  redirect ל-Cardcom, עם orderId   │                         │
  │                              │  ב-SuccessRedirectUrl (לא         │                         │
  │                              │  productType/amount גולמיים)      │                         │
  │◀─────────────────────────────│                                  │                         │
  │───────────────────────────────────────────────────────────────────────────────────────────▶│
  │                                                                  │      תשלום בפועל          │
  │  חוזר ל-SuccessRedirectUrl (עם LowProfileCode)                                               │
  │  (הצגה בלבד - "תודה, בודקים" - עדיין לא entitlement!)                                        │
  │◀──────────────────────────────────────────────────────────────────────────────────────────│
  │  הדף הנטען קורא                │                                  │                         │
  │  dohefes-cardcom-payment-indicator     │                                  │                         │
  │  עם ה-LowProfileCode           │                                  │                         │
  │─────────────────────────────▶│─────────────────────────────────▶│                         │
  │                              │                                  │  GetLowProfileIndicator   │
  │                              │                                  │  (שאילתת אימות אמיתית -   │
  │                              │                                  │  לא סומכת על מה שהלקוח    │
  │                              │                                  │  אמר, שואלת את Cardcom    │
  │                              │                                  │  ישירות בעצמה)            │
  │                              │                                  │──────────────────────────▶│
  │                              │                                  │◀──────────────────────────│
  │                              │                                  │  בודקת: סכום/מטבע/מסוף/   │
  │                              │                                  │  orderId תואמים ל-payment_ │
  │                              │                                  │  order שנוצר בשלב הקודם.  │
  │                              │                                  │  רק אם תואם: status→"paid",│
  │                              │                                  │  יוצר/מעדכן product_       │
  │                              │                                  │  entitlement (idempotent   │
  │                              │                                  │  לפי paymentReference)     │
  │◀─────────────────────────────│◀─────────────────────────────────│                         │
  │  /cashflow טוען, שואל          │                                  │                         │
  │  "יש entitlement משולם?"      │                                  │                         │
  │─────────────────────────────▶│──────────────────────────────────▶│ dohefes-get-product-access       │
  │                              │                                  │ (קריאה בלבד, לא כתיבה)   │
```

**ההבדל המהותי מהיום**: ה-`SuccessRedirectUrl` **אינו** המקור לקביעת "שולם" יותר - הוא רק מחזיר
את המשתמש למסך שמראה סטטוס, יחד עם `LowProfileCode` שCardcom עצמו מחזיר. הסטטוס האמיתי נכתב
**רק** על ידי `dohefes-cardcom-payment-indicator` (§4.2), **רק** אחרי ששאלה את Cardcom ישירות (`GetLowProfileIndicator`)
מה קרה בפועל עם אותו `LowProfileCode` - לא הצהרה מהדפדפן, שאילתה יזומה מהשרת שלנו אל הספק. זה
המנגנון המדויק שה-audit (§0.2) מצא שחסר בכל ארבעת המיזמים האחרים - כולל אלה עם שרת אמיתי.

### 4.1 עקרונות מחייבים (לפי ההוראה, ממופים לתכנון)

| עיקרון | יישום מתוכנן |
|---|---|
| מחיר נקבע בצד שרת לפי `productType` | טבלת מחירים קבועה **בתוך קוד ה-Edge Function** (או טבלת `product_prices` נפרדת) - `amountNis` שמגיע מהלקוח **לא נקרא בכלל** בצד השרת, רק לתצוגה מקדימה ב-UI |
| entitlement נוצר רק אחרי אימות | `dohefes-cardcom-payment-indicator` (§4.2) היא **היחידה** עם `service_role key` שיכולה לכתוב ל-`product_entitlements`, ורק אחרי `GetLowProfileIndicator` מוצלח מול Cardcom - ר' §5 RLS |
| unique constraint על `(reportId, productType)` | `unique (report_id, product_type)` ב-`product_entitlements` - לא ניתן שיהיו שני entitlements פעילים לאותו זוג |
| אסמכתת ספק ייחודית, לא לשימוש חוזר | `unique (payment_reference)` ב-`payment_orders`, מאוכלס מ-`LowProfileCode`/`TranzactionId` שמתקבל מ-`GetLowProfileIndicator` - קריאה שנייה עם אותו קוד נדחית/מזוהה כ-idempotent replay, לא יוצרת entitlement שני |
| idempotency ל-callback/webhook | `payment_reference` (`LowProfileCode`) כמפתח idempotency - קריאה חוזרת ל-`dohefes-cardcom-payment-indicator` עם אותו קוד = no-op, לא שגיאה ולא כפילות |
| סטטוסים מפורשים | `created / pending / paid / failed / cancelled / refunded` - `enum`/`check` ב-`payment_orders.status`, ר' §5 |
| `cashFlowAnalysis` דורש `baseReport` משולם | נבדק בצד שרת בזמן יצירת ה-`payment_order` (לא רק ב-UI) - Edge Function מסרבת ליצור `payment_order` ל-`cashFlowAnalysis` בלי `product_entitlements` קיים עם `paymentStatus:"paid"` ל-`(reportId,"baseReport")` |
| הרשאה קשורה ל-`reportId` **וגם** `productType` | מפתח מורכב בכל שאילתה/constraint - לעולם לא "יש למשתמש הזה תשלום", תמיד "יש entitlement ל-(X,Y) הספציפיים" |
| UI מציג הצלחה, לא מעניק הרשאה | `/cashflow` (ואחריו `/calculator` בעתיד) **קוראים** `product_entitlements`, לעולם לא כותבים אליה |

### 4.2 שלוש ה-Edge Functions המתוכננות (מאושר)

שלושה functions נפרדים, כל אחד עם תפקיד יחיד - לא function אחד "עושה הכל":

**`dohefes-create-payment-order`**
- קלט: `reportId`, `productType`.
- קובעת מחיר **בצד שרת** לפי `productType` (טבלת/קבוע מחירים בקוד ה-function, לא לפי מה שהלקוח
  שלח - ר' §4.1).
- אם `productType==="cashFlowAnalysis"`: בודקת שקיים `product_entitlements` עם `paymentStatus:"paid"`
  ל-`(reportId,"baseReport")` **לפני** שהיא מרשה יצירת הזמנה - האכיפה של "עיקרון מחייב #7" (§0.1.3/§4.1)
  קורית כאן, לא רק ב-UI.
- יוצרת שורת `payment_orders` (`status:"created"`), ואז (עדיין באותה קריאה, או בקריאת Cardcom
  API נפרדת ליצירת LowProfile session - תלוי איך בדיוק Cardcom מנגיש את זה, ר' §8) מפיקה קישור
  תשלום עם `LowProfileCode`, ומחזירה אותו ללקוח להפניה.

**`dohefes-cardcom-payment-indicator`**
- מופעלת אחרי שהמשתמש חוזר מ-Cardcom (מ-`SuccessRedirectUrl`, נושא `LowProfileCode`) - **לא**
  webhook נכנס מ-Cardcom בהכרח (אלא אם יתברר שקיים ונרצה להוסיף גם אותו כערוץ נוסף, לא תחליף) -
  זו הקריאה שהלקוח (או `dohefes-get-product-access`, ר' למטה) יוזם.
- קלט: `LowProfileCode`.
- קוראת ל-Cardcom `GetLowProfileIndicator` (או שם ה-API המדויק לפי §8) **בעצמה**, לא סומכת על
  שום דבר שהגיע מהלקוח מעבר לקוד עצמו.
- **מאמתת בפועל**: סכום התשלום שחזר מ-Cardcom תואם ל-`amount_nis` שנשמר ב-`payment_order`
  המתאים; מטבע; מספר מסוף (`TerminalNumber`) תואם לחשבון שלנו; ה-`order`/`LowProfileCode`
  מזוהה מול `payment_order` קיים ב-status `created`/`pending`. **כל אי-התאמה = לא כותבת entitlement,
  מחזירה כשל, לא "כמעט מאשרת".**
- רק בהתאמה מלאה: מעדכנת `payment_orders.status→"paid"`, כותבת/מעדכנת `product_entitlements`
  (idempotent לפי `payment_reference` ייחודי - ר' §4.1).

**`dohefes-get-product-access`**
- קלט: `reportId`, `productType`.
- מחזירה **רק** `{ paymentStatus: "pending"|"paid"|"refunded" }` (או דומה) - **לא** את שורת
  ה-`payment_orders`/`entitlements` המלאה, לא נתונים אחרים. זו נקודת הקריאה **היחידה** שה-UI
  (`/cashflow`, ובעתיד `/calculator`) פונה אליה - לא `select` ישיר על הטבלאות (גם אם ה-RLS
  היה מאפשר זאת) - ריכוז נקודת הגישה במקום אחד מקל לשנות מדיניות select בעתיד (§5, "שיפור
  עתידי") בלי לשנות כל צרכן.

**Secrets - שמות בלבד, לא ערכים, ולא בריפו**: `Cardcom` (שם המסוף/API credentials - השם המדויק
תלוי איך Cardcom חושף את ה-API, ר' §8 סעיף 2) ו-`Supabase service role key` נשמרים **אך ורק**
כ-secrets מוצפנים בהגדרות Supabase Edge Functions (`supabase secrets set`) - **לא** ב-`NEXT_PUBLIC_*`
(שמוטבע בקוד הלקוח הציבורי), **לא** בקובץ בריפו, **לא** ב-`.env` שנכנס ל-git, **לא** מוצגים
בשום דוח/מסמך תכנון (כולל המסמך הזה) אפילו כדוגמה חלקית.

**דרישת פריסה: `dohefes-cardcom-payment-indicator` בלבד עם `verify_jwt=false`** (ממצא ביקורת, ר' הערה
מלאה בראש `supabase/functions/dohefes-cardcom-payment-indicator/index.ts`) - הקורא לפונקציה הזו הוא
Cardcom עצמה (webhook, שרת חיצוני), שאין לה שום דרך לצרף JWT/מפתח Supabase לבקשה - ברירת המחדל
(`verify_jwt=true`) הייתה חוסמת אותה. `dohefes-create-payment-order` ו-`dohefes-get-product-access` **אינן**
זקוקות לאותו פטור ולא אמורות לקבל אותו - הן נקראות מהדפדפן עם מפתח ה-anon (JWT תקין כשלעצמו,
עובר `verify_jwt` הרגיל בהצלחה). ביטול `verify_jwt` על פונקציה אחרת מלבד `dohefes-cardcom-payment-indicator`
דורש החלטה מפורשת ונפרדת, לא נגזר אוטומטית מהחריג הזה.

---

## 5. Schema ו-RLS מוצעים (תכנון בלבד, אין הרצה)

```sql
-- טבלת הזמנות תשלום - "ניסיון" שעדיין לא בהכרח שולם
create table if not exists dohefes_payment_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  report_id uuid not null references dohefes_reports(id),
  product_type text not null check (product_type in ('baseReport', 'cashFlowAnalysis')),
  amount_nis numeric not null,          -- נקבע ונכתב רק על ידי ה-Edge Function, לא הלקוח
  status text not null default 'created'
    check (status in ('created', 'pending', 'paid', 'failed', 'cancelled', 'refunded')),
  payment_reference text unique,        -- אסמכתת ספק, ייחודית - null עד שמגיע webhook
  updated_at timestamptz not null default now()
);

-- הרשאה בפועל - נכתבת רק לאחר paid מאומת
create table if not exists dohefes_product_entitlements (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references dohefes_reports(id),
  product_type text not null check (product_type in ('baseReport', 'cashFlowAnalysis')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded')),
  purchased_at timestamptz,
  payment_order_id uuid references dohefes_payment_orders(id),
  unique (report_id, product_type)
);

alter table dohefes_payment_orders enable row level security;
alter table dohefes_product_entitlements enable row level security;

-- אנונימי: יכול ליצור בקשת תשלום (status="created" בלבד - לא paid), לא לעדכן סטטוס
create policy "anyone can create a payment order request" on dohefes_payment_orders
  for insert with check (status = 'created');
-- אנונימי: יכול לקרוא רק את ההזמנות של הדוח שהוא כבר יודע את ה-id שלו (לא סתם "הכל")
create policy "read own report's payment orders" on dohefes_payment_orders
  for select using (true);  -- ר' הערה למטה על "אנונימי בלי login"
-- אין UPDATE policy לאנונימי בכלל - רק service_role (עוקף RLS מטבעו) יכול לשנות status

create policy "read own report's entitlements" on dohefes_product_entitlements
  for select using (true);  -- ר' אותה הערה
-- אין INSERT/UPDATE policy לאנונימי בכלל - רק Edge Function עם service_role
```

**הערה קריטית על "`using (true)` ל-select"**: זו עדיין המדיניות הקיימת גם כאן (ר' §7 סעיף
"אימות משתמש אנונימי" - אין login במערכת, אין דרך "לדעת" מי שואל). ההבדל המהותי מול המצב היום
**אינו** ב-select (קריאה) - הוא ש-**אין שום דרך לכתוב `paid` מלבד ה-Edge Function**. חשיפת מידע
על select פתוח (מי משלם על מה) היא סיכון פרטיות נמוך יותר מ"מי שקורא יכול גם לשלם על עצמו".
אם רוצים לצמצם גם את זה - אפשרות: `select` מוגבל לפי `report_id=` מפורש בשאילתה (Supabase לא
תומך "match the id in my query" כ-RLS condition בלי context token, נדרש `report_id = current_setting(...)`
דרך header ייעודי - **מוצע כשיפור עתידי, לא חוסם, ר' §8**).

**עדכון לאחר סקר §0**: העיקרון "**אין UPDATE policy לאנונימי בכלל**" (השורה החשובה ביותר בבלוק
ה-SQL למעלה) הוא בדיוק מה ש-`machria_cases` (לא `machria_stage2_cases`) כבר מממש בפרודקשן -
**נבחר כאן בזהירות, לא רק בהמלצה תיאורטית**. שני שיפורי select שאפשר לשקול, שני המיזמים לא
מיישמים אף אחד מהם היום, לא רק dohefes: (1) הגבלת `select` על `dohefes_payment_orders`/
`dohefes_product_entitlements` ל-`insert-only` בדיוק כמו `machria_cases` (במקום `using(true)`),
תוך הסתמכות על כך שהלקוח ממילא מקבל את הסטטוס בחזרה מהתגובה של יצירת ההזמנה/webhook, לא מ-select
נפרד; (2) `access_token` נפרד (§5.2 סעיף 2). אף אחד מהם לא קיים כבר-מוכן בשום מיזם שנסקר - שתיהן
נשארות שיפורים עתידיים, לא שינוי בהחלטה הנוכחית.

### 5.1 מי רשאי מה - טבלה מסכמת

| פעולה | אנונימי (anon key) | Edge Function (`service_role`) |
|---|---|---|
| יצירת `payment_order` | ✅ רק `status='created'` | ✅ (לא נחוץ בפועל, האנונימי יוצר) |
| עדכון `payment_order.status`→`pending`/`paid`/וכו' | ❌ | ✅ בלבד |
| קריאת `payment_order`/`entitlement` | ✅ (ר' הערה) | ✅ |
| יצירת/עדכון `entitlement` | ❌ **לעולם לא** | ✅ בלבד |

### 5.2 זיהוי משתמש אנונימי, ומניעת ניחוש/העתקת UUID

אין login במערכת - "הזדהות" היא הכרת ה-`reportId` (מודל capability-URL, כבר קיים היום). שתי
שכבות מוצעות, לא סותרות:

1. **`reportId` נשאר UUIDv4 אקראי-קריפטוגרפית** (`gen_random_uuid()`, כבר כך היום) - לא ניחוש
   מעשי (2^122 אפשרויות). זה מגן מפני **ניחוש**, לא מפני **חשיפה** (אם UUID דלף/שותף בטעות).
2. **token סודי נפרד מקישור הדוח - מוצע כשיפור, לא חובה ב-phase הראשון**: אם רוצים ש-`reportId`
   (שכבר מוצג בקישורי שיתוף - "מעבר לדוח מעקב בנייה ←" וכו') לא יהיה גם "מפתח התשלום", ניתן
   להוסיף `access_token` נפרד ל-`dohefes_payment_orders`/`entitlements` שלא נחשף בשום קישור
   ציבורי. **לא נדרש כדי לסגור את הממצאים הקריטיים ב-§2** (אלה נובעים מ-RLS פתוחה לכתיבה, לא
   מחוסר token) - מסומן כהחלטה נפרדת, ר' §8.

---

## 6. תכנית Migration ו-Rollback

### 6.1 מיפוי לקוחות קיימים

כל שורת `dohefes_reports` עם `payment_status='paid'` היום **ממופה ל-entitlement `baseReport`
משולם**, חד-פעמית, ב-migration script (לא באפליקציה):

```sql
insert into dohefes_product_entitlements (report_id, product_type, payment_status, purchased_at)
select id, 'baseReport', 'paid', created_at
from dohefes_reports
where payment_status = 'paid'
on conflict (report_id, product_type) do nothing;
```

**לא נמחק/לא נוגע ב-`dohefes_reports.payment_status` הקיים** - נשאר כפי שהוא (לקריאה
היסטורית/תאימות אחורה), רק **מפסיקים לסמוך עליו** לצורך הרשאה חדשה.

### 6.2 שלבי rollout (מדורג, מאושר - עודכן לפי §0.3 סעיף 6)

**עקרון מנחה**: `cashFlowAnalysis` הוא מוצר חדש לגמרי, בלי לקוחות קיימים שיכולים להישבר - נקודת
הכניסה הבטוחה ביותר לתשתית החדשה. `baseReport` עובר **רק אחרי** שהתשתית נבדקה על תנועה אמיתית.

1. **תשתית חדשה, טבלאות נפרדות** - יצירת `dohefes_payment_orders`/`dohefes_product_entitlements`
   (§5) + שלושת ה-Edge Functions (§4.2), עדיין **מנותקות מכל UI קיים**. `/calculator` ממשיך
   לקרוא/לכתוב `payment_status` בדיוק כמו היום - **לא משנה שום התנהגות קיימת**.
2. **הפעלה תחילה עבור `cashFlowAnalysis` בלבד** - `/cashflow` (כשייכתב) הוא **הצרכן הראשון
   והיחיד** של התשתית החדשה. `dohefes-create-payment-order`/`dohefes-get-product-access` נקראים רק ממנו.
   `baseReport` עדיין לא נוגע בתשתית הזו כלל בשלב הזה.
3. **בדיקות תשלום אמיתיות** - עסקאות אמיתיות (סכומים קטנים/test אם קיים ב-Cardcom, ר' §8 סעיף 3)
   על `cashFlowAnalysis` בלבד, כדי לאמת ש-`dohefes-cardcom-payment-indicator` באמת סוגר entitlement נכון
   על תנועה אמיתית - **לפני** שנוגעים ב-`baseReport` שכבר יש לו לקוחות משלמים.
4. **מעבר `baseReport` לתשתית החדשה** - רק אחרי שלב 3 הוכיח את עצמו: `/start`/`/calculator`
   עוברים ליצור/לקרוא דרך אותם שלושה Edge Functions (§4.2) במקום `?paid=true`/`payment_status`
   ישירים. ה-migration של §6.1 (מיפוי `payment_status='paid'` הקיים ל-entitlement) רץ **כאן**,
   לא בשלב 1 - כדי שהמיפוי יתבצע מול תשתית שכבר הוכחה עובדת.
5. **סגירת policies ישנות, רק בסוף** - **רק אחרי** ששלב 4 יציב בפרודקשן: מסירים את `for update
   using(true) with check(true)`/`for select using(true)` הפתוחים מ-`dohefes_reports` (§2.1/§2.2
   המקוריים), ומחליפים ב-policies מגבילות (בהשראת `machria_cases`, §0.2) - או, אם עד אז `/calculator`
   כבר לא כותב `payment_status` בכלל, אפשר גם לשקול Deprecation מלא של העמודה. **זה השלב שסוגר
   את §2.1/§2.2 בפועל** - לא מבוצע לפני שהאתר הישן כבר לא תלוי בהתנהגות הפתוחה.

### 6.3 Rollback

בכל שלב: מחיקת שתי הטבלאות החדשות (`drop table`) **לא פוגעת** ב-`dohefes_reports`/`payment_status`/
`inputs`/`results`/`tracking` הקיימים - אין foreign key בכיוון ההפוך, ואין קוד קיים שתלוי
בטבלאות החדשות (הן נצרכות רק על ידי `/cashflow` שעדיין לא נכתב). Rollback הוא פעולה מקומית,
לא דורש תיאום עם `/calculator`/`/report`/`/sample` הקיימים בשום שלב.

---

## 7. תכנית Commits קטנים (תכנון בלבד, אף אחד מהם לא בוצע) - עודכן לפי rollout §6.2

1. **Schema** - שתי הטבלאות + RLS (§5), **בלי** migration המיפוי (§6.1 - זה עבר לשלב 6 למטה,
   תואם §6.2). מנותק לגמרי מכל UI קיים - שלב שאפשר לבדוק שהוא לא שובר כלום.
2. **`dohefes-create-payment-order` - שלד** - קובעת מחיר לפי `productType` בצד שרת, בודקת דרישת
   `baseReport` משולם עבור `cashFlowAnalysis`, יוצרת `payment_order`. **עדיין בלי חיבור אמיתי
   ל-Cardcom** (stub/mock ליצירת LowProfile session, לבדיקה).
3. **`dohefes-cardcom-payment-indicator` + `dohefes-get-product-access`** - חיבור Cardcom בפועל
   (`GetLowProfileIndicator`, תלוי ב-§8) + נקודת הקריאה היחידה ל-UI. **הכי מסוכן משלב פיתוח** -
   נבדק בסביבת test/sandbox של Cardcom אם קיימת (§8 סעיף 3), לפני production.
4. **חיבור `/cashflow` בלבד** - שלב 2 ב-rollout (§6.2): `/cashflow` (כשייכתב) הוא הצרכן הראשון
   של שלושת ה-functions. `/calculator`/`/start`/`payment_status` **לא נוגעים כלל** בשלב הזה.
5. **בדיקות תשלום אמיתיות על `cashFlowAnalysis`** - שלב 3 ב-rollout, לא commit קוד בפני עצמו
   אלא תקופת אימות לפני שממשיכים.
6. **מעבר `baseReport`** - שלב 4 ב-rollout: `/start`/`/calculator` עוברים לתשתית החדשה,
   migration המיפוי (§6.1) רץ כאן.
7. **סגירת policies ישנות** - שלב 5 ב-rollout: הסרת `using(true)` הפתוח מ-`dohefes_reports`,
   רק אחרי ששלב 6 יציב בפרודקשן.

---

## 8. החלטות הדורשות ממני פעולה מול ספק הסליקה (Cardcom)

**עודכן לפי §0.3 סעיף 4**: המנגנון עצמו הוכרע - `LowProfileCode`/`GetLowProfileIndicator`, לא
webhook נכנס כברירת מחדל. מה שנשאר לברר מול הספק הוא הפרטים המדויקים של אותו מנגנון, לא האם
להשתמש בו:

1. **אימות שם ה-API המדויק וזרימת ה-`LowProfileCode` בחשבון הזה** - לוודא מול תיעוד Cardcom
   (או תמיכה) את השם/הפרמטרים המדויקים של `GetLowProfileIndicator` (או המקביל העדכני בגרסת
   ה-API של החשבון הזה), ואת האופן שבו יוצרים LowProfile session מלכתחילה (`dohefes-create-payment-order`,
   §4.2) - קריאת API נפרדת מ-Cardcom, לא רק בניית URL כמו היום. **אם יתברר שקיים גם webhook/IPN
   אמיתי בנוסף** - אפשר להוסיף אותו כערוץ משלים (מיידי יותר מ-polling בחזרת המשתמש), לא כתחליף
   ל-`GetLowProfileIndicator` (שממילא צריך לרוץ בכל מקרה בתור אימות).
2. **מפתחות API** - `ApiName`/`ApiPassword` (או מקבילים) לאימות מול Cardcom, לשמירה כ-secret
   ב-Supabase Edge Function (§4.2) - לא ב-`NEXT_PUBLIC_*`, לא בריפו הזה בכלל.
3. **סביבת sandbox/test** - האם יש סביבת בדיקה נפרדת אצל Cardcom, כדי לבדוק את הזרימה החדשה
   לפני שמחברים אותה לתשלומים אמיתיים (נדרש במפורש לפני שלב 3/5 ב-rollout, §6.2/§7).
4. **מדיניות refund** - כדי לממש `refunded` כסטטוס (§4.1) צריך להבין איך Cardcom מדווח על
   זיכוי - ידני מול הספק, API נפרד, או שזה בכלל לא ממומש אוטומטית בשלב הראשון (מוצע: ידני,
   לא לבנות אוטומציה של refund בלי צורך מוכח).
5. **מחיר בצד הספק מול בצד שלנו** - כרגע כל קישור Cardcom (`BASIC`/`CUSTOM`/`CONSULTATION`)
   כנראה מוגדר עם מחיר קבוע בצד Cardcom עצמו (לא נשלח דינמית). מוצר רביעי (`cashFlowAnalysis`)
   ידרוש קישור/הגדרה רביעית כזו בצד Cardcom (או פרמטר סכום דינמי אם ה-API של LowProfile תומך
   בכך - יתאם עם עקרון "מחיר בצד שרת", §4.1) - פעולה מנהלתית בממשק הספק, לא קוד.

**הוכרע, לא נשאר כאן**: השאלה "`insure-vda` כשרת משותף" (הייתה §8.1 בגרסה קודמת) - ר' §0.3 סעיף 1.

---

## 9. Diff

עדכון ל-`GEN2_PAYMENT_ENTITLEMENT_DESIGN.md` הקיים: §0.3 חדש (שמונה ההחלטות המאושרות), §4/§4.2
עודכנו (מנגנון `LowProfileCode`/`GetLowProfileIndicator`, שלושת ה-Edge Functions בשם, secrets),
§6.2/§7 נכתבו מחדש (rollout מדורג - `cashFlowAnalysis` לפני `baseReport`, סגירת RLS רק בסוף),
§8 עודכן (Cardcom - פרטי המנגנון שהוכרע, לא אם להשתמש בו; §8.1 הישן הוסר, הוכרע). על ענף
`gen2-cashflow-ui`. אין שינוי לשום קובץ אחר, באף ריפו.
