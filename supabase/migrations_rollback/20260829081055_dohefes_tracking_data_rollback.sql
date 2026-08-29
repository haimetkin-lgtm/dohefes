-- ROLLBACK ידני עבור supabase/migrations/20260829081055_dohefes_tracking_data.sql
--
-- **קובץ נפרד, מחוץ ל-supabase/migrations/** - אותה מוסכמה בדיוק כמו שני קבצי ה-rollback
-- הקודמים (20260828062934/20260829070351) - `db push`/`migration list` סורקים רק
-- supabase/migrations/*.sql, לא תיקייה זו.
--
-- **אינו מבוצע אוטומטית בשום מנגנון** - להרצה ידנית בלבד (SQL Editor, אחרי אישור מפורש), ורק
-- **אחרי** שהמיגרציה הזו כבר רצה בפועל.
--
-- **דרישה מפורשת**: אסור לרולבק הזה למחוק בשקט נתוני מעקב שכבר נשמרו דרך המנגנון החדש. אם
-- קיימת ולו שורה אחת ב-dohefes_tracking_data - ה-rollback **נכשל במפורש ולא ממשיך**, ומדפיס
-- כמה שורות נמצאו, כדי שמי שמריץ ידע בדיוק למה זה נחסם ויחליט ביודעין (למשל: לא לבצע rollback
-- בכלל, או לגבות/לייצא את הנתונים קודם) - לא מחיקה/פגימה אוטומטית של אף שורה על ידי הקובץ הזה.
--
-- אם אין אף שורה - ה-rollback ממשיך ומסיר את כל מה שהמיגרציה יצרה, בסדר הפוך לתלויות (RPCs
-- לפני הטבלה, טבלה לפני הפונקציות שהיא תלויה בהן, אותו עיקרון כמו rollback התשלום המקורי).
--
-- **לא נוגע בשום צורה**: dohefes_reports (הטבלה או ה-RLS שלה), dohefes_payment_orders/
-- dohefes_product_entitlements, dohefes_payment_touch_updated_at (משותפת, לא נוצרה כאן).
-- אין קוד קיים (React/Edge Function) שתלוי ב-dohefes_tracking_data בשלב הזה - Commit 5a הוא
-- תשתית שרת בלבד, ה-UI לא חובר עדיין.

do $$
declare
  v_rows_count bigint;
begin
  select count(*) into v_rows_count from dohefes_tracking_data;

  if v_rows_count > 0 then
    raise exception
      'dohefes rollback refused: % row(s) already exist in dohefes_tracking_data. '
      'Rolling back would drop the table and silently discard that tracking data. '
      'Back up or export the rows first, or decide explicitly to accept the loss, before retrying this rollback - this script will not delete them.',
      v_rows_count;
  end if;
end $$;

-- מגיעים לכאן רק אם הטבלה ריקה לגמרי - בטוח להסיר את כל מה שהמיגרציה יצרה.
--
-- הערה (Commit 5b-fix): dohefes_get_tracking_data שינתה את סוג ההחזרה שלה (נוסף project_name)
-- - זה **לא** משפיע על השורה הבאה: זהות פונקציה ב-DROP FUNCTION נקבעת לפי שם+טיפוסי הפרמטרים
-- בלבד (uuid, text) - לא לפי RETURNS - החתימה כאן עדיין נכונה בדיוק.

drop function if exists dohefes_save_tracking_data(uuid, text, jsonb);
drop function if exists dohefes_get_tracking_data(uuid, text);
drop trigger if exists dohefes_tracking_data_touch_updated_at on dohefes_tracking_data;
drop table if exists dohefes_tracking_data;
drop function if exists dohefes_tracking_touch_updated_at();

-- (drop function/trigger/table עם IF EXISTS - כולם אידמפוטנטיים, הרצה כפולה של הקובץ הזה
-- עצמו בטוחה, בדיוק כמו שני קבצי ה-rollback הקודמים.)
