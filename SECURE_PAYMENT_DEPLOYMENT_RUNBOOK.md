# Runbook: פריסת תשתית התשלום המאובטחת (secure-payment-deployment)

מסמך תפעולי בלבד - סדר פעולות מדויק לביצוע בפועל, כשתחליט לעבור לניסיון אמיתי. **לא בוצע כלום
ממה שכתוב כאן** - זה תכנון, לא ביצוע. כל שלב שגובה כסף אמיתי מסומן באזהרה נפרדת.

מבנה הענף כרגע (`secure-payment-deployment`, ממשיך את `secure-payment-foundation` שכבר מוזג
ל-`main`): migration אמיתי (`supabase/migrations/20260828062934_dohefes_payment_infrastructure.sql`,
מקור אמת יחיד - ר' §3) + שלוש Edge Functions בעלות תחילית `dohefes-` (`dohefes-create-payment-order`,
`dohefes-cardcom-payment-indicator`, `dohefes-get-product-access` - התחילית קיימת כי הפרויקט
המרוחק משותף גם ל-insure-vda/rami/hetel-hasbaha) - קוד בלבד, שום דבר לא רץ/פרוס.

## מה תוקן מאז הביקורת הקודמת

שני הפריטים שסווגו שם "חובה לפני ניסיון אמיתי" **בוצעו ואומתו** (בדיקות עוברות, ר' דוח ה-commit):

1. **timeout על קריאות ל-Cardcom** (`e5a98a5`) - `CARDCOM_FETCH_TIMEOUT_MS=15_000` (`AbortSignal.timeout`)
   על שני ה-fetch ב-`_shared/cardcom-client.ts` - קריאה תקועה כבר לא תוקעת את ה-Edge Function.
2. **מניעת הזמנות בלתי-מוגבלות** - **שני חלקים, שניהם נדרשים ושניהם בוצעו**:
   - שורת ההזמנה: `idx_dohefes_payment_orders_one_active_per_report_product` (`f74f3e3`, partial
     unique index) - מונע שתי **שורות** להזמנה לאותו report+product.
   - יצירת ה-Cardcom session עצמו: **לא הספיק** - התגלה (ובדוח קודם, בטעות, סומן כ"בוצע" לפני
     שזה הוכח) שה-index לבדו לא מונע שתי בקשות מקבילות שמאתרות את **אותה שורה** (`created`, בלי
     checkout עדיין) ומנסות **שתיהן** לקרוא ל-Cardcom. תוקן ב-`b735c0f`: claim/lease אטומי
     (`dohefes_claim_checkout_creation`, RPC) - רק בעל ה-claim קורא בפועל ל-Cardcom; המפסיד
     מקבל `503` כללי, בלי token מטעה. **עכשיו, ורק עכשיו, שני החלקים יחד מוכחים ב-39 בדיקות
     ייעודיות** (כולל claim פעיל/פג, timeout לא גורם לקריאה שנייה, מרוץ בין השלמה ל-retry).

כל אלה עדיין **לא נפרסו/הורצו** - הקוד קיים בענף, לא בסביבה חיה.

---

## שלב 1 - אילו פרטים לקבל מ-Cardcom

לפני שמתחילים, ודא שיש בידך מ-Cardcom (או מהפאנל שלהם):

1. **מספר מסוף (TerminalNumber)** - המספר שמזהה את חשבון הסליקה שלך אצל Cardcom.
2. **שם משתמש API (UserName)** - לא סיסמה נפרדת (הממשק שנבנה, API Level 10, לא דורש סיסמה -
   ר' `supabase/functions/_shared/cardcom-client.ts`).
3. **אישור מפורש** שהחשבון מורשה להשתמש ב-LowProfile API (יצירת דף תשלום) **וגם** ב-
   BillGoldGetLowProfileIndicator (בדיקת סטטוס עסקה) - שני ממשקים נפרדים, לא מובטח ששניהם
   מופעלים אוטומטית על כל חשבון.
4. **אם יש להם סביבת sandbox/מסוף בדיקה** - שאל מפורשות. אם כן, השתמש בו לשלבים 5-10 למטה
   לפני מעבר לכסף אמיתי (שלב 7). אם אין - שלבים 6-10 יתבצעו ישירות מול הכסף האמיתי, ראה אזהרה
   בשלב 7.

**לא צריך מ-Cardcom**: כתובות ה-callback (SuccessRedirectUrl/ErrorRedirectUrl/IndicatorUrl) -
אלה כתובות **שלך** (ר' שלב 2), לא משהו שהם נותנים לך.

---

## שלב 2 - אילו secrets להזין ב-Supabase (שמות בלבד)

**חשוב**: `SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` **לא** דורשים פעולה - Supabase מזריקה
אותם אוטומטית לכל Edge Function בפרויקט, בלי `supabase secrets set`. אין צורך לגעת בהם.

מה שכן צריך להזין (Dashboard: **Project Settings → Edge Functions → Secrets**, או `supabase
secrets set <NAME>=<value>` מה-CLI) - **שמות בלבד, אין ערכים כאן ובשום מסמך אחר בריפו**:

| שם ה-secret | מה נכנס בו | מקור |
|---|---|---|
| `DOHEFES_CARDCOM_TERMINAL_NUMBER` | מספר המסוף משלב 1 | Cardcom |
| `DOHEFES_CARDCOM_API_USERNAME` | שם המשתמש משלב 1 | Cardcom |
| `DOHEFES_CARDCOM_SUCCESS_URL` | כתובת בדף שלך שהמשתמש חוזר אליה אחרי תשלום מוצלח | האתר שלך |
| `DOHEFES_CARDCOM_ERROR_URL` | כתובת בדף שלך שהמשתמש חוזר אליה אחרי כישלון/ביטול | האתר שלך |
| `DOHEFES_CARDCOM_INDICATOR_URL` | הכתובת המלאה של `dohefes-cardcom-payment-indicator` **אחרי** שהיא נפרסת (שלב 4) - בפורמט `https://<project-ref>.supabase.co/functions/v1/dohefes-cardcom-payment-indicator` | הפרויקט שלך, נקבע רק אחרי הפריסה |
| `DOHEFES_ALLOWED_ORIGINS` | רשימת origins מופרדת בפסיקים (למשל `https://haimetkin-lgtm.github.io`) - ר' `_shared/payment-security.ts` | האתר שלך |

`DOHEFES_CARDCOM_INDICATOR_URL` תלוי בשלב 4 (הפריסה) - לכן סדר מומלץ בפועל: הזן קודם את חמשת השדות
הראשונים, פרוס את שלוש הפונקציות (שלב 4), ואז חזור והזן את `DOHEFES_CARDCOM_INDICATOR_URL` עם הכתובת
האמיתית שקיבלת, ופרוס מחדש רק את `dohefes-cardcom-payment-indicator` (secrets נטענים מחדש אוטומטית
עם כל deploy).

---

## שלב 3 - הרצת migration

**מקור אמת יחיד**: `supabase/migrations/20260828062934_dohefes_payment_infrastructure.sql` -
קובץ migration אמיתי (לא `supabase/payment-schema.sql` הישן - הועבר, לא שוכפל; אם אתה רואה
עדיין את הקובץ הישן בסביבה שלך, הענף לא מעודכן). מזוהה על ידי Supabase CLI (`supabase migration
list`) בזכות מיקומו (`supabase/migrations/`) ותבנית שמו (`<timestamp>_<name>.sql`, נוצר על ידי
`supabase migration new`, לא הומצא ידנית).

**נתיב ראשי - `supabase db push` (מומלץ)**:

1. **גיבוי** - לפני כל migration בפרויקט הזה: Dashboard → **Database → Backups** - ודא שיש
   גיבוי אוטומטי עדכני (או הרץ ידני אם אתה רוצה נקודת שחזור טרייה יותר).
2. ודא שהפרויקט מקושר (`npx supabase link --project-ref giygjmacxquucwexmfdd` - כבר בוצע בסבב
   קודם; `npx supabase migration list --linked` אמור להראות את הקובץ תחת "Local" ותחת "Remote"
   כ-`Not Applied` אם עוד לא רץ).
3. הרץ: `npx supabase db push`. **חשוב לגבי טרנזקציות**: אין צורך בעטיפת `BEGIN;`/`COMMIT;`
   ידנית בקובץ עצמו (וגם לא הוספתי כזו) - Supabase CLI מריץ כל migration דרך `pgx` `ExecBatch`,
   שמתועד בקוד המקור עצמו (github.com/supabase/cli, `pkg/migration/file.go`) כ-"implicitly
   transactional" - הכל-או-כלום מובטח על ידי הכלי עצמו, לא הונח.
4. **ציפייה**: הודעת הצלחה, ושורה חדשה ב-`supabase_migrations.schema_migrations` (ניתן לוודא
   עם `npx supabase migration list --linked` - הקובץ אמור לעבור מ-`Not Applied` ל"מיושם" בשני
   הצדדים). אם מופיעה שגיאה `relation "dohefes_reports" does not exist` - הפרויקט שאתה מריץ
   עליו אינו הפרויקט הנכון (הסכמה מניחה ש-`dohefes_reports` כבר קיים - זה אכן המצב ב-
   `giygjmacxquucwexmfdd`, אומת מראש, ר' §6 בדוח הביקורת).
5. **אם הפקודה נכשלת**: ה-transaction האוטומטי של ה-CLI כבר דואג לכך שכלום לא נשאר חלקי (זו
   בדיוק הנקודה ב-"implicitly transactional" למעלה) - אמת בפועל בכל זאת:
   ```sql
   select count(*) from pg_tables where tablename in ('dohefes_payment_orders', 'dohefes_product_entitlements');
   select count(*) from pg_proc where proname like 'dohefes_%';
   ```
   (דרך `npx supabase db query --linked "<שאילתה>"` - קריאה בלבד, לא דורש סיסמת DB). **ציפייה**:
   `0` בשתיהן אם הכשל היה אמיתי. אם יש תוצאה חלקית - השתמש בבלוק ה-Rollback המתועד בתחתית
   קובץ ה-migration (מריצים אותו כ-migration חדש נפרד עם `supabase migration new`, לא מדביקים
   ידנית), ואז התייעץ לפני ניסיון חוזר.
6. **אל תריץ `supabase db push` פעם שנייה "סתם"** - ברגע שה-migration כבר מיושם (רשום ב-
   `schema_migrations`), ה-CLI עצמו לא ינסה להריץ אותו שוב (זו בדיוק המטרה של טבלת המעקב) -
   הרצה חוזרת "ליתר ביטחון" לא אמורה לגרום נזק דרך ה-CLI (בניגוד להדבקה ידנית ב-SQL Editor,
   ר' נתיב גיבוי למטה, שם `CREATE TRIGGER` לא-אידמפוטנטי כן היה גורם לשגיאה).

**נתיב גיבוי - SQL Editor ידני (רק אם `db push` לא עובד מסיבה כלשהי)**:

פתח את `supabase/migrations/20260828062934_dohefes_payment_infrastructure.sql` מהריפו, העתק
את **כל** התוכן, והדבק ב-Dashboard → **SQL Editor → New query**, עטוף **במפורש** ב-`BEGIN;`/
`COMMIT;`:
```sql
BEGIN;

-- <כל תוכן הקובץ שהעתקת, ללא שינוי>

COMMIT;
```
**כאן, בניגוד ל-`db push`, העטיפה הידנית כן נדרשת** - ל-SQL Editor אין את אותה ערבות טרנזקציונית
אוטומטית שיש ל-`pgx` `ExecBatch` של ה-CLI. אם פקודה נכשלת: הרץ `ROLLBACK;` מיד (שורה נפרדת),
ואמת עם שתי השאילתות בסעיף 5 למעלה. **אזהרה**: הנתיב הזה **לא** ירשום שורה ב-
`supabase_migrations.schema_migrations` - `npx supabase migration list --linked` ימשיך להראות
את הקובץ כ-`Not Applied` גם אחרי שהוא רץ בפועל, מה שעלול לבלבל ריצות עתידיות של `db push`. אם
השתמשת בנתיב הזה, תעד זאת ותתייעץ לפני `db push` עתידי על אותו פרויקט.
זהה גם ל-`db push`: **אל תריץ את הקובץ פעם שנייה** דרך הנתיב הזה - ה-`create trigger` בקובץ
**אינם אידמפוטנטיים** (Postgres לא תומך ב-`CREATE TRIGGER IF NOT EXISTS`) - הרצה שנייה תיכשל
מיד ב-`create trigger dohefes_payment_orders_touch_updated_at` ("already exists"). זו שגיאה
**צפויה ובטוחה** (בתוך `BEGIN;`/`COMMIT;` היא פשוט תבטל את הריצה השנייה כולה) - היא הסימן
שהריצה הקודמת כבר הצליחה, לא תקלה לתקן.

---

## שלב 4 - פריסת שלוש הפונקציות + הגדרת JWT

### הגדרת JWT - `dohefes-cardcom-payment-indicator` בלבד עם `verify_jwt=false`

`supabase/config.toml` **כבר קיים בריפו** (הוכן מראש, ר' commit `1ef0584`) עם בדיוק ההגדרה
הדרושה - אין צורך ליצור/לערוך אותו:

```toml
[functions.dohefes-cardcom-payment-indicator]
verify_jwt = false

# dohefes-create-payment-order ו-dohefes-get-product-access: לא מוזכרות כאן בכוונה - נשארות עם ברירת המחדל
# (verify_jwt=true). הדפדפן קורא להן דרך supabase.functions.invoke עם מפתח ה-anon, שהוא
# כשלעצמו JWT תקין וחתום שעובר את הבדיקה - אין להן צורך בפטור. שינוי ההגדרה הזו לפונקציה
# אחרת מלבד dohefes-cardcom-payment-indicator דורש החלטה מפורשת ונפרדת, לא נגזר מהחריג הזה.
```

### פריסה בפועל (CLI)

Supabase CLI מותקן כתלות dev מקומית (`npm install supabase --save-dev`, לא global) - כל פקודה
דרך `npx`:

```bash
npx supabase functions deploy dohefes-create-payment-order
npx supabase functions deploy dohefes-get-product-access
npx supabase functions deploy dohefes-cardcom-payment-indicator --no-verify-jwt
```

(הדגל `--no-verify-jwt` על השלישית מיותר בפועל בהינתן `config.toml` הקיים, אך לא מזיק - שני
המנגנונים אומרים את אותו דבר; שמור אותו כביטוח למקרה שה-`config.toml` לא נטען מסיבה כלשהי.)

**ציפייה**: כל פקודה מדפיסה "Deployed Function" עם כתובת. **עכשיו** יש לך את הכתובת
ל-`DOHEFES_CARDCOM_INDICATOR_URL` (שלב 2) - חזור, הזן אותה, ופרוס מחדש רק את `dohefes-cardcom-payment-indicator`.

**איך לוודא שה-JWT הוגדר נכון**: Dashboard → **Edge Functions** → לחץ על `dohefes-cardcom-
payment-indicator` → לשונית **Details/Settings** - אמור להופיע "JWT verification: Disabled"
(או ניסוח דומה, תלוי גרסת ה-Dashboard). עבור שתי הפונקציות האחרות - אמור להופיע "Enabled"
(ברירת המחדל).

---

## שלב 5 - בדיקת sandbox/עסקת בדיקה

אם ב-שלב 1 קיבלת אישור ש-Cardcom מספקת סביבת sandbox: הזן זמנית את פרטי ה-sandbox (terminal
number/username נפרדים, אם קיימים) ב-secrets (שלב 2), ובצע שלבים 6-10 למטה מולם קודם. אחרי
שהכל עובד ב-sandbox, **החלף את ה-secrets בפרטים האמיתיים** ופרוס מחדש (שלב 4) לפני שלב 6-10
עם כסף אמיתי.

אם אין sandbox - דלג לשלב 6 (כסף אמיתי מהשלב הראשון - ר' אזהרה בשלב 7).

---

## שלב 6 - יצירת הזמנת `cashFlowAnalysis`

**תנאי מקדים חשוב**: `cashFlowAnalysis` דורש (ב-`dohefes-create-payment-order`) שהדוח כבר `paid` עבור
`baseReport` (המנגנון **הישן**, `dohefes_reports.payment_status` - עדיין לא הוחלף, ר'
`GEN2_PAYMENT_ENTITLEMENT_DESIGN.md` §6.2 שלב 4). כדי לבדוק, צריך דוח קיים עם
`payment_status='paid'`. אין React מחובר עדיין (מכוון), אז הבדיקה כאן היא דרך `curl` ישירות.

1. **בחר/צור דוח בדיקה**: אם יש לך דוח אמיתי שכבר שולם - השתמש בו. אחרת, צור דוח חדש דרך
   `/calculator` באתר (בלי לשלם), קח את ה-`id` שלו מה-URL (`?id=<uuid>`), ואז ב-SQL Editor
   (**רק על דוח בדיקה, לא דוח לקוח אמיתי**):
   ```sql
   update dohefes_reports set payment_status = 'paid' where id = '<test-report-id>';
   ```
   זה מסמן את ה-baseReport כמשולם **למטרת הבדיקה בלבד** (המנגנון הישן) - לא קשור לתשתית
   החדשה שאנחנו בודקים כאן.

2. **קרא ל-dohefes-create-payment-order**:
   ```bash
   curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/dohefes-create-payment-order" \
     -H "Content-Type: application/json" \
     -H "Origin: <אחד מה-origins שהוגדרו ב-DOHEFES_ALLOWED_ORIGINS>" \
     -H "Authorization: Bearer <ANON_KEY של הפרויקט>" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{"reportId":"<test-report-id>","productType":"cashFlowAnalysis"}'
   ```
   (בלי `-H "Origin: ..."` תקבל `403 origin_not_allowed` - זו התנהגות תקינה, לא באג; ר'
   ממצאי ה-CORS בדוח.)

3. **ציפייה**: `200`, גוף עם `{ orderId, checkoutUrl, accessToken, status: "pending" }`.
   **שמור את שלושתם** - `orderId` לשלב 8, `checkoutUrl` לשלב 7, `accessToken` לשלב 10.
4. **אם קיבלת `503 {"error":"checkout_creation_in_progress"}`**: זו תגובה תקינה, לא שגיאה -
   אומרת שיש כבר ניסיון פעיל ליצור checkout לאותה הזמנה (claim פעיל, ר' `b735c0f`) - למשל אם
   הרצת את הקריאה פעמיים כמעט בו-זמנית. פשוט המתן כמה שניות ונסה שוב.

---

## שלב 7 - ביצוע תשלום אמיתי אחד

> **⚠️ שלב זה גובה כסף אמיתי** (אלא אם אתה עדיין ב-sandbox משלב 5). המחיר הוא הסכום הקבוע
> ל-`cashFlowAnalysis` (ר' `_shared/payment-products.ts`) - ודא שאתה מודע לכך לפני שממשיך.

1. פתח את ה-`checkoutUrl` משלב 6 בדפדפן.
2. השלם תשלום עם כרטיס אמיתי (או פרטי בדיקה, אם ב-sandbox).
3. אחרי הצלחה, אתה מגיע ל-`DOHEFES_CARDCOM_SUCCESS_URL` שהגדרת. **בשלב הזה** (אם ה-IndicatorUrl הוגדר
   נכון ו-Cardcom קוראת לו) - `dohefes-cardcom-payment-indicator` אמורה כבר לרוץ ברקע. אם ה-IndicatorUrl
   לא מוגדר נכון, או ש-Cardcom לא קוראת לו אוטומטית, תצטרך לגרות אותו ידנית - ר' שלב 9.

---

## שלב 8 - בדיקה שההזמנה הפכה `paid` ונוצר entitlement אחד בלבד

ב-SQL Editor:

```sql
select id, status, verified_at, paid_at, cardcom_internal_deal_number
from dohefes_payment_orders
where id = '<orderId משלב 6>';
```

**ציפייה**: `status='paid'`, `verified_at`/`paid_at` לא null, `cardcom_internal_deal_number`
מלא.

```sql
select id, report_id, product_type, entitlement_status, payment_order_id
from dohefes_product_entitlements
where report_id = '<test-report-id>' and product_type = 'cashFlowAnalysis';
```

**ציפייה**: **שורה אחת בלבד**, `entitlement_status='active'`, `payment_order_id` תואם ל-`orderId`.

אם ה-`status` עדיין `pending`: `dohefes-cardcom-payment-indicator` עוד לא רצה (ר' שלב 9, קריאה ידנית).

---

## שלב 9 - retry של Indicator והוכחת idempotency

בלי Authorization header (ר' שלב 4 - הפונקציה הזו מוגדרת `verify_jwt=false`, זו בדיוק הסיבה):

```bash
curl -i "https://<project-ref>.supabase.co/functions/v1/dohefes-cardcom-payment-indicator?LowProfileCode=<ה-LowProfileCode האמיתי מ-Cardcom>"
```

(אם אין לך את ה-LowProfileCode בהישג יד - הוא לא נחשף בתגובת dohefes-create-payment-order בכוונה; ניתן
לשלוף אותו מ-`select cardcom_low_profile_code from dohefes_payment_orders where id='<orderId>'`.)

**קרא לזה פעמיים ברצף** (זה בדיוק ה"retry"). **ציפייה**: `200` בשתי הפעמים, ושורת ה-entitlement
בשלב 8 **נשארת שורה אחת** (לא הכפילה את עצמה) - זו ההוכחה ל-idempotency (`already_finalized`
ב-RPC בפעם השנייה).

---

## שלב 10 - בדיקת token שגוי ונכון

**token נכון** (מ-שלב 6, `accessToken`):
```bash
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/dohefes-get-product-access" \
  -H "Content-Type: application/json" \
  -H "Origin: <אחד מה-origins שהוגדרו>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "X-Access-Token: <accessToken משלב 6>" \
  -d '{"reportId":"<test-report-id>","productType":"cashFlowAnalysis"}'
```
**ציפייה**: `{"status":"active"}`.

**token שגוי**: אותה קריאה עם `X-Access-Token: garbage-value-123`.
**ציפייה**: `{"status":"unavailable"}` - **אותה תגובה בדיוק** שהייתה מתקבלת עבור דוח לא-קיים
או מוצר-לא-נרכש (זה הכוונה, לא באג - ר' ממצאי dohefes-get-product-access).

---

## מה קורה אם שלב נכשל (Rollback)

- **שלב 3 (migration) נכשל**: `db push` - ה-CLI כבר עוטף אוטומטית (implicitly transactional,
  ר' §3), אבל עדיין אמת בפועל עם `pg_tables`/`pg_proc` (§3 סעיף 5) - אל תניח בלי לבדוק. אם
  השתמשת בנתיב הגיבוי (SQL Editor ידני): `ROLLBACK;` מיידי, ואז אותו אימות. אם נשאר משהו חלקי
  בכל מקרה - בלוק ה-Rollback המתועד בתחתית `supabase/migrations/20260828062934_dohefes_payment_infrastructure.sql`.
- **פונקציה נכשלת בפריסה (שלב 4)**: `npx supabase functions delete <name>` ונסה שוב אחרי שתיקנת.
- **תשלום אמיתי בוצע (שלב 7) אך שלב 8 מראה שההזמנה לא הפכה `paid`**: זה **לא** משהו שרולבק
  טכני פותר - הכסף כבר עבר אצל Cardcom. פנה לתמיכת Cardcom לבירור/זיכוי (פעולה עסקית, לא
  טכנית) - **אל תריץ UPDATE ידני** על `dohefes_payment_orders`/`dohefes_product_entitlements`
  כדי "לתקן" את המצב בעצמך; זה עוקף את כל שכבות האימות שנבנו. אם צריך לסמן הזמנה כ-paid ידנית
  אחרי אימות ישיר מול Cardcom (לא ניחוש) - זו החלטה נפרדת שדורשת דיון, לא צעד רוטיני ברשימה הזו.
- **לבטל את כל התשתית (חזרה למצב לפני הענף הזה)**: בלוק ה-Rollback + `npx supabase functions
  delete` לשלוש הפונקציות. שום דבר ב-`dohefes_reports` לא נגע, כך שהמערכת הקיימת (baseReport
  דרך המנגנון הישן) ממשיכה לעבוד ללא שינוי.
