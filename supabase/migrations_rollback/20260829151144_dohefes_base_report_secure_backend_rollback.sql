-- ROLLBACK ידני עבור supabase/migrations/20260829151144_dohefes_base_report_secure_backend.sql
--
-- **קובץ נפרד, מחוץ ל-supabase/migrations/** - אותה מוסכמה בדיוק כמו שלושת קבצי ה-rollback
-- הקודמים - `db push`/`migration list` סורקים רק supabase/migrations/*.sql, לא תיקייה זו.
--
-- **אינו מבוצע אוטומטית בשום מנגנון** - להרצה ידנית בלבד (SQL Editor, אחרי אישור מפורש), ורק
-- **אחרי** שהמיגרציה הזו כבר רצה בפועל.
--
-- **דרישה מפורשת**: אסור לרולבק הזה למחוק בשקט orders/entitlements/drafts שנוצרו דרך הזרימה
-- החדשה. לפני commit 6a, לא הייתה שום דרך ליצור הזמנת/entitlement 'baseReport' דרך התשתית
-- המאובטחת (ה-check constraint על product_type כלל 'baseReport' מההתחלה, אך שום קוד לא ניצל
-- זאת בפועל עד המיגרציה הזו) - ולכן קיום **ולו שורה אחת** מסוג 'baseReport' ב-
-- dohefes_payment_orders או dohefes_product_entitlements הוא הוכחה חד-משמעית שהזרימה החדשה
-- כבר רצה. כל draft שנוצר תמיד מקושר ל-order תואם (ר' RPC 1 במיגרציה - שני ה-INSERTs תמיד
-- יחד, אטומית) - בדיקת ה-orders מכסה גם drafts, אין צורך בבדיקה נפרדת לטבלת dohefes_reports
-- עצמה (שהרולבק הזה ממילא לא נוגע בה - היא לא נוצרה על ידי המיגרציה הזו).
--
-- אם קיימת ולו שורה אחת - ה-rollback **נכשל במפורש ולא ממשיך**, ומדפיס כמה שורות נמצאו מכל
-- סוג, כדי שמי שמריץ ידע בדיוק למה זה נחסם ויחליט ביודעין - לא מחיקה/פגימה אוטומטית.
--
-- אם אין אף שורה - ה-rollback ממשיך ומסיר את שלושת ה-RPCs שהמיגרציה יצרה, בסדר שרירותי (אין
-- תלות ביניהם - שלושתם עצמאיים, לא כמו tracking_data שהייתה לו טבלה+trigger+RPCs תלויים).
--
-- **לא נוגע בשום צורה**: dohefes_reports (הטבלה או ה-RLS שלה - אף שורת draft שנוצרה בפועל לא
-- נמחקת גם אחרי שה-rollback עצמו רץ - זה rollback של ה-**קוד** (RPCs), לא של נתונים), dohefes_payment_orders/
-- dohefes_product_entitlements (הטבלאות עצמן, לא נוצרו כאן), dohefes_claim_checkout_creation/
-- dohefes_finalize_verified_payment/dohefes_upsert_active_entitlement (משותפות, לא נוצרו כאן).

do $$
declare
  v_orders_count bigint;
  v_entitlements_count bigint;
begin
  select count(*) into v_orders_count from dohefes_payment_orders where product_type = 'baseReport';
  select count(*) into v_entitlements_count from dohefes_product_entitlements where product_type = 'baseReport';

  if v_orders_count > 0 or v_entitlements_count > 0 then
    raise exception
      'dohefes rollback refused: % baseReport order(s) and % baseReport entitlement(s) already exist. '
      'Rolling back would remove the only functions that can safely read/write those reports (and '
      'create new ones), while leaving the underlying data in place with no secure access path. '
      'Decide explicitly how to handle this data before retrying this rollback - this script will not '
      'touch it.',
      v_orders_count, v_entitlements_count;
  end if;
end $$;

-- מגיעים לכאן רק אם אין אף order/entitlement מסוג baseReport - בטוח להסיר את שלושת ה-RPCs.
drop function if exists dohefes_save_report_data(uuid, text, text, text, jsonb, jsonb);
drop function if exists dohefes_get_report_data(uuid, text);
drop function if exists dohefes_create_base_report_payment_order(text, text, integer, integer, text, text);

-- (drop function עם IF EXISTS - אידמפוטנטי, הרצה כפולה של הקובץ הזה עצמו בטוחה, בדיוק כמו
-- שלושת קבצי ה-rollback הקודמים.)
