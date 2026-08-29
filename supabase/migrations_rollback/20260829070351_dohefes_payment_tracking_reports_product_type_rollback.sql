-- ROLLBACK ידני עבור supabase/migrations/20260829070351_dohefes_payment_tracking_reports_product_type.sql
--
-- **קובץ נפרד, מחוץ ל-supabase/migrations/** - אותה מוסכמה בדיוק כמו
-- supabase/migrations_rollback/20260828062934_dohefes_payment_infrastructure_rollback.sql (ר'
-- ההערה שם לנימוק המלא: `db push`/`migration list` סורקים רק supabase/migrations/*.sql).
--
-- **אינו מבוצע אוטומטית בשום מנגנון** - להרצה ידנית בלבד (SQL Editor, אחרי אישור מפורש), ורק
-- **אחרי** שהמיגרציה הזו כבר רצה בפועל.
--
-- **דרישה מפורשת (ר' PRODUCT_CATALOG_AUDIT.md / הנחיית Commit 2)**: אסור לrollback הזה למחוק או
-- להפוך בשקט לבלתי-תקינות שורות trackingReports שכבר נוצרו (בין אם ב-dohefes_payment_orders
-- ובין אם ב-dohefes_product_entitlements) - **אם יש כאלה, ה-rollback נכשל במפורש ולא ממשיך**,
-- ומדפיס כמה שורות נמצאו בכל טבלה, כדי שמי שמריץ את זה ידע בדיוק למה זה נחסם ויחליט ביודעין
-- מה לעשות (למשל: לא לבצע rollback בכלל, או קודם להחליט/לתעד מדיניות ל-trackingReports הקיימים
-- לפני שממשיכים) - **לא** מחיקה/עדכון אוטומטי של אף שורה על ידי הקובץ הזה, בשום נסיבות.
--
-- אם אין אף שורת trackingReports (המצב הצפוי מיד אחרי שהמיגרציה רצה ולפני שנעשה בה שימוש אמיתי,
-- או אם מעולם לא נעשה בה שימוש) - ה-rollback ממשיך ומחזיר את שני ה-check constraints בדיוק
-- לצורתם המקורית (baseReport/cashFlowAnalysis בלבד), באותה שיטת גילוי דינמי של שם ה-constraint
-- (לא ניחוש שם) כמו במיגרציה עצמה - מאותה סיבה בדיוק (ר' ההערה שם).
--
-- שים לב: rollback על סכמה בלבד - **אינו** משנה את payment-products.ts (ProductType/PRODUCTS
-- בקוד ה-TypeScript) ואינו משנה את lib/catalog.ts - אלה קבצי קוד רגילים, לא נגררים אוטומטית
-- על ידי rollback SQL. rollback קוד (אם אי-פעם יידרש) הוא git revert על ה-commit המתאים, נפרד
-- לגמרי מהקובץ הזה.

do $$
declare
  v_orders_count bigint;
  v_entitlements_count bigint;
begin
  select count(*) into v_orders_count from dohefes_payment_orders where product_type = 'trackingReports';
  select count(*) into v_entitlements_count from dohefes_product_entitlements where product_type = 'trackingReports';

  if v_orders_count > 0 or v_entitlements_count > 0 then
    raise exception
      'dohefes rollback refused: % row(s) in dohefes_payment_orders and % row(s) in dohefes_product_entitlements already use product_type=trackingReports. '
      'Rolling back the check constraint would either block this rollback (existing rows would violate the narrower constraint) or, if forced, silently strand paying customers'' entitlements. '
      'Decide explicitly what to do with these rows before retrying this rollback - this script will not delete or invalidate them.',
      v_orders_count, v_entitlements_count;
  end if;
end $$;

-- מגיעים לכאן רק אם שני הספירות היו 0 - בטוח להחזיר את ה-constraint המקורי, בלי לסכן שום שורה.

do $$
declare
  v_conname text;
  v_attnum smallint;
begin
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

alter table dohefes_payment_orders
  add constraint dohefes_payment_orders_product_type_check
  check (product_type in ('baseReport', 'cashFlowAnalysis'));

alter table dohefes_product_entitlements
  add constraint dohefes_product_entitlements_product_type_check
  check (product_type in ('baseReport', 'cashFlowAnalysis'));
