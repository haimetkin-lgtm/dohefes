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
-- שהתגלה, לא לפי ניחוש. זה גם אידמפוטנטי-בטוח: אם ה-constraint שכבר יש לו את השם הקבוע החדש
-- (dohefes_payment_orders_product_type_check) קיים מריצה קודמת חלקית, הוא יימצא ויוסר גם הוא
-- לפני שהוא נוצר מחדש, כך שאין סיכון להתנגשות "constraint already exists".
--
-- אין BEGIN;/COMMIT; מפורשים, מאותה סיבה בדיוק כמו במיגרציה המקורית (`supabase db push`
-- מריץ כל קובץ migration דרך pgx ExecBatch - טרנזקציונלי במובלע כבר).

do $$
declare
  v_conname text;
  v_attnum smallint;
begin
  -- --- dohefes_payment_orders.product_type ---
  select attnum into v_attnum
  from pg_attribute
  where attrelid = 'dohefes_payment_orders'::regclass and attname = 'product_type';

  for v_conname in
    select conname
    from pg_constraint
    where conrelid = 'dohefes_payment_orders'::regclass
      and contype = 'c'
      and conkey = array[v_attnum]
  loop
    execute format('alter table dohefes_payment_orders drop constraint %I', v_conname);
  end loop;

  -- --- dohefes_product_entitlements.product_type ---
  select attnum into v_attnum
  from pg_attribute
  where attrelid = 'dohefes_product_entitlements'::regclass and attname = 'product_type';

  for v_conname in
    select conname
    from pg_constraint
    where conrelid = 'dohefes_product_entitlements'::regclass
      and contype = 'c'
      and conkey = array[v_attnum]
  loop
    execute format('alter table dohefes_product_entitlements drop constraint %I', v_conname);
  end loop;
end $$;

-- שמות מפורשים וקבועים מכאן ואילך - כדי שריצה עתידית (כולל rollback-ואז-forward-שוב) תדע בדיוק
-- מה למחוק, בלי לחזור על החיפוש הדינמי למעלה.
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
