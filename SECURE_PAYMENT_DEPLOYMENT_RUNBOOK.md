# Runbook: פריסת תשתית התשלום המאובטחת (secure-payment-deployment)

מסמך תפעולי בלבד - סדר פעולות מדויק לביצוע בפועל. **שלב 3 (migration) בוצע בפועל ואומת** (ר'
"מצב בפועל" בתוך §3) - שאר השלבים (Functions, secrets, Cardcom) עדיין **לא בוצעו**, זה עדיין
תכנון. כל שלב שגובה כסף אמיתי מסומן באזהרה נפרדת.

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

שני התיקונים עצמם קיימים כעת **גם** במבנה הנתונים המרוחק (ה-migration שמממש אותם - claim/lease
RPC וה-partial unique index - רץ בפועל, ר' "מצב בפועל" ב-§3). מה שעדיין **לא נפרס/הורץ**: שלוש
ה-Edge Functions, ה-secrets, וכל קריאה אמיתית ל-Cardcom.

---

## גבול האימות (חובה לקרוא לפני כל פריסה)

> **המערכת נבדקה טכנית באמצעות בדיקות וסימולציות. לא בוצעה עסקה כספית חיה. האינטגרציה החיה
> מול Cardcom לא אומתה מקצה לקצה באמצעות חיוב בפועל.**

**מה כן נבדק, אוטומטית, בלי חיוב** (527 בדיקות, `npx vitest run`):

| קטגוריה | איפה |
|---|---|
| Unit tests | כל מודול ב-`_shared/` (money, name-to-value, payment-products, payment-security, cors) |
| Integration עם fakes/mocks | `payment-order-service.test.ts`, `payment-indicator-service.test.ts`, `payment-access-service.test.ts` - כל ה-orchestration נבדק מול DB/Cardcom מזויפים |
| Idempotency ומרוצים | Idempotency-Key כפול, claim/lease (פעיל/פג/מרוץ מקביל), partial unique index (מתועד ב-SQL, ר' למטה) |
| Timeout/retry | `AbortSignal.timeout` מדומה, סיווג כשל ודאי מול לא-ודאי (`isAmbiguousCardcomFailure`), retry לא יוצר session/חיוב כפול |
| Cardcom - תגובות תקינות/כושלות/כפולות/חלקיות | `cardcom-client.test.ts` (ResponseCode שגוי, שדות חסרים, host לא מאושר, timeout), `payment-indicator-service.test.ts` (callback כפול, אי-התאמת סכום/מטבע/ReturnValue, תגובה לא-ודאית) |
| CORS | `cors.test.ts` (חדש) - Origin echo מדויק, בלי `*`, Methods/Headers מוגבלים, בלי Allow-Credentials |
| Access tokens | `payment-security.test.ts` (generateAccessToken/hashAccessToken/generateClaimToken), נבדק גם ב-orchestration שטוקן לא נשלח/נדרס בטעות |

**מה לא ניתן לבדוק אוטומטית בשלב הזה, ולמה**:
- **RLS בפועל** - נבדק בקוד (`using(true)`/`grant`/`policy` grep, ר' ביקורות קודמות) ומתועד כתרחישי SQL בתחתית קובץ ה-migration, אבל **לא הורץ בפועל** - RLS נאכפת רק מול Postgres חי עם roles אמיתיים, ואין הרשאה להריץ migration בשלב הזה.
- **JWT ברמת השער** - `verify_jwt=false` על `dohefes-cardcom-payment-indicator` מוגדר נכון ב-`config.toml` (קוד תקין, אומת), אבל האכיפה בפועל קורית ב-gateway של Supabase, לפני שהקוד רץ בכלל - ניתן לאמת רק **אחרי** פריסה אמיתית (Dashboard, ר' שלב 4).
- **Cardcom חי (sandbox או production)** - שום קריאת רשת אמיתית ל-Cardcom לא בוצעה בשום שלב של העבודה הזו. אם קיים מסוף בדיקה/sandbox בחשבון Cardcom - זה לא אומת (ר' שלב 1: "שאל מפורשות", לא "הנח שקיים").

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
| `DOHEFES_CARDCOM_SUCCESS_URL` | **סוכם 2026-08-28, מתוקן 2026-08-28** (ר' `GEN2_CASHFLOW_UI_DESIGN.md` §0.1.5/§0.1.5א-ו): `https://haimetkin-lgtm.github.io/dohefes/payment-return/?outcome=success` | האתר שלך |
| `DOHEFES_CARDCOM_ERROR_URL` | **סוכם 2026-08-28, מתוקן 2026-08-28**: `https://haimetkin-lgtm.github.io/dohefes/payment-return/?outcome=cancelled` | האתר שלך |
| `DOHEFES_CARDCOM_INDICATOR_URL` | הכתובת המלאה של `dohefes-cardcom-payment-indicator` **אחרי** שהיא נפרסת (שלב 4) - בפורמט `https://<project-ref>.supabase.co/functions/v1/dohefes-cardcom-payment-indicator` | הפרויקט שלך, נקבע רק אחרי הפריסה |
| `DOHEFES_ALLOWED_ORIGINS` | רשימת origins מופרדת בפסיקים (למשל `https://haimetkin-lgtm.github.io`) - ר' `_shared/payment-security.ts` | האתר שלך |

`DOHEFES_CARDCOM_INDICATOR_URL` תלוי בשלב 4 (הפריסה) - לכן סדר מומלץ בפועל: הזן קודם את חמשת השדות
הראשונים, פרוס את שלוש הפונקציות (שלב 4), ואז חזור והזן את `DOHEFES_CARDCOM_INDICATOR_URL` עם הכתובת
האמיתית שקיבלת, ופרוס מחדש רק את `dohefes-cardcom-payment-indicator` (secrets נטענים מחדש אוטומטית
עם כל deploy).

**למה `DOHEFES_CARDCOM_SUCCESS_URL`/`DOHEFES_CARDCOM_ERROR_URL` לא כוללות `reportId`**: הן נשארות
כתובות **קבועות** (לא נבנות דינמית per-בקשה - כך גם בקוד הקיים, `dohefes-create-payment-order/index.ts:305-306`)
בכוונה - `reportId`/`productType`/`accessToken` נשמרים ב-`localStorage` בצד הלקוח **לפני** המעבר
ל-Cardcom, במפה (`dohefes.pendingPurchases`) שמפתחה הוא `paymentContextId` (שדה חדש בתגובת
`dohefes-create-payment-order`, ר' `payment-order-service.ts` - זהה בדיוק ל-`ReturnValue` שנשלח
ל-Cardcom). **תיקון חשוב (2026-08-28)**: בניגוד למה שנרשם כאן במקור, ה-URL של החזרה **כן** נקרא
בפועל - Cardcom כן מתעדת רשמית שהיא מחזירה את `ReturnValue` גם לעמוד ההצלחה, לא רק ל-Indicator
(ר' המקור הרשמי שצוטט ב-§0.1.5א) - הוא משמש כמפתח לאיתור הרשומה הנכונה במפה כשיש כמה הזמנות
פתוחות בו-זמנית (כמה לשוניות), ונקרא **case-insensitively** כי לתיעוד/לדוגמאות של Cardcom יש
חוסר-עקביות casing מתועד. פירוט מלא (כולל TTL, ניקוי, ו-8 שלבי הזרימה): `GEN2_CASHFLOW_UI_DESIGN.md`
§0.1.5א-ו.

---

## שלב 3 - הרצת migration

### מצב בפועל (2026-08-28) - בוצע

ה-migration (`20260828062934_dohefes_payment_infrastructure.sql`) **רץ בפועל** מול הפרויקט
המרוחק (`giygjmacxquucwexmfdd`) דרך `npx supabase db push --linked`, אחרי `--dry-run` שאישר
קובץ יחיד. אומת בקריאה בלבד אחרי ההרצה: `migration list --linked` מראה `local`/`remote` עם אותו
timestamp, שתי הטבלאות + חמשת ה-RPC/functions + שלושת ה-triggers + האינדקס הייחודי החלקי קיימים,
RLS מופעל בשתיהן עם **אפס** policies (כולל אימות בפועל עם `set role anon` - מחזיר `[]` על שתי
הטבלאות, לעומת שורה אמיתית שכן חוזרת מ-`dohefes_reports` עם אותו role, כך שהבדיקה אכן משמעותית
ולא רק "אין בכלל connection"), `dohefes_reports` ללא שינוי (רק העמודות הקיימות מראש), אין שינוי
בשום טבלה של מיזם אחר (`rami_*`/`machria_*`/`cases`/`leads` וכו' - נבדקה רשימת הטבלאות המלאה),
ושתי הטבלאות החדשות ריקות (0 שורות).

**חשוב - אין גיבוי מנוהל לפרויקט הזה כרגע**: הפרויקט על Free Plan, **ללא גיבויים אוטומטיים**
(`npx supabase backups list` מחזיר `pitr_enabled:false, backups:[]`). ה-migration **הותקן בלי
נקודת שחזור מנוהלת** - החלטה מודעת, לא פער שנשכח - מבוססת על כך שהשינוי **תוספתי ומבודד**: שתי
טבלאות חדשות בלבד, RLS, ואפס `ALTER`/`DROP` על אובייקט קיים (אומת מראש בביקורת הקריאה-בלבד לפני
ההרצה) - קובץ ה-rollback הידני (`supabase/migrations_rollback/...`) הוא מנגנון השחזור בפועל אם
יידרש, לא גיבוי כללי של המסד. **אל תניח שקיים גיבוי אוטומטי לפרויקט הזה** בשום החלטה עתידית -
כל עוד התוכנית היא Free, זה לא המצב.

**רקע ה-quota שהוביל להחלטה**: המחזור הקודם חרג ב-`Cached Egress` (לא קשור ל-migration הזה).
המחזור הנוכחי: `Cached Egress` = `0.011GB / 5GB` (מתחת ל-1%), `Database Size` = `0.078GB / 0.5GB`.
אין החלטה לשדרג נכון לעכשיו. **יש לעקוב אחרי שגיאות `402` בפרויקט זה אחרי 2026-08-29** (סיום
המחזור שבו הייתה החריגה) - אם יופיעו, זה סימן שהחריגה חזרה, ולא קשור ל-migration התשלום עצמו.

---

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
   `0` בשתיהן אם הכשל היה אמיתי. אם יש תוצאה חלקית - הרץ את
   `supabase/migrations_rollback/20260828062934_dohefes_payment_infrastructure_rollback.sql`
   (**קובץ נפרד, מחוץ ל-`supabase/migrations/`** - לא נסרק על ידי `db push`/`migration list`
   בכלל, ולכן לא ירוץ בטעות כחלק מהתקנה עתידית) - ידנית ב-SQL Editor, **לא** דרך
   `supabase migration new` (זו לא מיגרציה קדימה, אלא ביטול - אין טעם לרשום אותה ב-
   `schema_migrations`), ואז התייעץ לפני ניסיון חוזר.
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

3. **ציפייה**: `200`, גוף עם `{ orderId, checkoutUrl, accessToken, paymentContextId, status: "pending" }`.
   **שמור את כולם** - `orderId` לשלב 8, `checkoutUrl` לשלב 7, `accessToken` לשלב 10, `paymentContextId`
   לאימות ידני שהוא זהה ל-`ReturnValue` שחוזר בפועל בכתובת ה-`SuccessRedirectUrl`/`ErrorRedirectUrl`
   בשלב 7 (ר' `GEN2_CASHFLOW_UI_DESIGN.md` §0.1.5ב).
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
   **הזדמנות לאמת ידנית** (רלוונטי כש-`app/payment-return` ייכתב, ר' `GEN2_CASHFLOW_UI_DESIGN.md`
   §0.1.5א) - בדוק את ה-querystring שחזר בפועל בכתובת הדפדפן: האם מופיע `ReturnValue` (או casing
   אחר), והאם ערכו זהה ל-`paymentContextId` שנשמר משלב 6. תיעוד Cardcom הרשמי טוען שכן, אך ללא
   דוגמת URL מפורשת לעמוד ההצלחה עצמו (רק ל-Indicator) - זו ההזדמנות היחידה לאמת בפועל, לא רק
   מהתיעוד.

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
  בכל מקרה - `supabase/migrations_rollback/20260828062934_dohefes_payment_infrastructure_rollback.sql`
  (קובץ נפרד, לא בתוך `supabase/migrations/`).
- **פונקציה נכשלת בפריסה (שלב 4)**: `npx supabase functions delete <name>` ונסה שוב אחרי שתיקנת.
- **תשלום אמיתי בוצע (שלב 7) אך שלב 8 מראה שההזמנה לא הפכה `paid`**: זה **לא** משהו שרולבק
  טכני פותר - הכסף כבר עבר אצל Cardcom. פנה לתמיכת Cardcom לבירור/זיכוי (פעולה עסקית, לא
  טכנית) - **אל תריץ UPDATE ידני** על `dohefes_payment_orders`/`dohefes_product_entitlements`
  כדי "לתקן" את המצב בעצמך; זה עוקף את כל שכבות האימות שנבנו. אם צריך לסמן הזמנה כ-paid ידנית
  אחרי אימות ישיר מול Cardcom (לא ניחוש) - זו החלטה נפרדת שדורשת דיון, לא צעד רוטיני ברשימה הזו.
- **לבטל את כל התשתית (חזרה למצב לפני הענף הזה)**: קובץ ה-rollback הנפרד + `npx supabase
  functions delete` לשלוש הפונקציות. שום דבר ב-`dohefes_reports` לא נגע, כך שהמערכת הקיימת (baseReport
  דרך המנגנון הישן) ממשיכה לעבוד ללא שינוי.

---

## Rollout למיזמים נוספים ללא עסקה חיה

### ההקשר

"הפניה מוצלחת = תשלום מאושר" הוא **באג רוחבי**, לא ייחודי ל-dohefes - הסקר שנעשה לפני בניית
התשתית הזו (ר' `GEN2_PAYMENT_ENTITLEMENT_DESIGN.md` §0) מצא את אותו דפוס ב-`insure-vda`
(`case/[id]/page.tsx` מפעיל ניתוח אמיתי על סמך `?paid=true` מהלקוח, בלי אימות שרת), `rami`
ו-`hetel-hasbaha`/machria (אותו דפוס בדיוק דרך `insure-vda`'s API routes), ו-`shlish-dira`/viager
(אין entitlement/מעקב תשלום בכלל). **dohefes הוא מועמד ליישום הייחוס** לתיקון הזה - הכוונה
הסופית היא להעביר את כולם לאותו מנגנון, אך **שום קוד/מסד נתונים של מיזם אחר לא שונה במסגרת
העבודה הזו** - זו תכנית בלבד.

**מתי dohefes הופך בפועל ליישום הייחוס**: רק אחרי שלושה שלבים נוספים על הקוד/הבדיקות הקיימים -
(1) הרצת ה-migration בפועל מול הפרויקט המרוחק, (2) פריסת שלוש ה-Edge Functions, (3) בדיקות
טכניות **מול הסביבה המרוחקת עצמה** (לא רק fakes/mocks מקומיים) - קריאות אמיתיות ל-Functions
פרוסות, אימות RLS בפועל, אימות verify_jwt ברמת ה-gateway. **גם אחרי כל זה** - היעדר עסקה כספית
חיה נשאר עובדה קבועה: לא תהיה הוכחת אינטגרציה חיה מול Cardcom מקצה-לקצה (כלומר, אימות בפועל
שתשלום אמיתי מייצר LowProfileCode תקין, ש-Indicator מאמתת אותו נכון, ושנוצרת entitlement
מדויקת) - זה דורש חיוב אמיתי, שלא מתבצע כאן במכוון.

### רכיבים ניתנים לשכפול (עם מיקום מדויק ב-dohefes)

| רכיב | קובץ(ים) | עד כמה גנרי |
|---|---|---|
| לקוח Cardcom (LowProfile + Indicator) | `_shared/cardcom-client.ts` | ספציפי-לספק, לא ספציפי-למוצר - ניתן להעתיק כמעט as-is אם המיזם היעד משתמש באותו חשבון/מסוף Cardcom; דורש רק secrets ו-callback URLs משלו |
| Name-To-Value parsing (case-insensitive) | `_shared/name-to-value.ts` | **100% גנרי** - בלי שום דבר ספציפי ל-dohefes, ניתן להעתיק מילה-במילה |
| Access-token hashing | `_shared/payment-security.ts` (generateAccessToken/hashAccessToken/generateClaimToken) | **100% גנרי** - Web Crypto טהור, בלי שום דבר ספציפי ל-dohefes |
| CORS helper | `_shared/cors.ts` | **100% גנרי** - ניתן להעתיק מילה-במילה |
| דפוס idempotency-key + הזמנה חוסמת | `_shared/payment-order-service.ts` (findOrderByIdempotencyKey/findBlockingOrderForProduct) + partial unique index במיגרציה | **מבנה** גנרי (לא ה-SQL המילולי - שמות טבלאות ישתנו) |
| claim/lease אטומי | `dohefes_claim_checkout_creation` (RPC) + `advanceOrderToCheckout` | **מבנה** גנרי - lease קבוע > timeout ה-fetch, CAS יחיד, שחרור מותנה-token |
| אימות Indicator (webhook) | `_shared/payment-indicator-service.ts` | **מבנה** גנרי: לסמוך רק על LowProfileCode מה-webhook, אימות server-to-server, כתיבה יחידה דרך RPC |
| מודל entitlement | טבלת product_entitlements + trigger מגן + finalize RPC אטומי | **מבנה** גנרי - טבלת orders נפרדת מטבלת entitlements, שתיהן מתעדכנות אטומית יחד |
| סיווג timeout/retry | `CARDCOM_FETCH_TIMEOUT_MS`, `isAmbiguousCardcomFailure` | **מבנה** גנרי - כשל ודאי מול לא-ודאי, lease כמדיניות ל"לא ודאי" |

### תבנית rollout לכל מיזם (insure-vda / hetel-hasbaha / rami / shlish-dira-viager)

לכל מיזם, **בנפרד**, כשמגיע הזמן:

1. **Audit** - אותה מתודולוגיה כמו הסקר שכבר נעשה ל-dohefes (`GEN2_PAYMENT_ENTITLEMENT_DESIGN.md`
   §0): מה קיים היום (טבלאות, RLS, זרימת תשלום), האם המיזם באותו פרויקט Supabase משותף
   (`giygjmacxquucwexmfdd`) או פרויקט/פלטפורמה אחרת (למשל `insure-vda` על Vercel).
2. **התאמת namespace ומחיר** - prefix משלו ל-Functions/secrets/טבלאות/RPCs (לא `dohefes_`),
   product registry ומחירים משלו (לא `_shared/payment-products.ts` של dohefes), callback URLs
   משלו.
3. **Migration מבודד** - קובץ `supabase/migrations/` נפרד, עם ה-prefix של המיזם, לא נוגע
   בטבלאות dohefes/מיזמים אחרים.
4. **פריסת Functions** - עם ה-prefix של המיזם, `verify_jwt=false` רק על ה-Indicator שלו.
5. **בדיקות אוטומטיות וסימולציות** - **לפני כל כסף אמיתי** - אותה רמת קפדנות כמו הטבלה למעלה
   (unit, integration עם fakes, idempotency/מרוצים, timeout/retry, סימולציית Cardcom, CORS/JWT/
   access tokens).
6. **הפעלה הדרגתית עם אפשרות rollback** - לא סגירת הישן בבת אחת; בלוק rollback מתועד לכל שלב,
   בדיוק כמו ב-`payment-schema.sql`/`payment-order-service.ts` של dohefes.
7. **סימון מפורש** שהאינטגרציה החיה עם Cardcom **טרם אומתה** באמצעות חיוב, עד שמישהו מבצע
   בפועל את שלבי הניסוי האמיתי (כמו §5-11 למעלה, עבור המיזם הספציפי) **בכוונה מפורשת**.

### מה נשאר קבוע בכל מיזם (לא משתנה ברולאאוט)

- **אין** סגירת זרימת התשלום הישנה או ה-RLS הישן של אף מיזם - במסגרת התכנון הזה בלבד. סגירה
  בפועל (אם בכלל) היא החלטה נפרדת, לכל מיזם, אחרי שהמנגנון החדש שלו הוכח.
- **אין** הפיכת טבלאות dohefes (`dohefes_payment_orders`/`dohefes_product_entitlements`/וכו')
  לטבלאות כלליות משותפות - כל מיזם מקבל את הטבלאות/Functions/secrets **שלו**, עם ה-prefix שלו,
  לא שיתוף מבנה נתונים בין מוצרים/מיזמים.
- **אין** שינוי קוד/מסד נתונים בשום ריפו אחר כרגע - הסעיף הזה הוא תכנית בלבד.
