-- ROLLBACK ידני עבור supabase/migrations/20260828062934_dohefes_payment_infrastructure.sql
--
-- **קובץ נפרד בכוונה, מחוץ ל-supabase/migrations/** - כדי ש-`supabase db push`/`supabase
-- migration list` לעולם לא יתייחסו אליו כמיגרציה ממתינה (ה-CLI סורק אך ורק את
-- `supabase/migrations/*.sql` - תיקייה זו, `supabase/migrations_rollback/`, אינה נסרקת בכלל,
-- ר' SECURE_PAYMENT_DEPLOYMENT_RUNBOOK.md). לפני commit קודם, הוראות ה-rollback היו בלוק SQL
-- מוערה (`--`) **בתוך** קובץ ה-migration עצמו - עדיין בטוח (הערות לא מבוצעות), אך הופרד לקובץ
-- נפרד לגמרי כהגנת-עומק נוספת, לא רק כדי לסמוך על כך שאף אחד לא יסיר את התחילית `--` בטעות.
--
-- **אינו מבוצע אוטומטית בשום מנגנון** - להרצה ידנית בלבד (SQL Editor, אחרי אישור מפורש), ורק
-- **אחרי** שה-migration המקורי כבר רץ. הרצה על מסד שבו ה-migration מעולם לא רץ תיכשל בשקט
-- (DROP ... IF EXISTS על אובייקטים שלא קיימים - לא מזיק, אך גם לא עושה כלום).
--
-- הסדר למטה חשוב: entitlements תלויה ב-orders דרך foreign key מורכב, שתי פונקציות ה-RPC
-- (finalize/claim) נמחקות ראשונות כי אינן תלות של אף אובייקט אחר, כל טריגר/אינדקס/פונקציה אחרת
-- נמחקים רק אחרי שמי שמשתמש בהם כבר לא קיים. בטוח לביצוע בכל שלב: אין foreign key בכיוון
-- ההפוך (dohefes_reports לא מפנה לשתי הטבלאות האלה), ואין קוד קיים (React/Edge Function) שתלוי
-- בהן.

drop function if exists dohefes_claim_checkout_creation(uuid, text, integer);
drop index if exists idx_dohefes_payment_orders_one_active_per_report_product;
drop function if exists dohefes_finalize_verified_payment(text, text, text, integer, integer);
drop function if exists dohefes_upsert_active_entitlement(uuid, uuid, text);
drop trigger if exists dohefes_product_entitlements_require_verified_order on dohefes_product_entitlements;
drop trigger if exists dohefes_product_entitlements_touch_updated_at on dohefes_product_entitlements;
drop trigger if exists dohefes_payment_orders_touch_updated_at on dohefes_payment_orders;
drop table if exists dohefes_product_entitlements;
drop table if exists dohefes_payment_orders;
drop function if exists dohefes_payment_entitlement_requires_verified_order();
drop function if exists dohefes_payment_touch_updated_at();

-- (drop index if exists, בניגוד ל-drop trigger, כן אידמפוטנטי - ניתן להריץ פעמיים בבטחה. שאר
-- הפקודות למעלה (IF EXISTS על function/trigger/table) גם הן אידמפוטנטיות - הרצה כפולה של הקובץ
-- הזה עצמו בטוחה, בניגוד למיגרציה המקורית.)
