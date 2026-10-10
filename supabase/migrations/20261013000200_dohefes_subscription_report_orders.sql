-- פתיחת דוח אפס מתוך מנוי (שלב 2).
--
-- הרעיון: מנוי הוא "אמצעי תשלום" שמפיק את אותה הרשאה בדיוק כמו תשלום בקארדקום, כך שטעינה, שמירה,
-- ייצוא ודוחות מעקב נשארים בלי שום שינוי ב-Edge Functions ובחזית (dohefes_get_report_data וחבריה בודקים
-- רק הזמנה עם אסימון תואם והרשאה פעילה).
--
-- שינויים:
--   1. dohefes_payment_orders מקבלת payment_source ('cardcom' | 'subscription') ו-subscription_id.
--      בלי foreign key למנויים בכוונה: טבלת המנויים שייכת לריפו insure-vda, והשרת שם מוודא את המזהה.
--   2. שני אילוצים קיימים מורחבים רק עבור הזמנת מנוי: סכום 0 מותר, ו"שולם" לא דורש הוכחת קארדקום
--      אלא subscription_id. אילוצים חדשים מבטיחים שהזמנת מנוי לא נושאת שדות קארדקום, ושהזמנת
--      קארדקום לא נושאת subscription_id. הזמנת קארדקום ממשיכה לדרוש את כל ההוכחה כמו קודם.
--   3. פונקציה dohefes_open_report_from_subscription: ניצול יחידת מכסה, יצירת דוח, והזמנות והרשאות
--      ל-baseReport ול-trackingReports, הכל בטרנזקציה אחת. אם משהו נכשל, גם המכסה חוזרת.
--      קריאה חוזרת עם אותו מפתח idempotency לא מנצלת מכסה ומחזירה את אותו דוח עם אסימונים חדשים.
--
-- תלות: הפונקציה public.subscription_consume_check(uuid, text) מהמיגרציה
-- 20261011000100_decision_subscriptions.sql בריפו insure-vda (כבר מותקנת). חבילות דוחות אפס
-- דורשות גם את 20261013000100_decision_subscriptions_dohefes_product.sql שם.
--
-- ההגנה: לפני כל DROP מוודאים שהאילוץ קיים בדיוק פעם אחת ושההגדרה שלו זהה לצפוי.
-- כל סטייה עוצרת את המיגרציה בלי לשנות כלום.

alter table dohefes_payment_orders
  add column if not exists payment_source text not null default 'cardcom',
  add column if not exists subscription_id uuid;

alter table dohefes_payment_orders
  add constraint dohefes_payment_orders_payment_source_check
  check (payment_source in ('cardcom', 'subscription'));

alter table dohefes_payment_orders
  add constraint dohefes_payment_orders_subscription_pairing
  check ((payment_source = 'subscription') = (subscription_id is not null));

alter table dohefes_payment_orders
  add constraint dohefes_payment_orders_subscription_has_no_cardcom_fields
  check (
    payment_source <> 'subscription'
    or (cardcom_low_profile_code is null and cardcom_internal_deal_number is null and checkout_url is null)
  );

do $$
declare
  v_amount_name text;
  v_amount_def text;
  v_amount_count integer;
  v_evidence_def text;
  v_amount_expected constant text := $e$CHECK ((expected_amount_agorot > 0))$e$;
  v_evidence_expected constant text :=
    $e$CHECK (((status <> 'paid'::text) OR ((verified_at IS NOT NULL) AND (paid_at IS NOT NULL) AND (cardcom_low_profile_code IS NOT NULL) AND (cardcom_internal_deal_number IS NOT NULL))))$e$;
begin
  select count(*), min(c.conname), min(pg_get_constraintdef(c.oid))
    into v_amount_count, v_amount_name, v_amount_def
  from pg_constraint c
  where c.conrelid = 'public.dohefes_payment_orders'::regclass
    and c.contype = 'c'
    and c.conkey = array[(
      select a.attnum from pg_attribute a
      where a.attrelid = 'public.dohefes_payment_orders'::regclass and a.attname = 'expected_amount_agorot'
    )];

  if v_amount_count <> 1 then
    raise exception 'expected exactly one check constraint on dohefes_payment_orders.expected_amount_agorot, found %', v_amount_count;
  end if;
  if v_amount_def <> v_amount_expected then
    raise exception 'unexpected definition of % : %', v_amount_name, v_amount_def;
  end if;

  select pg_get_constraintdef(c.oid) into v_evidence_def
  from pg_constraint c
  where c.conrelid = 'public.dohefes_payment_orders'::regclass
    and c.conname = 'dohefes_payment_orders_paid_requires_evidence';

  if v_evidence_def is null then
    raise exception 'dohefes_payment_orders_paid_requires_evidence not found';
  end if;
  if v_evidence_def <> v_evidence_expected then
    raise exception 'unexpected definition of dohefes_payment_orders_paid_requires_evidence : %', v_evidence_def;
  end if;

  execute format('alter table public.dohefes_payment_orders drop constraint %I', v_amount_name);
  alter table dohefes_payment_orders drop constraint dohefes_payment_orders_paid_requires_evidence;

  alter table dohefes_payment_orders
    add constraint dohefes_payment_orders_expected_amount_agorot_check
    check (expected_amount_agorot > 0 or (payment_source = 'subscription' and expected_amount_agorot = 0));

  alter table dohefes_payment_orders
    add constraint dohefes_payment_orders_paid_requires_evidence
    check (
      status <> 'paid'
      or (
        verified_at is not null
        and paid_at is not null
        and (
          (payment_source = 'cardcom' and cardcom_low_profile_code is not null and cardcom_internal_deal_number is not null)
          or (payment_source = 'subscription' and subscription_id is not null)
        )
      )
    );
