-- =====================================================================
--  VOY Push — Supabase SQL Editor 에 통째로 붙여넣고 Run
--  여러 번 실행해도 안전합니다 (이미 만든 테이블은 그대로 두고 빠진 것만 추가)
-- =====================================================================

create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  name        text,
  grp         text,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

-- v2: 사번 컬럼 (기존 설치에도 추가됨)
alter table public.push_subscriptions add column if not exists emp_no text;
create index if not exists push_subscriptions_emp_no_idx on public.push_subscriptions (emp_no);

create table if not exists public.push_messages (
  id          bigint generated always as identity primary key,
  title       text not null,
  body        text,
  url         text,
  icon        text,
  image       text,
  target      text,
  sent        int not null default 0,
  failed      int not null default 0,
  removed     int not null default 0,
  clicks      int not null default 0,
  created_at  timestamptz not null default now()
);

-- RLS 켜고 정책은 만들지 않음 → 브라우저(anon)에서는 직접 접근 불가,
-- Edge Function(service role)만 읽고 쓸 수 있음
alter table public.push_subscriptions enable row level security;
alter table public.push_messages      enable row level security;

create or replace function public.push_increment_click(mid bigint)
returns void language sql security definer set search_path = public as $$
  update public.push_messages set clicks = clicks + 1 where id = mid;
$$;
revoke all on function public.push_increment_click(bigint) from public, anon, authenticated;
grant execute on function public.push_increment_click(bigint) to service_role;
