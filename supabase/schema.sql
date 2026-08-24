-- מיזם "דוחות אפס" — סכמת Supabase
-- אותו פרויקט Supabase המשותף (giygjmacxquucwexmfdd, אותו כמו insure-vda/rami/hetel-hasbaha)
-- כל הטבלאות בקידומת dohefes_ כדי לא להתנגש בטבלאות הקיימות

create extension if not exists "pgcrypto";

-- דוחות שנשמרו, לכל דוח UUID פרטי שהוא גם הקישור הקבוע שלו (המשתמש שומר את ה-URL, זו ה"התחברות" שלו)
create table if not exists dohefes_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_name text,
  deal_type text not null,
  inputs jsonb not null,
  results jsonb,
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid'))
);

-- הזמנות "דוח אפס בהתאמה אישית" (1,800 ₪)
create table if not exists dohefes_custom_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  phone text,
  email text,
  description text,
  file_paths text[] not null default '{}',
  price_nis numeric not null default 1800,
  paid boolean not null default false,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'submitted', 'processing', 'ready', 'sent')),
  -- שני העמודות הבאות נכתבות אך ורק על ידי הסוכן החכם (insure-vda/src/lib/dohefes/skeleton.ts),
  -- דרך מפתח שירות שעוקף RLS, אין להן מדיניות RLS ייעודית
  report_id uuid references dohefes_reports(id),
  ai_notes jsonb
);

-- RLS
alter table dohefes_reports enable row level security;
alter table dohefes_custom_orders enable row level security;

create policy "anyone can create a dohefes report" on dohefes_reports
  for insert with check (true);
create policy "anyone can read a dohefes report by id" on dohefes_reports
  for select using (true);
create policy "anyone can update a dohefes report by id" on dohefes_reports
  for update using (true) with check (true);

create policy "anyone can create a dohefes custom order" on dohefes_custom_orders
  for insert with check (true);
create policy "anyone can read a dohefes custom order by id" on dohefes_custom_orders
  for select using (true);

-- אחסון קבצים למסלול בהתאמה אישית — bucket נפרד "dohefes-uploads" (ליצור דרך ה-Dashboard/Storage, לא כאן)
create policy "anyone can upload dohefes files" on storage.objects
  for insert with check (bucket_id = 'dohefes-uploads');

-- מיגרציה: הוספת report_id/ai_notes לטבלה קיימת (הרץ פעם אחת ב-SQL Editor של סופרבייס)
alter table dohefes_custom_orders add column if not exists report_id uuid references dohefes_reports(id);
alter table dohefes_custom_orders add column if not exists ai_notes jsonb;
