-- הוספת trackingReports כ-productType שלישי - סכמה תוספתית וממוקדת בלבד.
-- ר' PRODUCT_CATALOG_AUDIT.md ("דוחות מעקב - אינם כלולים עוד ברכישת דוח אפס") להחלטה העסקית
-- המלאה, ו-supabase/migrations/20260828062934_dohefes_payment_infrastructure.sql למיגרציה
-- המקורית (baseReport/cashFlowAnalysis בלבד) - **לא משתנה כאן בשום צורה**, קובץ נפרד לגמרי,
-- timestamp חדש, נוצר על ידי `supabase migration new` (לא הומצא ידנית).
--
-- **המשמעות היחידה של המיגרציה הזו**: שתי טבלאות התשלום (dohefes_payment_orders,
-- dohefes_product_entitlements) מכירות כרגע רק שני ערכי product_type - הוספת ערך שלישי דורשת
-- להרחיב את שני ה-check constraints בהתאם. שום דבר אחר לא זז: אין שינוי ל-RLS (כבר enabled בלי
-- אף policy לאנונימי, ר' המיגרציה המקורית §"RLS" - זה נשאר מדויק כפי שהוא), אין policy חדשה
-- ל-anon/authenticated, אין הרחבת הרשאות קיימות, אין מחיר בקוד SQL (המחיר חי אך ורק ב-
-- supabase/functions/_shared/payment-products.ts, ר' PRODUCT_CATALOG_AUDIT.md §5 - "אל תיצור
-- מקור מחיר נוסף"), ואין נגיעה בנתונים קיימים - כל השורות הקיימות כבר 'baseReport'/'cashFlowAnalysis',
-- שתיהן ממשיכות לעמוד בקלות ב-check המורחב.
--
-- **למה DO block עם גילוי דינמי של שם ה-constraint, לא ALTER TABLE ... DROP CONSTRAINT <שם קבוע>**:
-- שני ה-check constraints המקוריים (`product_type text not null check (product_type in (...))`)
-- לא קיבלו שם מפורש במיגרציה המקורית - Postgres מייצר שם אוטומטי (בדרך כלל <table>_<column>_check,
-- אך זו התנהגות פנימית, לא ערבות API מתועדת רשמית). הסתמכות על ניחוש השם הייתה מסוכנת: אם השם
-- בפועל שונה, `drop constraint if exists <שם מנוחש>` היה "מצליח" בלי לעשות כלום (IF EXISTS בולע
-- את השגיאה), וה-constraint הישן והצר יותר היה **נשאר** לצד ניסיון הוספה חדש - כשל שקט, לא
-- ברור מיד בזמן הרצה. הפתרון: מאתרים את ה-constraint לפי המבנה שלו בפועל (contype='c' על **בדיוק**
-- העמודה product_type, דרך conkey/pg_attribute.attnum) - לא לפי שם - ומפילים אותו לפי השם
-- שהתגלה, לא לפי ניחוש.
--
-- **תיקון (ממצא ביקורת - "ה-DO block רחב מדי")**: הגרסה הקודמת מצאה **כל** check constraint
-- חד-עמודי על product_type והסירה את **כולם**, בלי לוודא (א) שיש בדיוק אחד, (ב) שההגדרה שלו
-- היא בדיוק מה שמצופה - אם אי-פעם היה מתווסף constraint חד-עמודי נוסף על product_type (למשל
-- בדיקת אורך), הוא היה נמחק בשקט לצד ה-enum, בלי אזהרה. **עכשיו**: שלב אימות מלא, קריאה-בלבד,
-- על **שתי** הטבלאות **לפני** כל DROP/ALTER - סופר בדיוק כמה constraints חד-עמודיים תואמים
-- (חייב 1, לא יותר ולא פחות), ומשווה את ההגדרה בפועל (`pg_get_constraintdef`) מילה-במילה מול
-- הצורה המדויקת שה-check המקורי (`check (product_type in ('baseReport','cashFlowAnalysis'))`)
-- מנורמל אליה על ידי Postgres (`CHECK ((product_type = ANY (ARRAY[...])))`) - **לא** מנוחשת,
-- אומתה בפועל מול הסכמה החיה לפני כתיבת התיקון הזה. כל סטייה מכל אחד משני התנאים - `raise
-- exception` **לפני** שום ALTER/DROP, על אף אחת משתי הטבלאות (גם אם רק אחת מהן סוטה - שתיהן
-- נבדקות במלואן קודם, ה-DROP בפועל קורה רק בסוף, אחרי ששתיהן עברו). **תופעת לוואי מכוונת**:
-- המיגרציה כבר לא "אידמפוטנטית-שקטה" אם מריצים אותה פעמיים - ריצה שנייה תמצא constraint עם
-- שלושה ערכים (לא שניים) ותיכשל במפורש עם הודעה ברורה, במקום לנסות "לתקן" משהו בשקט - זו
-- ההתנהגות הרצויה: ריצה כפולה היא סטייה מהצפוי, לא מצב לגיטימי לטפל בו בשקט.
--
-- אין BEGIN;/COMMIT; מפורשים בקובץ עצמו, מאותה סיבה בדיוק כמו במיגרציה המקורית (`supabase db
-- push` מריץ כל קובץ migration דרך pgx ExecBatch - טרנזקציונלי במובלע כבר); בהתקנה ידנית
-- (SQL Editor / `db query -f`, לא db push) יש לעטוף בעצמו ב-`begin;`/`commit;` מפורשים - אין
-- אותה ערבות אוטומטית שם.

do $$
declare
  v_conname_orders text;
  v_conname_entitlements text;
  v_condef text;
  v_attnum smallint;
  v_matching_count integer;
  -- הצורה המדויקת שבה Postgres מנרמל `check (product_type in ('baseReport', 'cashFlowAnalysis'))` -
  -- אומתה מול הסכמה החיה (pg_get_constraintdef) לפני כתיבת השורה הזו, לא מנוחשת.
  v_expected_def constant text :=
    $DEF$CHECK ((product_type = ANY (ARRAY['baseReport'::text, 'cashFlowAnalysis'::text])))$DEF$;
begin
  -- ==========================================================================================
  -- שלב 1: אימות מלא, קריאה-בלבד, על שתי הטבלאות - לפני כל DROP/ALTER על אף אחת מהן.
  -- ==========================================================================================

  -- --- dohefes_payment_orders.product_type ---
  select attnum into v_attnum
  from pg_attribute
  where attrelid = 'dohefes_payment_orders'::regclass and attname = 'product_type';

  select count(*) into v_matching_count
  from pg_constraint
  where conrelid = 'dohefes_payment_orders'::regclass
    and contype = 'c'
    and conkey = array[v_attnum];

  if v_matching_count <> 1 then
    raise exception
      'dohefes migration refused: expected exactly one single-column check constraint on dohefes_payment_orders.product_type, found %. Not touching anything - inspect pg_constraint manually before retrying.',
      v_matching_count;
  end if;

  select conname, pg_get_constraintdef(oid) into v_conname_orders, v_condef
  from pg_constraint
  where conrelid = 'dohefes_payment_orders'::regclass
    and contype = 'c'
    and conkey = array[v_attnum];

  if v_condef <> v_expected_def then
    raise exception
      'dohefes migration refused: dohefes_payment_orders check constraint "%" has definition "%", which does not match the expected baseReport/cashFlowAnalysis-only shape "%". Not touching anything.',
      v_conname_orders, v_condef, v_expected_def;
  end if;

  -- --- dohefes_product_entitlements.product_type --- (אותו דפוס בדיוק, טבלה נפרדת)
  select attnum into v_attnum
  from pg_attribute
  where attrelid = 'dohefes_product_entitlements'::regclass and attname = 'product_type';

  select count(*) into v_matching_count
  from pg_constraint
  where conrelid = 'dohefes_product_entitlements'::regclass
    and contype = 'c'
    and conkey = array[v_attnum];

  if v_matching_count <> 1 then
    raise exception
      'dohefes migration refused: expected exactly one single-column check constraint on dohefes_product_entitlements.product_type, found %. Not touching anything - inspect pg_constraint manually before retrying.',
      v_matching_count;
  end if;

  select conname, pg_get_constraintdef(oid) into v_conname_entitlements, v_condef
  from pg_constraint
  where conrelid = 'dohefes_product_entitlements'::regclass
    and contype = 'c'
    and conkey = array[v_attnum];

  if v_condef <> v_expected_def then
    raise exception
      'dohefes migration refused: dohefes_product_entitlements check constraint "%" has definition "%", which does not match the expected baseReport/cashFlowAnalysis-only shape "%". Not touching anything.',
      v_conname_entitlements, v_condef, v_expected_def;
  end if;

  -- ==========================================================================================
  -- שלב 2: שתי הטבלאות עברו את שני התנאים במלואן - רק עכשיו, ורק כאן, מתבצע שינוי בפועל.
  -- ==========================================================================================
  execute format('alter table dohefes_payment_orders drop constraint %I', v_conname_orders);
  execute format('alter table dohefes_product_entitlements drop constraint %I', v_conname_entitlements);
end $$;

-- שמות מפורשים וקבועים מכאן ואילך - כדי שריצה עתידית (rollback-ואז-forward-שוב, אחרי rollback
-- אמיתי שהחזיר את ה-constraint לצורתו המקורית) תדע בדיוק מה למחוק, בלי לחזור על החיפוש הדינמי
-- למעלה - וגם כדי שהשלב הבא (הבדיקה ב-DO block הבא, בפעם הבאה שירוצו על השורות האלה בהקשר אחר
-- לגמרי) תמיד יידע איזה שם לצפות לו.
alter table dohefes_payment_orders
  add constraint dohefes_payment_orders_product_type_check
  check (product_type in ('baseReport', 'cashFlowAnalysis', 'trackingReports'));

alter table dohefes_product_entitlements
  add constraint dohefes_product_entitlements_product_type_check
  check (product_type in ('baseReport', 'cashFlowAnalysis', 'trackingReports'));

-- --- תרחישי בדיקה ידניים (מתועדים בלבד - לא מבוצעים אוטומטית, אותה מוסכמה כמו המיגרציה המקורית) ---
--
-- להרצה ידנית ב-SQL Editor **אחרי** שהמיגרציה הזו כבר רצה בפועל, בתוך טרנזקציה עם rollback:
-- `begin; ... בדיקות ... ; rollback;`. יש להחליף <report-A> ב-uuid קיים אמיתי מ-dohefes_reports.
--
-- 1. trackingReports כערך product_type תקין עכשיו בשתי הטבלאות (לא נדחה):
--   insert into dohefes_payment_orders
--     (report_id, product_type, expected_amount_agorot, currency_code, idempotency_key,
--      provider_order_reference, access_token_hash)
--   values ('<report-A>', 'trackingReports', 98000, 1, 'idem-tracking-1', 'order-ref-tracking-1', 'hash-tracking-1')
--   returning id;  -- מצליח - שמור כ-<tracking-order-id>
--
-- 2. ערך רביעי מומצא (unitRanking, או כל דבר אחר) - עדיין נדחה, בדיוק כמו לפני המיגרציה הזו:
--   insert into dohefes_payment_orders
--     (report_id, product_type, expected_amount_agorot, currency_code, idempotency_key,
--      provider_order_reference, access_token_hash)
--   values ('<report-A>', 'unitRanking', 98000, 1, 'idem-invalid-1', 'order-ref-invalid-1', 'hash-invalid-1');
--   -- צפוי: EXCEPTION violates check constraint "dohefes_payment_orders_product_type_check"
--
-- 3. אותו ערך רביעי מומצא נדחה גם ב-dohefes_product_entitlements (אחרי סימון ההזמנה מ-#1 כ-paid
--    כחוק, ר' תרחישי הבדיקה במיגרציה המקורית לדפוס המלא של "סימון paid תקין"):
--   insert into dohefes_product_entitlements (report_id, product_type, payment_order_id)
--   values ('<report-A>', 'unitRanking', '<tracking-order-id>');
--   -- צפוי: EXCEPTION violates check constraint "dohefes_product_entitlements_product_type_check"
--   -- (נכשל כאן, בשלב ה-check constraint על entitlements - גם אם היה עובר את ה-trigger
--   -- dohefes_payment_entitlement_requires_verified_order, שבודק התאמת report_id/product_type
--   -- מול ההזמנה, לא את תוקף הערך עצמו).
--
-- 4. baseReport/cashFlowAnalysis הקיימים ממשיכים לעבוד בדיוק כמו לפני המיגרציה הזו (בדיקת רגרסיה):
--   insert into dohefes_payment_orders
--     (report_id, product_type, expected_amount_agorot, currency_code, idempotency_key,
--      provider_order_reference, access_token_hash)
--   values ('<report-A>', 'baseReport', 98000, 1, 'idem-regress-1', 'order-ref-regress-1', 'hash-regress-1');
--   -- צפוי: מצליח, בלי שינוי התנהגות.
--
-- 5. (חדש - הגנת ה-count) הרצה כפולה של המיגרציה הזו על סכמה שכבר עברה אותה בהצלחה - נכשלת
--    במפורש בשלב האימות, לא מנסה "לתקן" שוב בשקט:
--    (מריצים את כל תוכן הקובץ הזה פעם שנייה, על סכמה שכבר יש בה dohefes_payment_orders_product_type_check
--    עם שלושת הערכים)
--   -- צפוי: EXCEPTION 'dohefes migration refused: dohefes_payment_orders check constraint
--   -- "dohefes_payment_orders_product_type_check" has definition "...trackingReports..." which
--   -- does not match the expected baseReport/cashFlowAnalysis-only shape...' - נכשל לפני כל שינוי.
--
-- 6. (חדש - הגנת ה-count) אם קיים constraint חד-עמודי נוסף על product_type (תרחיש מדומה, לא
--    צפוי בפועל) - הוספה ידנית זמנית לצורך הבדיקה בלבד, בתוך אותה טרנזקציה עם rollback:
--   alter table dohefes_payment_orders add constraint temp_extra_check check (length(product_type) > 0);
--   -- הרצת שלב 1 של ה-DO block כאן (או המיגרציה כולה) -
--   -- צפוי: EXCEPTION 'expected exactly one single-column check constraint ... found 2' - נכשל
--   -- לפני כל DROP, כולל על ה-constraint המקורי התקין.
