# תשתית תשלום והרשאות משותפת (baseReport + cashFlowAnalysis)

מסמך audit ותכנון בלבד. **אין בו שינוי קוד, Supabase, Edge Functions, או תהליך תשלום פעיל.**
נכתב על ענף `gen2-cashflow-ui`. נדרש **לפני** תחילת React ל-`/cashflow` (ר' `GEN2_CASHFLOW_UI_DESIGN.md`
§0.1) - הממצא המרכזי כאן משנה את §0.1: **אסור** לבנות מוצר נוסף על מנגנון ה"שולם" הקיים, כי הוא
לא רק "client-side בלי אימות שרת" (כפי שכבר תועד ב-§0.1.1/§0.1.4) אלא, כפי שנחשף כאן, **גם ניתן
לכתיבה ישירה מהדפדפן ללא שום תלות בתשלום בפועל** - ר' §2, חומרה קריטית.

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
  │                                                                  │◀────────────────────────│
  │                                                                  │  webhook/IPN חתום,       │
  │                                                                  │  status פעולה→"paid",    │
  │                                                                  │  יוצר/מעדכן               │
  │                                                                  │  product_entitlement      │
  │                              │                                  │  (idempotent לפי          │
  │                              │                                  │   paymentReference)       │
  │  חוזר ל-SuccessRedirectUrl                                                                   │
  │  (הצגה בלבד - "תודה, בודקים")                                                                │
  │◀──────────────────────────────────────────────────────────────────────────────────────────│
  │  /cashflow טוען, שואל          │                                  │                         │
  │  "יש entitlement משולם?"      │                                  │                         │
  │─────────────────────────────▶│──────────────────────────────────▶│ (קריאה בלבד, לא כתיבה)  │
