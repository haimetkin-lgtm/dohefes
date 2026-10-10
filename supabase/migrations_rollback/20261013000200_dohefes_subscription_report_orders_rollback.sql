-- ביטול 20261013000200_dohefes_subscription_report_orders.sql. להרצה ידנית בלבד, לא כחלק מ-supabase/migrations.
-- נעצר ולא משנה כלום אם כבר קיימות הזמנות מנוי: מחיקתן היתה מוחקת הרשאות של לקוחות. במקרה כזה צריך החלטה נפרדת.

begin;

do $$
begin
  if exists (select 1 from dohefes_payment_orders where payment_source = 'subscription') then
    raise exception 'subscription orders exist, refusing to roll back';
  end if;
end $$;

drop function if exists dohefes_open_report_from_subscription(uuid, text, text, text, text);

alter table dohefes_payment_orders drop constraint if exists dohefes_payment_orders_paid_requires_evidence;
alter table dohefes_payment_orders drop constraint if exists dohefes_payment_orders_expected_amount_agorot_check;
alter table dohefes_payment_orders drop constraint if exists dohefes_payment_orders_subscription_has_no_cardcom_fields;
alter table dohefes_payment_orders drop constraint if exists dohefes_payment_orders_subscription_pairing;
alter table dohefes_payment_orders drop constraint if exists dohefes_payment_orders_payment_source_check;

alter table dohefes_payment_orders
  add constraint dohefes_payment_orders_expected_amount_agorot_check
  check (expected_amount_agorot > 0);

alter table dohefes_payment_orders
  add constraint dohefes_payment_orders_paid_requires_evidence
  check (
    status <> 'paid'
    or (
      verified_at is not null
      and paid_at is not null
      and cardcom_low_profile_code is not null
      and cardcom_internal_deal_number is not null
    )
  );

alter table dohefes_payment_orders drop column if exists subscription_id;
alter table dohefes_payment_orders drop column if exists payment_source;

commit;
