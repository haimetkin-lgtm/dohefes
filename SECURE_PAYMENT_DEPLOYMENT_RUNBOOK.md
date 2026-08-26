# Runbook: פריסת תשתית התשלום המאובטחת (secure-payment-foundation)

מסמך תפעולי בלבד - סדר פעולות מדויק לביצוע בפועל, כשתחליט לעבור לניסיון אמיתי. **לא בוצע כלום
ממה שכתוב כאן** - זה תכנון, לא ביצוע. כל שלב עם `psql`/SQL Editor מסומן בבירור, וכל שלב שגובה
כסף אמיתי מסומן באזהרה נפרדת.

מבנה הענף כרגע (`secure-payment-foundation`): schema (`supabase/payment-schema.sql`) + שלוש
Edge Functions (`create-payment-order`, `cardcom-payment-indicator`, `get-product-access`) -
קוד בלבד, שום דבר לא רץ/פרוס.

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
| `CARDCOM_TERMINAL_NUMBER` | מספר המסוף משלב 1 | Cardcom |
| `CARDCOM_API_USERNAME` | שם המשתמש משלב 1 | Cardcom |
| `CARDCOM_SUCCESS_URL` | כתובת בדף שלך שהמשתמש חוזר אליה אחרי תשלום מוצלח | האתר שלך |
| `CARDCOM_ERROR_URL` | כתובת בדף שלך שהמשתמש חוזר אליה אחרי כישלון/ביטול | האתר שלך |
| `CARDCOM_INDICATOR_URL` | הכתובת המלאה של `cardcom-payment-indicator` **אחרי** שהיא נפרסת (שלב 4) - בפורמט `https://<project-ref>.supabase.co/functions/v1/cardcom-payment-indicator` | הפרויקט שלך, נקבע רק אחרי הפריסה |
| `ALLOWED_ORIGINS` | רשימת origins מופרדת בפסיקים (למשל `https://haimetkin-lgtm.github.io`) - ר' `_shared/payment-security.ts` | האתר שלך |

`CARDCOM_INDICATOR_URL` תלוי בשלב 4 (הפריסה) - לכן סדר מומלץ בפועל: הזן קודם את חמשת השדות
הראשונים, פרוס את שלוש הפונקציות (שלב 4), ואז חזור והזן את `CARDCOM_INDICATOR_URL` עם הכתובת
האמיתית שקיבלת, ופרוס מחדש רק את `cardcom-payment-indicator` (secrets נטענים מחדש אוטומטית
עם כל deploy).

---

## שלב 3 - הרצת migration

1. **גיבוי** - לפני כל migration בפרויקט הזה: Dashboard → **Database → Backups** - ודא שיש
   גיבוי אוטומטי עדכני (או הרץ ידני אם אתה רוצה נקודת שחזור טרייה יותר).
2. Dashboard → **SQL Editor → New query**.
3. פתח את `supabase/payment-schema.sql` מהריפו, העתק את **כל** התוכן (מ-`create extension`
   ועד סוף קובץ הבדיקות המתועדות - השורות המתועדות בהערות `--` לא מריצות כלום, בטוח להעתיק
   הכל), הדבק ב-SQL Editor, לחץ **Run**.
4. **ציפייה**: הודעת הצלחה ירוקה, בלי שגיאות. אם מופיעה שגיאה `relation "dohefes_reports" does
   not exist` - הפרויקט שאתה מריץ עליו אינו הפרויקט הנכון (הסכמה מניחה ש-`dohefes_reports`
   כבר קיים). עצור, ודא שאתה בפרויקט הנכון, אל תמשיך.