```

**ההבדל המהותי מהיום**: ה-`SuccessRedirectUrl` **אינו** המקור לקביעת "שולם" יותר - הוא רק מחזיר
את המשתמש למסך שמראה סטטוס. הסטטוס האמיתי נכתב **רק** על ידי ה-Edge Function, **רק** אחרי אימות
מול Cardcom (webhook חתום, או שאילתת סטטוס API אם Cardcom תומכת - ר' §3, לא ידוע איזה מהשניים
זמין בפועל בחשבון הזה).

### 4.1 עקרונות מחייבים (לפי ההוראה, ממופים לתכנון)

| עיקרון | יישום מתוכנן |
|---|---|
| מחיר נקבע בצד שרת לפי `productType` | טבלת מחירים קבועה **בתוך קוד ה-Edge Function** (או טבלת `product_prices` נפרדת) - `amountNis` שמגיע מהלקוח **לא נקרא בכלל** בצד השרת, רק לתצוגה מקדימה ב-UI |
| entitlement נוצר רק אחרי אימות | ה-Edge Function היא **היחידה** עם `service_role key` שיכולה לכתוב ל-`product_entitlements` - ר' §5 RLS |
| unique constraint על `(reportId, productType)` | `unique (report_id, product_type)` ב-`product_entitlements` - לא ניתן שיהיו שני entitlements פעילים לאותו זוג |
| אסמכתת ספק ייחודית, לא לשימוש חוזר | `unique (payment_reference)` ב-`payment_orders` - webhook שני עם אותה אסמכתה נדחה/מזוהה כ-idempotent replay, לא יוצר entitlement שני |
| idempotency ל-callback/webhook | `payment_reference` (או `order_id` פנימי) כמפתח idempotency - כתיבה חוזרת עם אותו מזהה = no-op, לא שגיאה ולא כפילות |
| סטטוסים מפורשים | `created / pending / paid / failed / cancelled / refunded` - `enum`/`check` ב-`payment_orders.status`, ר' §5 |
| `cashFlowAnalysis` דורש `baseReport` משולם | נבדק בצד שרת בזמן יצירת ה-`payment_order` (לא רק ב-UI) - Edge Function מסרבת ליצור `payment_order` ל-`cashFlowAnalysis` בלי `product_entitlements` קיים עם `paymentStatus:"paid"` ל-`(reportId,"baseReport")` |
| הרשאה קשורה ל-`reportId` **וגם** `productType` | מפתח מורכב בכל שאילתה/constraint - לעולם לא "יש למשתמש הזה תשלום", תמיד "יש entitlement ל-(X,Y) הספציפיים" |
| UI מציג הצלחה, לא מעניק הרשאה | `/cashflow` (ואחריו `/calculator` בעתיד) **קוראים** `product_entitlements`, לעולם לא כותבים אליה |

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

### 6.2 שלבי rollout

1. יצירת שתי הטבלאות (§5) + migration המיפוי (§6.1) - **לא משנה שום התנהגות קיימת**, `/calculator`
   ממשיך לקרוא/לכתוב `payment_status` בדיוק כמו היום.
2. Edge Function נכתבת ונבדקת **בבידוד** (סביבת בדיקה של Supabase, לא production traffic).
3. `/cashflow` (כשייכתב) קורא **רק** מ-`dohefes_product_entitlements` - אף פעם לא מ-`payment_status`.
4. שלב מאוחר יותר, נפרד: אולי גם `/calculator` יעבור לקרוא `baseReport` entitlement במקום
   `payment_status` ישירות - **לא חלק מהיקף הזה**, `payment_status` ממשיך לשמש את `baseReport`
   כפי שהוא, בלי שינוי, עד החלטה נפרדת.

### 6.3 Rollback

בכל שלב: מחיקת שתי הטבלאות החדשות (`drop table`) **לא פוגעת** ב-`dohefes_reports`/`payment_status`/
`inputs`/`results`/`tracking` הקיימים - אין foreign key בכיוון ההפוך, ואין קוד קיים שתלוי
בטבלאות החדשות (הן נצרכות רק על ידי `/cashflow` שעדיין לא נכתב). Rollback הוא פעולה מקומית,
לא דורש תיאום עם `/calculator`/`/report`/`/sample` הקיימים בשום שלב.

---

## 7. תכנית Commits קטנים (תכנון בלבד, אף אחד מהם לא בוצע)

1. **Schema** - שתי הטבלאות + RLS (§5) + migration מיפוי (§6.1). **ללא Edge Function עדיין** -
   שלב שאפשר לבדוק שהוא לא שובר כלום (אף קוד לא קורא לטבלאות החדשות עדיין).
2. **Edge Function - שלד** - מקבלת בקשה ליצירת `payment_order`, קובעת מחיר לפי `productType`
   מטבלת/קבוע מחירים בצד שרת, בודקת דרישת `baseReport` משולם עבור `cashFlowAnalysis`. **עדיין
   בלי חיבור אמיתי ל-Cardcom** (stub/mock לבדיקה).
3. **חיבור Cardcom בפועל** - תלוי ב-§8 (החלטות מול הספק) - webhook חתום או polling API, לפי
   מה שהספק בפועל תומך בו. **הכי מסוכן משלב פיתוח** - נבדק בסביבת test/sandbox של Cardcom אם
   קיימת, לפני production.
4. **חיבור UI לקריאה בלבד** - `/start` (וגרסה מקבילה לתזרים) יוצרים `payment_order` דרך
   ה-Edge Function במקום redirect ישיר; `/calculator`/`/cashflow` קוראים `product_entitlements`
   לתצוגה. **זה השלב שמחליף בפועל את מנגנון ה-`?paid=true` הקיים ל-`baseReport`** - דורש תיאום
   זהיר כדי לא לשבור גישה ללקוחות קיימים (ר' §6.2).
5. **ניקוי/דעיכה** - לאחר תקופת ייצוב, שקילה אם להסיר את נתיב `?paid=true` הישן לגמרי או להשאירו
   כ-fallback. **החלטה נפרדת, לא כעת.**

---

## 8. החלטות הדורשות ממני פעולה מול ספק הסליקה (Cardcom)

1. **בדיקת יכולות IPN/webhook** - האם החשבון הקיים ב-Cardcom תומך בשליחת webhook חתום (או
   התראת IPN) לכתובת שאני אספק, ברגע שעסקה מאושרת - זה הפער המרכזי שסוגר את §2.3/§2.5. בלי
   זה, האפשרות היחידה היא polling API (שאילתת סטטוס עסקה יזומה מצידנו) - איטי יותר, עדיין
   עדיף מהיום.
2. **מפתחות API** - אם יש IPN/API, נדרשים `ApiName`/`ApiPassword` (או מקבילים) לאימות, לשמירה
   כ-secret ב-Supabase Edge Function (לא ב-`NEXT_PUBLIC_*`, לא בריפו הזה בכלל).
3. **סביבת sandbox/test** - האם יש סביבת בדיקה נפרדת אצל Cardcom, כדי לבדוק את הזרימה החדשה
   לפני שמחברים אותה לתשלומים אמיתיים.
4. **מדיניות refund** - כדי לממש `refunded` כסטטוס (§4.1) צריך להבין איך Cardcom מדווח על
   זיכוי - ידני מול הספק, API נפרד, או שזה בכלל לא ממומש אוטומטית בשלב הראשון (מוצע: ידני,
   לא לבנות אוטומציה של refund בלי צורך מוכח).
5. **מחיר בצד הספק מול בצד שלנו** - כרגע כל קישור Cardcom (`BASIC`/`CUSTOM`/`CONSULTATION`)
   כנראה מוגדר עם מחיר קבוע בצד Cardcom עצמו (לא נשלח דינמית). מוצר רביעי (`cashFlowAnalysis`)
   ידרוש קישור/הגדרה רביעית כזו בצד Cardcom - פעולה מנהלתית בממשק הספק, לא קוד.

---

## 9. Diff

מסמך חדש בלבד, `GEN2_PAYMENT_ENTITLEMENT_DESIGN.md`, על ענף `gen2-cashflow-ui`. אין שינוי לשום
קובץ אחר.
