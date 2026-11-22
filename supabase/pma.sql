-- 個人通訊（personal_meeting_app）的長期訊息資料表（路徑 A：Supabase）
-- 用法：Supabase 專案（與 desktop-app 共用）→ SQL Editor → 貼上整份 → Run。可重複執行（冪等）。
-- 不與 desktop-app 的 rg_* 表混用。資料表本身不開放 anon/authenticated 直接存取，
-- 只能透過下面兩個函式寫入與讀取。

create table if not exists public.pma_messages (
  id          text primary key,
  conv        text not null,
  ts          bigint not null,
  from_id     text not null default '',
  kind        text not null default 'text',
  body        text not null default '',
  subtitle    text,
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists pma_messages_conv_ts on public.pma_messages (conv, ts);

alter table public.pma_messages enable row level security;
revoke all on public.pma_messages from anon, authenticated;

-- 寫入一則訊息（重複 id 會覆蓋，方便離線重送）
create or replace function public.pma_put_message(p jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.pma_messages (id, conv, ts, from_id, kind, body, subtitle, attachments)
  values (
    p->>'id',
    p->>'conv',
    (p->>'ts')::bigint,
    coalesce(p->>'from', ''),
    coalesce(p->>'kind', 'text'),
    coalesce(p->>'body', ''),
    p->>'subtitle',
    coalesce(p->'attachments', '[]'::jsonb)
  )
  on conflict (id) do update set
    body = excluded.body,
    subtitle = excluded.subtitle,
    attachments = excluded.attachments;
  return true;
end $$;

-- 讀取某對話在某時間之後的訊息（依時間排序，最多 500 則）
create or replace function public.pma_list_messages(p_conv text, p_since bigint default 0)
returns setof public.pma_messages
language sql security definer set search_path = public stable as $$
  select * from public.pma_messages
  where conv = p_conv and ts > p_since
  order by ts
  limit 500
$$;

revoke all on function public.pma_put_message(jsonb) from public;
revoke all on function public.pma_list_messages(text, bigint) from public;
grant execute on function public.pma_put_message(jsonb) to anon, authenticated;
grant execute on function public.pma_list_messages(text, bigint) to anon, authenticated;