end $$;

-- פתיחת דוח מתוך מנוי. נקראת רק מהשרת של המנויים (service_role) אחרי שזיהה את המשתמש.
-- outcome: created | replayed | quota_exceeded | no_subscription | no_user | invalid_input | invalid_deal_type
-- p_idempotency_key: מפתח אקראי של הלקוח, מקבל מרחב שמות פר משתמש, כך שמשתמש אחר לא יכול להתנגש בו.
-- p_base_token_hash / p_tracking_token_hash: SHA-256 של האסימונים. האסימון הגולמי לא נשמר ולא עובר כאן.
create or replace function dohefes_open_report_from_subscription(
  p_user_id uuid,
  p_idempotency_key text,
  p_deal_type text,
  p_base_token_hash text,
  p_tracking_token_hash text
)
returns table (outcome text, report_id uuid, remaining integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_key text;
  v_tracking_key text;
  v_report_id uuid;
  v_consume jsonb;
  v_subscription_id uuid;
  v_remaining integer;
  v_base_order_id uuid;
  v_tracking_order_id uuid;
  v_constraint_name text;
begin
  if p_user_id is null
     or p_idempotency_key is null
     or p_deal_type is null
     or p_base_token_hash is null
     or p_tracking_token_hash is null
     or p_base_token_hash = p_tracking_token_hash
     or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,100}$' then
    return query select 'invalid_input'::text, null::uuid, null::integer;
    return;
  end if;

  -- רשימה קשיחה, מסונכרנת ידנית עם supabase/functions/_shared/deal-types.ts
  if p_deal_type not in ('tama38', 'basic', 'kombinatsia', 'pinuyBinui', 'kombinatsiaTemurot', 'purchaseGroup', 'mixedUse') then
    return query select 'invalid_deal_type'::text, null::uuid, null::integer;
    return;
  end if;

  v_key := 'sub:' || p_user_id::text || ':' || p_idempotency_key;
  v_tracking_key := v_key || ':tracking';

  select o.report_id into v_report_id
  from dohefes_payment_orders o
  where o.idempotency_key = v_key and o.product_type = 'baseReport' and o.payment_source = 'subscription';

  if v_report_id is not null then
    update dohefes_payment_orders set access_token_hash = p_base_token_hash where idempotency_key = v_key;
    update dohefes_payment_orders set access_token_hash = p_tracking_token_hash where idempotency_key = v_tracking_key;
    return query select 'replayed'::text, v_report_id, null::integer;
    return;
  end if;

  begin
    v_consume := public.subscription_consume_check(p_user_id, 'dohefes');

    if coalesce((v_consume ->> 'ok')::boolean, false) is not true then
      return query select coalesce(v_consume ->> 'reason', 'no_subscription')::text, null::uuid, null::integer;
      return;
    end if;

    v_subscription_id := (v_consume ->> 'subscription_id')::uuid;
    v_remaining := (v_consume ->> 'remaining')::integer;

    insert into dohefes_reports (project_name, deal_type, inputs, results, payment_status)
    values (null, p_deal_type, '{}'::jsonb, null, 'pending')
    returning id into v_report_id;

    insert into dohefes_payment_orders (
      report_id, product_type, expected_amount_agorot, currency_code, status,
      idempotency_key, provider_order_reference, access_token_hash,
      verified_at, paid_at, payment_source, subscription_id
    )
    values (
      v_report_id, 'baseReport', 0, 1, 'paid',
      v_key, 'sub_' || replace(gen_random_uuid()::text, '-', ''), p_base_token_hash,
      now(), now(), 'subscription', v_subscription_id
    )
    returning id into v_base_order_id;

    insert into dohefes_product_entitlements (report_id, product_type, entitlement_status, payment_order_id)
    values (v_report_id, 'baseReport', 'active', v_base_order_id);

    insert into dohefes_payment_orders (
      report_id, product_type, expected_amount_agorot, currency_code, status,
      idempotency_key, provider_order_reference, access_token_hash,
      verified_at, paid_at, payment_source, subscription_id
    )
    values (
      v_report_id, 'trackingReports', 0, 1, 'paid',
      v_tracking_key, 'sub_' || replace(gen_random_uuid()::text, '-', ''), p_tracking_token_hash,
      now(), now(), 'subscription', v_subscription_id
    )
    returning id into v_tracking_order_id;

    insert into dohefes_product_entitlements (report_id, product_type, entitlement_status, payment_order_id)
    values (v_report_id, 'trackingReports', 'active', v_tracking_order_id);
  exception when unique_violation then
    -- הבלוק כולו התגלגל אחורה, כולל יחידת המכסה. רק מפתח idempotency זהה הוא מרוץ לגיטימי של אותה בקשה.
    get stacked diagnostics v_constraint_name = constraint_name;

    if v_constraint_name = 'dohefes_payment_orders_idempotency_key_key' then
      select o.report_id into v_report_id
      from dohefes_payment_orders o
      where o.idempotency_key = v_key and o.product_type = 'baseReport' and o.payment_source = 'subscription';

      if v_report_id is not null then
        update dohefes_payment_orders set access_token_hash = p_base_token_hash where idempotency_key = v_key;
        update dohefes_payment_orders set access_token_hash = p_tracking_token_hash where idempotency_key = v_tracking_key;
        return query select 'replayed'::text, v_report_id, null::integer;
        return;
      end if;
    end if;

    raise;
  end;

  return query select 'created'::text, v_report_id, v_remaining;
end;
$$;

revoke execute on function dohefes_open_report_from_subscription(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function dohefes_open_report_from_subscription(uuid, text, text, text, text) to service_role;
