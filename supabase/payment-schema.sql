-- תשתית תשלום והרשאות (baseReport + cashFlowAnalysis) — סכמה תוספתית בלבד
-- ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md לתכנון המלא (audit, ארכיטקטורה, rollout מדורג).
-- קובץ נפרד מ-schema.sql (לא נוגע בו כלל) — אותו דפוס בדיוק כמו hetel-hasbaha/supabase/stage2-schema.sql
-- (סכמה נפרדת לפיצ'ר/שלב נוסף באותו פרויקט Supabase, במקום להוסיף לקובץ הראשי).
--
-- שלב זה (commit יחיד, ענף secure-payment-foundation): schema + constraints + RLS בלבד.
-- אין Edge Functions עדיין, ואין חיבור מה-UI. הריצה בפועל (SQL Editor, כמו כל migration קודם
-- בפרויקט) מתוזמנת רק כשה-rollout המדורג (GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §6.2) מגיע לשלב 1 -
-- לא הורצה כאן, לא כחלק מה-commit הזה.
--
-- שינויים ל-dohefes_reports: אין. RLS על dohefes_reports: אין שינוי בשלב הזה (ר' §6.2 שלב 5 -
-- סגירת ה-policies הפתוחות שם מתוכננת רק בסוף ה-rollout, לא כאן).
--
-- מה שאסור בהחלט להיכתב לשתי הטבלאות האלה (בכל commit עתידי, לא רק כאן): מספר כרטיס אשראי,
-- תוקף כרטיס, תעודת זהות, או payload גולמי מלא מ-Cardcom אם הוא מכיל מידע אישי/פרטי כרטיס.
-- נשמרים כאן אך ורק מזהים ונתוני סכום/סטטוס הנחוצים לאימות ולביקורת - לא נתוני התשלום עצמם.

create extension if not exists "pgcrypto";

-- --- פונקציית עזר ל-updated_at ---
--
-- לא נמצא helper קיים ל-updated_at בריפו הזה או בשלושת המיזמים הדומים שנבדקו (dohefes/rami/
-- hetel-hasbaha - אף אחד מהם לא משתמש בעמודת updated_at עם trigger אוטומטי היום). נכתב כאן
-- מאפס, בשם ייחודי (קידומת dohefes_payment_) כדי לא להתנגש עם פונקציה בשם דומה שאולי כבר קיימת
-- בפרויקט ה-Supabase המשותף (insure-vda/rami/hetel-hasbaha/dohefes) - לא ניתן לאמת מהריפו הזה
-- בלבד שהשם פנוי, ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §3.
create or replace function dohefes_payment_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- --- payment_orders: "ניסיון תשלום" - נוצר לפני שהעסקה בהכרח הצליחה ---
--
-- expected_amount_agorot: אגורות כמספר שלם (למשל 98000 = 980.00 ₪), לא numeric/float - נמנע
-- מעיגול נקודה-צפה בכסף. שם השדה כולל "expected" במפורש: זה הסכום שהוזמן/צפוי, לא אישור
-- שהתקבל בפועל (זה מה ש-verified_at/paid_at למטה מייצגים). **בלי default** - נקבע אך ורק על
-- ידי Edge Function עתידית (create-payment-order) לפי product_type, בקוד השרת, לא כברירת מחדל
-- שניתנת לשינוי/דריסה - ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §4.1/§4.2.
--
-- currency_code: 1 = ש"ח (שקל), לפי ממשק Cardcom המתוכנן (LowProfileCode) - ערך קבוע יחיד
-- כרגע (אין תמיכה מתוכננת במטבע אחר), נאכף ב-check מפורש כדי שערך אחר יידחה מיד, לא יתקבל בשקט.
--
-- ארבעה מזהים נפרדים, לא "payment_reference" מאוחד אחד - כל אחד ממלא תפקיד אחר בזרימה מול
-- Cardcom (ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §4.2):
--   idempotency_key            - מזהה פנימי שלנו, מונע כפילות אם create-payment-order נקראת פעמיים
--                                 (למשל retry אחרי timeout ברשת) - נקבע ברגע יצירת ההזמנה, לפני כל
--                                 פנייה ל-Cardcom.
--   provider_order_reference   - הערך שאנחנו שולחים ל-Cardcom כדי לזהות את ההזמנה שלנו מולו
--                                 (correlation), גם הוא נקבע לפנינו קוראים ל-Cardcom.
--   cardcom_low_profile_code   - LowProfileCode שחוזר מ-Cardcom - לא ידוע עד שנוצר session תשלום
--                                 בפועל, לכן nullable.
--   cardcom_internal_deal_number - מספר העסקה הפנימי של Cardcom עצמו (TranzactionId) - מתקבל רק
--                                 אחרי GetLowProfileIndicator מוצלח, לכן nullable.
-- כל השדות עם unique נפרד (לא unique משותף) - מזהה כפול בכל אחד מהם, בנפרד, נדחה על ידי
-- Postgres ולא יוצר entitlement כפול (ר' §4.1 "idempotency ל-callback/webhook").
--
-- access_token_hash: **חובה גם כש-RLS לא מעניקה שום גישה ל-anon** - ה-Edge Function עצמה
-- (cardcom-payment-indicator/get-product-access) פועלת עם service_role וכך עוקפת RLS לגמרי;
-- בלי login במערכת, זו חייבת לאמת בעצמה שמי שפונה אליה מחזיק את הסוד המתאים לאותה הזמנה/דוח,
-- לפני שהיא משתמשת בהרשאת ה-service_role שלה. כלל מחייב לכל מימוש עתידי של Edge Function:
--   - השרת מייצר token אקראי-קריפטוגרפית (לא נחוש/רציף).
--   - מחזיר אותו ללקוח פעם אחת בלבד (בתגובת create-payment-order) - לא נשמר בשום מקום אחר בענן.
--   - נשמר במסד **רק** כ-hash (SHA-256) - העמודה כאן היא access_token_hash, לעולם לא הטוקן הגולמי.
--   - הטוקן הגולמי **לעולם לא** נכתב ללוגים (לא server logs, לא Supabase logs, לא הודעות שגיאה).
--   - get-product-access מאמתת את הטוקן שמגיע מהלקוח מול ה-hash השמור **לפני** שהיא נוגעת
--     בטבלאות עם ה-service_role שלה.
-- אין יצירת token בפועל ב-commit הזה - רק העמודה + הכלל המתועד. ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §5.2.
create table if not exists dohefes_payment_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  report_id uuid not null references dohefes_reports(id) on delete restrict,
  product_type text not null check (product_type in ('baseReport', 'cashFlowAnalysis')),
  expected_amount_agorot integer not null check (expected_amount_agorot > 0),
  currency_code integer not null check (currency_code = 1),
  status text not null default 'created'
    check (status in ('created', 'pending', 'paid', 'failed', 'cancelled', 'refunded')),
  idempotency_key text not null unique,
  provider_order_reference text not null unique,
  cardcom_low_profile_code text unique,
  cardcom_internal_deal_number text unique,
  access_token_hash text not null unique,
  verified_at timestamptz,
  paid_at timestamptz,
  failure_code text
);

create trigger dohefes_payment_orders_touch_updated_at
  before update on dohefes_payment_orders
  for each row execute function dohefes_payment_touch_updated_at();

create index if not exists idx_dohefes_payment_orders_report_id on dohefes_payment_orders(report_id);
create index if not exists idx_dohefes_payment_orders_product_type on dohefes_payment_orders(product_type);
create index if not exists idx_dohefes_payment_orders_status on dohefes_payment_orders(status);
-- הערה: idempotency_key/provider_order_reference/cardcom_low_profile_code/cardcom_internal_deal_number/
-- access_token_hash כבר מקבלים אינדקס אוטומטית מה-UNIQUE constraints שלהם למעלה - אין צורך
-- באינדקסים נפרדים/כפולים עליהם.

-- --- product_entitlements: ההרשאה בפועל למוצר - נפרדת מהתשלום עצמו ---
--
-- entitlement_status (לא payment_status): ההרשאה מתארת **גישה למוצר**, לא מצב תשלום - מצב
-- התשלום עצמו חי אך ורק ב-payment_orders.status. שלושה ערכים: active (יש גישה כרגע), revoked
-- (גישה בוטלה, לא בהכרח בגלל refund - למשל טעות אדמין), refunded (בוטלה ספציפית עקב זיכוי כספי).
-- אין ערך "pending" כאן במפורש: שורת entitlement נוצרת רק **אחרי** ש-cardcom-payment-indicator
-- כבר אימתה תשלום מוצלח (ר' §4.2) - אם התשלום עוד לא אומת, פשוט אין עדיין שורת entitlement כלל.
--
-- payment_order_id: not null ו-unique - כל entitlement מקושרת בדיוק להזמנה אחת שאומתה (לא null,
-- "entitlement קשורה להזמנה מאומתת"), ואותה הזמנה לא יכולה להעניק יותר מ-entitlement אחד
-- (unique) - מונע את התרחיש של אותה עסקת תשלום "מוכפלת" ליותר מהרשאה אחת בטעות.
--
-- unique(report_id, product_type) נשאר (לא partial index): שורת הרשאה אחת בלבד לכל זוג
-- (דוח, מוצר) לכל החיים - entitlement_status עצמו עובר מצבים (active -> revoked/refunded, ואולי
-- active מחדש ברכישה חוזרת אחרי refund) בתוך אותה שורה, לא על ידי הוספת שורה נוספת.
create table if not exists dohefes_product_entitlements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  report_id uuid not null references dohefes_reports(id) on delete restrict,
  product_type text not null check (product_type in ('baseReport', 'cashFlowAnalysis')),
  entitlement_status text not null default 'active'
    check (entitlement_status in ('active', 'revoked', 'refunded')),
  granted_at timestamptz,
  payment_order_id uuid not null references dohefes_payment_orders(id) on delete restrict unique,
  unique (report_id, product_type)
);

create trigger dohefes_product_entitlements_touch_updated_at
  before update on dohefes_product_entitlements
  for each row execute function dohefes_payment_touch_updated_at();

create index if not exists idx_dohefes_product_entitlements_report_id on dohefes_product_entitlements(report_id);
create index if not exists idx_dohefes_product_entitlements_product_type on dohefes_product_entitlements(product_type);
create index if not exists idx_dohefes_product_entitlements_entitlement_status on dohefes_product_entitlements(entitlement_status);
-- הערה: payment_order_id כבר מקבל אינדקס אוטומטית מה-UNIQUE constraint שלו למעלה.

-- --- מחיקות: RESTRICT מפורש, לא CASCADE, לא ברירת המחדל המרומזת ---
--
-- שתי הפניות ל-dohefes_reports(id) (בשתי הטבלאות) ואחת ל-dohefes_payment_orders(id) (מ-entitlements)
-- כולן on delete restrict במפורש: מחיקת דוח/הזמנה שיש להם רשומות תשלום/הרשאה תלויות **נחסמת**
-- לגמרי, לא גוררת מחיקה שקטה של היסטוריית תשלום (cascade) ולא נשארת מרומזת בברירת המחדל של
-- Postgres (NO ACTION, שמתנהגת דומה אך לא זהה - RESTRICT נבדק מיידית, לא נדחה לסוף הטרנזקציה).
-- זה מתועד כדרישה מפורשת: תיעוד כספי לא נמחק בשקט אף פעם, כולל לא כתוצאה עקיפה ממחיקת דוח.

-- --- RLS: מופעלת, ובכוונה בלי אף policy לאנונימי ---
--
-- שונה במפורש מ-dohefes_reports הקיים (using(true)/with check(true), ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md
-- §2.1/§2.2) ומכל ארבעת המיזמים שנסקרו שם (§0) - כאן אין אף policy בכלל לתפקיד anon, על אף
-- פעולה (select/insert/update/delete). RLS מופעלת בלי policies אומרת ש**כל** בקשה עם ה-anon key
-- נדחית עבור **כל** פעולה על שתי הטבלאות האלה, בלי יוצא מן הכלל, כולל יצירת הזמנה. הדרך היחידה
-- לגעת בטבלאות האלה - קריאה או כתיבה - היא Edge Function עתידית עם service_role key (עוקף RLS
-- מטבעו, ר' §4.2: create-payment-order/cardcom-payment-indicator/get-product-access), שמאמתת
-- בעצמה access_token_hash לפני כל שימוש ב-service_role שלה. עדיין לא קיימת, לא נכתבת ב-commit הזה.
alter table dohefes_payment_orders enable row level security;
alter table dohefes_product_entitlements enable row level security;

-- --- Rollback (מתועד בלבד, לא מבוצע) ---
--
-- drop trigger if exists dohefes_product_entitlements_touch_updated_at on dohefes_product_entitlements;
-- drop trigger if exists dohefes_payment_orders_touch_updated_at on dohefes_payment_orders;
-- drop table if exists dohefes_product_entitlements;
-- drop table if exists dohefes_payment_orders;
-- drop function if exists dohefes_payment_touch_updated_at();
--
-- בטוח לביצוע בכל שלב: אין foreign key בכיוון ההפוך (dohefes_reports לא מפנה לשתי הטבלאות
-- האלה), ואין קוד קיים (React/Edge Function) שתלוי בהן - הן לא נצרכות על ידי שום דבר עד commit
-- עתידי. הסדר למעלה (triggers -> entitlements -> orders -> function) חשוב: entitlements תלויה
-- ב-orders דרך foreign key, וה-function נמחקת רק אחרי ששני ה-triggers שמשתמשים בה כבר לא קיימים.