5. **הרצה שנייה בטעות**: אם הרצת את הקובץ פעם נוספת (למשל הדבקת אותו פעמיים) - תקבל שגיאה
   בסביבות `create trigger dohefes_payment_orders_touch_updated_at` ("already exists"). זו
   שגיאה **צפויה ובטוחה** - הקובץ לא מתוכנן להיות ניתן-להרצה-חוזרת (ר' ביקורת ה-migration
   המלאה בדוח הנפרד), והשגיאה הזו היא הסימן שהריצה הקודמת כבר הצליחה. אל תנסה "לתקן" את זה
   בעצמך - אם אתה צריך להריץ מחדש מסיבה אמיתית, תשתמש קודם בבלוק ה-Rollback המתועד בתחתית
   הקובץ (בזהירות - ר' סעיף "מה קורה אם שלב נכשל" בסוף המסמך).

---

## שלב 4 - פריסת שלוש הפונקציות + הגדרת JWT

### הגדרת JWT - `cardcom-payment-indicator` בלבד עם `verify_jwt=false`

צור (אם לא קיים) `supabase/config.toml` עם:

```toml
[functions.cardcom-payment-indicator]
verify_jwt = false

# create-payment-order ו-get-product-access: לא מוזכרות כאן בכוונה - נשארות עם ברירת המחדל
# (verify_jwt=true). הדפדפן קורא להן דרך supabase.functions.invoke עם מפתח ה-anon, שהוא
# כשלעצמו JWT תקין וחתום שעובר את הבדיקה - אין להן צורך בפטור. שינוי ההגדרה הזו לפונקציה
# אחרת מלבד cardcom-payment-indicator דורש החלטה מפורשת ונפרדת, לא נגזר מהחריג הזה.
```

חלופה (אם אתה מעדיף לא לשמור קובץ config): דגל `--no-verify-jwt` בפקודת ה-deploy עצמה
(ר' למטה) - עושה בדיוק אותו דבר, רק לא "נדבק" לפרויקט בין פריסות.

### פריסה בפועל (CLI)

```bash
supabase functions deploy create-payment-order
supabase functions deploy get-product-access
supabase functions deploy cardcom-payment-indicator --no-verify-jwt
```

(אם השתמשת ב-`config.toml` למעלה, הדגל `--no-verify-jwt` מיותר אך לא מזיק - שני המנגנונים
אומרים את אותו דבר.)

**ציפייה**: כל פקודה מדפיסה "Deployed Function" עם כתובת. **עכשיו** יש לך את הכתובת
ל-`CARDCOM_INDICATOR_URL` (שלב 2) - חזור, הזן אותה, ופרוס מחדש רק את `cardcom-payment-indicator`.

**איך לוודא שה-JWT הוגדר נכון**: Dashboard → **Edge Functions** → לחץ על `cardcom-payment-
indicator` → לשונית **Details/Settings** - אמור להופיע "JWT verification: Disabled" (או ניסוח
דומה, תלוי גרסת ה-Dashboard). עבור שתי הפונקציות האחרות - אמור להופיע "Enabled" (ברירת המחדל).

---

## שלב 5 - בדיקת sandbox/עסקת בדיקה

אם ב-שלב 1 קיבלת אישור ש-Cardcom מספקת סביבת sandbox: הזן זמנית את פרטי ה-sandbox (terminal
number/username נפרדים, אם קיימים) ב-secrets (שלב 2), ובצע שלבים 6-10 למטה מולם קודם. אחרי
שהכל עובד ב-sandbox, **החלף את ה-secrets בפרטים האמיתיים** ופרוס מחדש (שלב 4) לפני שלב 6-10
עם כסף אמיתי.

אם אין sandbox - דלג לשלב 6 (כסף אמיתי מהשלב הראשון - ר' אזהרה בשלב 7).

---

## שלב 6 - יצירת הזמנת `cashFlowAnalysis`

**תנאי מקדים חשוב**: `cashFlowAnalysis` דורש (ב-`create-payment-order`) שהדוח כבר `paid` עבור
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

2. **קרא ל-create-payment-order**:
   ```bash
   curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/create-payment-order" \
     -H "Content-Type: application/json" \
     -H "Origin: <אחד מה-origins שהוגדרו ב-ALLOWED_ORIGINS>" \
     -H "Authorization: Bearer <ANON_KEY של הפרויקט>" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{"reportId":"<test-report-id>","productType":"cashFlowAnalysis"}'
   ```
   (בלי `-H "Origin: ..."` תקבל `403 origin_not_allowed` - זו התנהגות תקינה, לא באג; ר'
   ממצאי ה-CORS בדוח.)

3. **ציפייה**: `200`, גוף עם `{ orderId, checkoutUrl, accessToken, status: "pending" }`.
   **שמור את שלושתם** - `orderId` לשלב 8, `checkoutUrl` לשלב 7, `accessToken` לשלב 10.

---

## שלב 7 - ביצוע תשלום אמיתי אחד

> **⚠️ שלב זה גובה כסף אמיתי** (אלא אם אתה עדיין ב-sandbox משלב 5). המחיר הוא הסכום הקבוע
> ל-`cashFlowAnalysis` (ר' `_shared/payment-products.ts`) - ודא שאתה מודע לכך לפני שממשיך.

1. פתח את ה-`checkoutUrl` משלב 6 בדפדפן.
2. השלם תשלום עם כרטיס אמיתי (או פרטי בדיקה, אם ב-sandbox).
3. אחרי הצלחה, אתה מגיע ל-`CARDCOM_SUCCESS_URL` שהגדרת. **בשלב הזה** (אם ה-IndicatorUrl הוגדר
   נכון ו-Cardcom קוראת לו) - `cardcom-payment-indicator` אמורה כבר לרוץ ברקע. אם ה-IndicatorUrl
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

אם ה-`status` עדיין `pending`: `cardcom-payment-indicator` עוד לא רצה (ר' שלב 9, קריאה ידנית).

---

## שלב 9 - retry של Indicator והוכחת idempotency

בלי Authorization header (ר' שלב 4 - הפונקציה הזו מוגדרת `verify_jwt=false`, זו בדיוק הסיבה):

```bash
curl -i "https://<project-ref>.supabase.co/functions/v1/cardcom-payment-indicator?LowProfileCode=<ה-LowProfileCode האמיתי מ-Cardcom>"
```

(אם אין לך את ה-LowProfileCode בהישג יד - הוא לא נחשף בתגובת create-payment-order בכוונה; ניתן
לשלוף אותו מ-`select cardcom_low_profile_code from dohefes_payment_orders where id='<orderId>'`.)

**קרא לזה פעמיים ברצף** (זה בדיוק ה"retry"). **ציפייה**: `200` בשתי הפעמים, ושורת ה-entitlement
בשלב 8 **נשארת שורה אחת** (לא הכפילה את עצמה) - זו ההוכחה ל-idempotency (`already_finalized`
ב-RPC בפעם השנייה).

---

## שלב 10 - בדיקת token שגוי ונכון

**token נכון** (מ-שלב 6, `accessToken`):
```bash
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/get-product-access" \
  -H "Content-Type: application/json" \
  -H "Origin: <אחד מה-origins שהוגדרו>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "X-Access-Token: <accessToken משלב 6>" \
  -d '{"reportId":"<test-report-id>","productType":"cashFlowAnalysis"}'
```
**ציפייה**: `{"status":"active"}`.

**token שגוי**: אותה קריאה עם `X-Access-Token: garbage-value-123`.
**ציפייה**: `{"status":"unavailable"}` - **אותה תגובה בדיוק** שהייתה מתקבלת עבור דוח לא-קיים
או מוצר-לא-נרכש (זה הכוונה, לא באג - ר' ממצאי get-product-access).

---

## מה קורה אם שלב נכשל (Rollback)

- **שלב 3 (migration) נכשל**: אם נכשל **לפני** שהגיע לסוף - הרצת ה-SQL כטרנזקציה אחת (התנהגות
  ברירת מחדל של SQL Editor להרצת סקריפט רב-פקודות) אמורה לגרום לכך שכלום לא נשאר חלקית - ודא
  ב-`select * from dohefes_payment_orders limit 1;` שהטבלה אכן לא קיימת אם אתה חושב שהריצה
  נכשלה כולה. אם היא **כן** קיימת אך משהו נראה חצי-גמור - הרץ את בלוק ה-Rollback המתועד בתחתית
  `supabase/payment-schema.sql` (מעתיקים את שורות ה-`drop` ומריצים ב-SQL Editor - הן מתועדות
  שם בסדר הנכון, לא לשנות את הסדר).
- **פונקציה נכשלת בפריסה (שלב 4)**: `supabase functions delete <name>` ונסה שוב אחרי שתיקנת.
- **תשלום אמיתי בוצע (שלב 7) אך שלב 8 מראה שההזמנה לא הפכה `paid`**: זה **לא** משהו שרולבק
  טכני פותר - הכסף כבר עבר אצל Cardcom. פנה לתמיכת Cardcom לבירור/זיכוי (פעולה עסקית, לא
  טכנית) - **אל תריץ UPDATE ידני** על `dohefes_payment_orders`/`dohefes_product_entitlements`
  כדי "לתקן" את המצב בעצמך; זה עוקף את כל שכבות האימות שנבנו. אם צריך לסמן הזמנה כ-paid ידנית
  אחרי אימות ישיר מול Cardcom (לא ניחוש) - זו החלטה נפרדת שדורשת דיון, לא צעד רוטיני ברשימה הזו.
- **לבטל את כל התשתית (חזרה למצב לפני הענף הזה)**: בלוק ה-Rollback + `supabase functions
  delete` לשלוש הפונקציות. שום דבר ב-`dohefes_reports` לא נגע, כך שהמערכת הקיימת (baseReport
  דרך המנגנון הישן) ממשיכה לעבוד ללא שינוי.
