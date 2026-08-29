-- backend מאובטח לרכישת baseReport - Commit 6a (blocker אחרון לפני merge, ר' audit קריאה-בלבד
-- שקדם ל-commit הזה: "בעיית reportId", "כל נתיבי העקיפה הנוכחיים", חלופה ג' מאושרת בתיקון -
-- draft+order בפעולה אטומית **אחת** בתוך Postgres, לא שתי קריאות Supabase עוקבות מה-Edge
-- Function (שאינן טרנזקציה אמיתית).
--
-- שלושה RPCs חדשים, אותו דפוס אבטחה בדיוק כמו migrations/20260828062934_dohefes_payment_infrastructure.sql
-- ו-migrations/20260829081055_dohefes_tracking_data.sql: security definer, search_path קבוע
-- (pg_catalog, public), revoke מ-public/anon/authenticated, grant ל-service_role בלבד, בלי
-- SQL דינמי בשום מקום, בלי token גולמי נשמר אי-פעם.
--
-- **שינוי סכמה יחיד**: אין. הקובץ הזה לא יוצר טבלה חדשה ולא מוסיף עמודה ל-dohefes_reports -
-- dohefes_reports/dohefes_payment_orders/dohefes_product_entitlements כבר תומכים ב-'baseReport'
-- מהמיגרציה המקורית (migrations/20260828062934_dohefes_payment_infrastructure.sql, ה-check
-- constraint על product_type כבר כלל 'baseReport' מההתחלה - הוא פשוט מעולם לא נוצל בפועל, כי
-- שום קוד לא יצר עד כה הזמנת baseReport דרך התשתית המאובטחת).
--
-- **RLS של dohefes_reports: אין שינוי** (עדיין using(true)/with check(true) - סגירתה מתוכננת
-- רק אחרי מעבר ה-UI, ר' audit ה-blocker §5 "סדר rollout בטוח" - לא בקובץ הזה). ה-RPCs כאן
-- ניגשים ל-dohefes_reports דרך security definer (עוקף RLS מבפנים, בדיוק כמו
-- dohefes_get_tracking_data כבר עושה ל-project_name בלבד) - לא GRANT/policy חדשים.

-- ==========================================================================================
-- RPC 1: dohefes_create_base_report_payment_order - draft+order אטומיים, ללא reportId מהלקוח
-- ==========================================================================================
--
-- **הבעיה שהפונקציה הזו פותרת**: עד commit זה, reportId נוצר בצד הלקוח (React, לפני שיש שום
-- ראיית תשלום) - ר' audit ה-blocker. כאן, ה-draft (dohefes_reports) וההזמנה (dohefes_payment_orders)
-- נוצרים **יחד, בתוך אותה קריאת RPC אחת** - Postgres עוטף כל קריאת פונקציה ברמה העליונה
-- בטרנזקציה מרומזת (אם אין אחת פתוחה כבר) - אין חלון שבו קיים draft בלי order מקושר אליו
-- (מלבד race אמיתי, ר' 'idempotency_race' למטה - וגם שם, ה-draft של המפסידה **לא** נשאר).
--
-- p_deal_type: מאומת מול רשימה קשיחה (isDealType) - **שתי מקומות** צריכים להישאר מסונכרנים
-- ידנית: כאן, ו-supabase/functions/_shared/deal-types.ts (שממנו create-payment-order-request-parser.ts
-- כבר מסנן dealType לא-תקין **לפני** שהוא בכלל מגיע לכאן - הבדיקה כאן היא הגנת-עומק, לא
-- הוולידציה הראשית. שני המקומות משקפים lib/calc/types.ts::DealType, שלא ניתן לייבא ישירות
-- (type בלבד, נמחק בזמן קומפילציה - אין דרך טכנית לשתף קבוע ממשי בין שלושת ה-runtimes).
--
-- p_amount_agorot/p_currency_code: מגיעים מ-payment-products.ts (getProduct("baseReport")) -
-- אותו עיקרון בדיוק כמו NewOrderInput.amountAgorot למוצרי המשך - **לעולם לא** מהלקוח.
--
-- draft שנוצר: project_name=null, inputs='{}'::jsonb, results=null, payment_status='pending'
-- (ברירת המחדל הקיימת של dohefes_reports.payment_status - **לצורכי תאימות בלבד**, לא מקור
-- הרשאה: dohefes_get_report_data/dohefes_save_report_data למטה, ובדיקת הזכאות למוצרי המשך
-- ב-_shared/payment-order-service.ts, **לא** קוראים את השדה הזה בכלל יותר - הוא נשאר קיים כי
-- אין סיבה להסיר עמודה שקוד legacy אחר (dohefes_reports הישן, לא נוגע בזה כאן) עדיין קורא).
-- deal_type=p_deal_type (מאומת). לא ממציאים project_name - נשאר null עד שהמשתמש ימלא אותו
-- דרך dohefes_save_report_data, אחרי שהתשלום אושר.
--
-- **"כל כשל ביצירת order מבטל גם את יצירת draft" + "exception handling אינו בולע unique
-- violation ומשאיר draft יתום"** (דרישות מפורשות): שני ה-INSERTs (dohefes_reports ואז
-- dohefes_payment_orders) חיים **בתוך אותו BEGIN...EXCEPTION...END פנימי אחד**. PL/pgSQL פותח
-- savepoint מרומז בתחילת בלוק כזה - אם unique_violation נזרק (על idempotency_key/
-- provider_order_reference/access_token_hash, כולם unique בטבלה) בשלב ה-INSERT השני, Postgres
-- מגלגל אחורה **לנקודת תחילת הבלוק**, כלומר **גם** את ה-INSERT הראשון (ל-dohefes_reports) שכבר
-- הצליח לפני-כן - לא רק את השני. זה **לא** "תופס את ה-exception ואז ממשיך בשקט" - זהו בלוק
-- אחד יחיד שמגלגל את כל תוכנו אחורה כאילו לא קרה כלום, ומחזיר 'idempotency_race' כדי שהקורא
-- (payment-order-service.ts) יאתר את ההזמנה שניצחה דרך findOrderByIdempotencyKey - בדיוק אותו
-- עיקרון כמו הטיפול הקיים ב-race על insertOrder הרגילה (partial unique index, migrations/20260828062934_...sql).
--
-- **"מרוץ עם אותו idempotency key אינו יוצר שני drafts"**: מכוסה ישירות על ידי הפסקה הקודמת -
-- המפסידה מתגלגלת אחורה במלואה, אין לה draft בכלל אחרי ה-EXCEPTION.
--
-- **"retry עם אותו key מחזיר את אותו reportId/order"**: מטופל **מחוץ** לפונקציה הזו, ב-
-- payment-order-service.ts::createBaseReportOrder - קודם בודקים findOrderByIdempotencyKey; רק
-- אם לא נמצא כלום קוראים ל-RPC הזו. retry אמיתי (לא race) אף פעם לא מגיע לכאן שוב.
--
-- **"שני idempotency keys שונים יוצרים שני drafts נפרדים"**: אין הגבלה כאן המונעת זאת - בניגוד
-- למוצרי המשך (partial unique index על report_id+product_type), אין עדיין report_id לפני
-- שה-draft נוצר, כך שאין דרך מבנית "לחסום" ניסיון נוסף מראש. זו התנהגות **מכוונת**, מתועדת
-- כפער ניקוי עתידי (ר' audit ה-blocker §2 "כיצד מנקים drafts נטושים" + §3 בקובץ הזה) - לא
-- מתוקנת בקומיט הזה.
create or replace function dohefes_create_base_report_payment_order(
  p_deal_type text,
  p_idempotency_key text,
  p_amount_agorot integer,
  p_currency_code integer,
  p_provider_order_reference text,
  p_access_token_hash text
)
returns table (
  outcome text,
  report_id uuid,
  order_id uuid,
  order_status text,
  provider_order_reference text,
  checkout_url text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_report_id uuid;
  v_order_id uuid;
  v_order_status text;
begin
  if p_deal_type is null
     or p_idempotency_key is null
     or p_amount_agorot is null
     or p_currency_code is null
     or p_provider_order_reference is null
     or p_access_token_hash is null then
    return query select 'invalid_input'::text, null::uuid, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  -- רשימה קשיחה - חייבת להישאר מסונכרנת ידנית עם supabase/functions/_shared/deal-types.ts
  -- ועם lib/calc/types.ts::DealType (ר' הערת הכותרת למעלה).
  if p_deal_type not in ('tama38', 'basic', 'kombinatsia', 'pinuyBinui', 'kombinatsiaTemurot', 'purchaseGroup', 'mixedUse') then
    return query select 'invalid_deal_type'::text, null::uuid, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  begin
    insert into dohefes_reports (project_name, deal_type, inputs, results, payment_status)
    values (null, p_deal_type, '{}'::jsonb, null, 'pending')
    returning id into v_report_id;

    insert into dohefes_payment_orders (
      report_id, product_type, expected_amount_agorot, currency_code, status,
      idempotency_key, provider_order_reference, access_token_hash
    )
    values (
      v_report_id, 'baseReport', p_amount_agorot, p_currency_code, 'created',
      p_idempotency_key, p_provider_order_reference, p_access_token_hash
    )
    returning id, status into v_order_id, v_order_status;
  exception when unique_violation then
    -- ר' הערת הכותרת - שני ה-INSERTs מתגלגלים אחורה יחד, כולל ה-draft. לא נכתב כלום.
    return query select 'idempotency_race'::text, null::uuid, null::uuid, null::text, null::text, null::text;
    return;
  end;

  return query select 'created'::text, v_report_id, v_order_id, v_order_status, p_provider_order_reference, null::text;
end;
$$;

revoke execute on function dohefes_create_base_report_payment_order(text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function dohefes_create_base_report_payment_order(text, text, integer, integer, text, text) to service_role;

-- ==========================================================================================
-- RPC 2/3: dohefes_get_report_data / dohefes_save_report_data - קריאה/כתיבה מאובטחת של דוח
-- ==========================================================================================
--
-- אותו דפוס בדיוק כמו dohefes_get_tracking_data/dohefes_save_tracking_data (migrations/20260829081055_dohefes_tracking_data.sql):
-- אימות token+entitlement באותה קריאת RPC אחת, לא "בדוק ואז פעל" נפרד. product_type='baseReport'
-- (ולא 'trackingReports') הוא ההבדל היחיד בבדיקות עצמן.
--
-- **מחליף** את הגישה הישירה מה-UI ל-dohefes_reports (app/calculator/page.tsx/app/report/page.tsx,
-- ר' audit ה-blocker) - שינוי ה-UI עצמו **אינו** בהיקף Commit 6a ("ללא React") - התשתית כאן
-- מוכנה, אך /calculator/report לא חוברו אליה עדיין.
--
-- get מחזירה בדיוק: outcome, report_id, project_name, deal_type, inputs, results. **אין**
-- payment_status/tracking/created_at/token/hash בתגובה - אין להם עמודה מקבילה ב-RETURNS TABLE
-- בכלל, לא רק "מוסתרים בקוד".
create or replace function dohefes_get_report_data(
  p_report_id uuid,
  p_access_token_hash text
)
returns table (
  outcome text,
  report_id uuid,
  project_name text,
  deal_type text,
  inputs jsonb,
  results jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_found boolean;
  v_entitlement_found boolean;
  v_report dohefes_reports%rowtype;
begin
  if p_report_id is null or p_access_token_hash is null then
    return query select 'invalid_input'::text, null::uuid, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;

  select exists(
    select 1 from dohefes_payment_orders o
    where o.access_token_hash = p_access_token_hash
      and o.report_id = p_report_id
      and o.product_type = 'baseReport'
  ) into v_order_found;

  if not v_order_found then
    return query select 'unavailable'::text, null::uuid, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;

  select exists(
    select 1 from dohefes_product_entitlements e
    where e.report_id = p_report_id
      and e.product_type = 'baseReport'
      and e.entitlement_status = 'active'
  ) into v_entitlement_found;

  if not v_entitlement_found then
    return query select 'unavailable'::text, null::uuid, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;

  -- מגיעים לכאן רק אחרי ששתי הבדיקות עברו - נתוני הדוח נחשפים רק מהנקודה הזו ואילך.
  select * into v_report from dohefes_reports r where r.id = p_report_id;

  return query select 'active'::text, v_report.id, v_report.project_name, v_report.deal_type, v_report.inputs, v_report.results;
end;
$$;

revoke execute on function dohefes_get_report_data(uuid, text) from public, anon, authenticated;
grant execute on function dohefes_get_report_data(uuid, text) to service_role;

-- p_project_name/p_deal_type: **כן** ניתנים לשינוי (בניגוד ל-id/created_at/payment_status/
-- tracking, שאין להם פרמטר מקביל בכלל בחתימה הזו) - משקף התנהגות קיימת בפועל של
-- app/calculator/page.tsx (effect "שמירה רציפה" כותב project_name/deal_type בכל autosave, לא
-- רק בשמירה הראשונה - בורר סוג העסקה נשאר פעיל בטופס אחרי יצירת הדוח, ר' audit ה-commit).
-- p_deal_type מאומת מול אותה רשימה קשיחה כמו RPC 1 - הגנת-עומק, הוולידציה הראשית ב-
-- report-data-validator.ts (Edge Function, לפני שמגיע לכאן).
--
-- גודל payload: 500,000 בתים לכל אחד מ-inputs/results בנפרד - **אותו ערך בדיוק** כמו
-- MAX_REPORT_DATA_BODY_BYTES ב-_shared/report-data-validator.ts (אין דרך טכנית לשתף קבוע
-- ממשי בין TS ל-SQL, מתועד כאן ושם). הגנת-עומק בלבד - הוולידציה הראשית כבר קרתה ב-Edge Function.
--
-- **אין UPDATE על payment_status/tracking/id/created_at בשום מקום בפונקציה** - ה-UPDATE
-- היחיד כאן מגדיר set רק על project_name/deal_type/inputs/results - "save אינו יכול לשנות
-- id/payment_status/tracking/created_at" נאכף מבנית, לא רק בכוונה.
create or replace function dohefes_save_report_data(
  p_report_id uuid,
  p_access_token_hash text,
  p_project_name text,
  p_deal_type text,
  p_inputs jsonb,
  p_results jsonb
)
returns table (outcome text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_found boolean;
  v_entitlement_found boolean;
begin
  if p_report_id is null or p_access_token_hash is null or p_deal_type is null or p_inputs is null then
    return query select 'invalid_input'::text;
    return;
  end if;

  if p_deal_type not in ('tama38', 'basic', 'kombinatsia', 'pinuyBinui', 'kombinatsiaTemurot', 'purchaseGroup', 'mixedUse') then
    return query select 'invalid_payload'::text;
    return;
  end if;

  if jsonb_typeof(p_inputs) <> 'object' then
    return query select 'invalid_payload'::text;
    return;
  end if;

  if p_results is not null and jsonb_typeof(p_results) <> 'object' then
    return query select 'invalid_payload'::text;
    return;
  end if;

  if octet_length(p_inputs::text) > 500000 or (p_results is not null and octet_length(p_results::text) > 500000) then
    return query select 'invalid_payload'::text;
    return;
  end if;

  select exists(
    select 1 from dohefes_payment_orders o
    where o.access_token_hash = p_access_token_hash
      and o.report_id = p_report_id
      and o.product_type = 'baseReport'
  ) into v_order_found;

  if not v_order_found then
    return query select 'unavailable'::text;
    return;
  end if;

  select exists(
    select 1 from dohefes_product_entitlements e
    where e.report_id = p_report_id
      and e.product_type = 'baseReport'
      and e.entitlement_status = 'active'
  ) into v_entitlement_found;

  if not v_entitlement_found then
    return query select 'unavailable'::text;
    return;
  end if;

  update dohefes_reports
  set project_name = p_project_name,
      deal_type = p_deal_type,
      inputs = p_inputs,
      results = p_results
  where id = p_report_id;

  return query select 'saved'::text;
end;
$$;

revoke execute on function dohefes_save_report_data(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function dohefes_save_report_data(uuid, text, text, text, jsonb, jsonb) to service_role;

-- ==========================================================================================
-- §3 (דוח ה-commit): כשל Cardcom ו-drafts - מדיניות מפורשת, לא מומשת כאן
-- ==========================================================================================
--
-- כשל ודאי מול Cardcom (אחרי שה-draft+order כבר נוצרו): order עובר ל-failed (דרך
-- releaseClaimAsFailed הקיים, ר' payment-order-service.ts - **לא** שונה בקובץ הזה) - ה-draft
-- **נשאר קיים ומקושר** ל-order ה-failed שלו, אינו "יתום בלתי מזוהה" (אפשר תמיד לאתר אותו לפי
-- dohefes_payment_orders.report_id). timeout/כשל עמום: order נשאר created עם claim עד תפוגה,
-- לפי אותה מדיניות קיימת בדיוק (isAmbiguousCardcomFailure).
--
-- **אין מחיקת draft אוטומטית בתוך request כלשהו, ולא בקובץ הזה** - כלל cleanup עתידי מתועד
-- בלבד, לא ממומש: מותר למחוק draft ישן **רק** אם (א) אין לו entitlement פעילה בכלל, וגם (ב)
-- כל ה-orders המקושרים אליו הם terminal (failed/cancelled/refunded) ואף אחד לא paid. שני
-- התנאים יחד - draft עם order יחיד ב-created/pending "רק עדיין לא סיים checkout" **אסור**
-- שיימחק, גם אם ישן.

-- --- Rollback: נפרד, מחוץ ל-supabase/migrations/, אותה מוסכמה מדויקת כמו המיגרציות הקודמות ---
-- ר' supabase/migrations_rollback/20260829151144_dohefes_base_report_secure_backend_rollback.sql -
-- מסרב לרוץ אם קיים ולו order/entitlement אחד מסוג 'baseReport' (מכסה גם drafts - כל draft
-- נוצר תמיד יחד עם order תואם, ר' RPC 1 למעלה).

-- ==========================================================================================
-- תרחישי בדיקה ידניים (מתועדים בלבד - לא מבוצעים אוטומטית, אותה מוסכמה כמו שאר הקובץ)
-- ==========================================================================================
--
-- 1. draft+order נוצרים יחד:
--   select * from dohefes_create_base_report_payment_order('tama38', 'idem-1', 98000, 1, 'po_1', 'hash-1');
--   -- צפוי: outcome='created', report_id/order_id לא null, order_status='created'.
--   select count(*) from dohefes_reports where id = '<report_id שהוחזר>';
--   -- צפוי: 1.
--
-- 2. dealType לא תקין -> אין draft/order כלל:
--   select * from dohefes_create_base_report_payment_order('notReal', 'idem-2', 98000, 1, 'po_2', 'hash-2');
--   -- צפוי: outcome='invalid_deal_type'. select count(*) from dohefes_reports; -- ללא שינוי.
--
-- 3. אותו idempotency_key פעם שנייה (retry אמיתי, לא race) -> unique_violation על idempotency_key,
--    'idempotency_race', ואין draft שני:
--   select * from dohefes_create_base_report_payment_order('tama38', 'idem-1', 98000, 1, 'po_3', 'hash-3');
--   -- צפוי: outcome='idempotency_race'. select count(*) from dohefes_reports; -- עדיין 1, לא 2.
--
-- 4. get/save לפני entitlement פעיל -> unavailable, גם עם access_token_hash תואם להזמנה pending/created:
--   select * from dohefes_get_report_data('<report_id>', 'hash-1');
--   -- צפוי: outcome='unavailable' (ההזמנה עדיין לא paid, אין entitlement).
--
-- 5. אחרי entitlement פעיל (מדומה ידנית, כמו בתרחישי migrations/20260828062934_...sql) -> active:
--   select * from dohefes_get_report_data('<report_id>', 'hash-1');
--   -- צפוי: outcome='active', deal_type='tama38', inputs='{}'::jsonb, results=null, project_name=null.
--
-- 6. save עם dealType/projectName חדשים -> saved, ואז get חוזר מחזיר את הערכים המעודכנים:
--   select * from dohefes_save_report_data('<report_id>', 'hash-1', 'רחוב הרצל 1', 'basic', '{"a":1}'::jsonb, '{"b":2}'::jsonb);
--   -- צפוי: outcome='saved'.
--
-- 7. save עם dealType לא-תקין -> invalid_payload, אין UPDATE:
--   select * from dohefes_save_report_data('<report_id>', 'hash-1', null, 'notReal', '{}'::jsonb, null);
--   -- צפוי: outcome='invalid_payload'.
--
-- 8. token של דוח אחר -> unavailable (לא חושף קיום/אי-קיום):
--   select * from dohefes_get_report_data('<report-אחר>', 'hash-1');
--   -- צפוי: outcome='unavailable'.
