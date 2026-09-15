-- =====================================================================
--  LABEL PADHO: votes + page visit tracking
--
--  HOW TO USE
--  Supabase dashboard > SQL Editor > New query > paste this whole
--  file > Run. Running it again later is safe; it won't delete data.
--
--  Every review is identified ONLY by its permanent number (post_id),
--  never by its file name or title.
--
--  SECURITY MODEL
--  - Visitors can never read or write the tables directly
--    (row level security is on, with no policies).
--  - The website can only call the five functions below, which
--    validate every input.
--  - No IP addresses, names, emails or cookies are stored. Each browser
--    gets a random ID kept in its own localStorage.
-- =====================================================================


-- ---------- Safety check for the older name-based version -------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('votes', 'page_views') and column_name = 'post_slug'
  ) then
    raise exception 'Found tables from the older name-based version. Run the reset snippet in README (Part 2, step 2) first, then run this file again.';
  end if;
end;
$$;

drop function if exists public.record_view(text, integer, uuid, text);
drop function if exists public.get_post_stats(text, uuid);
drop function if exists public.cast_vote(text, uuid, integer);
drop function if exists public.get_posts_stats(text[]);
drop function if exists public.get_site_stats(integer, text[]);


-- ---------- Tables ----------------------------------------------------

create table if not exists public.page_views (
  id            bigint generated always as identity primary key,
  path          text        not null check (char_length(path) between 1 and 300),
  post_id       integer     check (post_id between 1 and 1000000000),
  visitor_id    uuid        not null,
  referrer_host text        check (char_length(referrer_host) <= 255),
  viewed_at     timestamptz not null default now()
);

create index if not exists page_views_post_id_idx   on public.page_views (post_id) where post_id is not null;
create index if not exists page_views_visitor_idx   on public.page_views (visitor_id, viewed_at desc);
create index if not exists page_views_viewed_at_idx on public.page_views (viewed_at);

create table if not exists public.votes (
  post_id    integer     not null check (post_id between 1 and 1000000000),
  voter_id   uuid        not null,
  value      smallint    not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, voter_id)
);

create index if not exists votes_post_id_idx on public.votes (post_id);

alter table public.page_views enable row level security;
alter table public.votes      enable row level security;

revoke all on table public.page_views from anon, authenticated;
revoke all on table public.votes      from anon, authenticated;


-- ---------- 1. Record a page visit -----------------------------------
-- Reloading the same page within 30 minutes is not counted again.
-- A single browser can record at most 100 visits per hour.

create or replace function public.record_view(
  p_path          text,
  p_post_id       integer,
  p_visitor_id    uuid,
  p_referrer_host text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer text := lower(p_referrer_host);
begin
  if p_visitor_id is null
     or p_path is null
     or char_length(p_path) not between 1 and 300
     or left(p_path, 1) <> '/' then
    raise exception 'Invalid visit data' using errcode = '22023';
  end if;

  if p_post_id is not null and p_post_id not between 1 and 1000000000 then
    raise exception 'Invalid review number' using errcode = '22023';
  end if;

  if v_referrer is not null
     and (char_length(v_referrer) > 255 or v_referrer !~ '^[a-z0-9.-]+$') then
    v_referrer := null;
  end if;

  if exists (
    select 1 from page_views
    where visitor_id = p_visitor_id
      and path = p_path
      and viewed_at > now() - interval '30 minutes'
  ) then
    return;
  end if;

  if (
    select count(*) from page_views
    where visitor_id = p_visitor_id
      and viewed_at > now() - interval '1 hour'
  ) >= 100 then
    return;
  end if;

  insert into page_views (path, post_id, visitor_id, referrer_host)
  values (p_path, p_post_id, p_visitor_id, v_referrer);
end;
$$;


-- ---------- 2. Stats for one review ----------------------------------

create or replace function public.get_post_stats(
  p_post_id    integer,
  p_voter_id   uuid
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'views',     (select count(*) from page_views where post_id = p_post_id),
    'upvotes',   (select count(*) from votes where post_id = p_post_id and value = 1),
    'downvotes', (select count(*) from votes where post_id = p_post_id and value = -1),
    'my_vote',   coalesce((select value from votes where post_id = p_post_id and voter_id = p_voter_id), 0)
  );
$$;


-- ---------- 3. Cast, change or remove a vote -------------------------
-- p_value: 1 = upvote, -1 = downvote, 0 = remove my vote.
-- One vote per browser per review.

create or replace function public.cast_vote(
  p_post_id   integer,
  p_voter_id  uuid,
  p_value     integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_post_id is null or p_post_id not between 1 and 1000000000 then
    raise exception 'Invalid review number' using errcode = '22023';
  end if;
  if p_voter_id is null then
    raise exception 'Missing voter id' using errcode = '22023';
  end if;
  if p_value is null or p_value not in (-1, 0, 1) then
    raise exception 'Vote must be -1, 0 or 1' using errcode = '22023';
  end if;

  if p_value = 0 then
    delete from votes where post_id = p_post_id and voter_id = p_voter_id;
  else
    insert into votes (post_id, voter_id, value)
    values (p_post_id, p_voter_id, p_value)
    on conflict (post_id, voter_id)
    do update set value = excluded.value, updated_at = now();
  end if;

  return public.get_post_stats(p_post_id, p_voter_id);
end;
$$;


-- ---------- 4. Stats for many reviews (home page & listing) ----------
-- Only review numbers the website sends are returned, so junk data can never
-- appear in "Most upvoted" or "Most viewed".

create or replace function public.get_posts_stats(
  p_post_ids integer[]
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select distinct id
    from unnest((coalesce(p_post_ids, '{}'::integer[]))[1:5000]) as id
    where id between 1 and 1000000000
  ),
  v as (
    select post_id, count(*) as views
    from page_views
    where post_id in (select id from s)
    group by post_id
  ),
  vt as (
    select post_id,
           count(*) filter (where value = 1)  as upvotes,
           count(*) filter (where value = -1) as downvotes
    from votes
    where post_id in (select id from s)
    group by post_id
  )
  select json_build_object(
    'total_views', (select count(*) from page_views),
    'posts', coalesce((
      select json_agg(json_build_object(
        'post_id',   s.id,
        'views',     coalesce(v.views, 0),
        'upvotes',   coalesce(vt.upvotes, 0),
        'downvotes', coalesce(vt.downvotes, 0)
      ))
      from s
      left join v  on v.post_id  = s.id
      left join vt on vt.post_id = s.id
    ), '[]'::json)
  );
$$;


-- ---------- 5. Whole-site stats (the /stats/ page) -------------------
-- Days are counted in Indian Standard Time.

create or replace function public.get_site_stats(
  p_days     integer,
  p_post_ids integer[]
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select greatest(7, least(coalesce(p_days, 30), 90)) as days,
           (now() at time zone 'Asia/Kolkata')::date     as today
  ),
  daily as (
    select (viewed_at at time zone 'Asia/Kolkata')::date as day,
           count(*) as views,
           count(distinct visitor_id) as visitors
    from page_views
    where viewed_at > now() - interval '91 days'
    group by 1
  )
  select json_build_object(
    'total_views',     (select count(*) from page_views),
    'unique_visitors', (select count(distinct visitor_id) from page_views),
    'views_today',     (select coalesce(sum(views), 0) from daily, params where day = params.today),
    'views_7d',        (select count(*) from page_views where viewed_at > now() - interval '7 days'),
    'views_30d',       (select count(*) from page_views where viewed_at > now() - interval '30 days'),
    'visitors_30d',    (select count(distinct visitor_id) from page_views where viewed_at > now() - interval '30 days'),
    'total_votes',     (select count(*) from votes),
    'daily', (
      select json_agg(json_build_object(
               'day', to_char(d, 'YYYY-MM-DD'),
               'views', coalesce(daily.views, 0),
               'visitors', coalesce(daily.visitors, 0)
             ) order by d)
      from params,
           generate_series(params.today - (params.days - 1), params.today, interval '1 day') as d
      left join daily on daily.day = d::date
    ),
    'top_pages', coalesce((
      select json_agg(t) from (
        select path, count(*) as views, count(distinct visitor_id) as visitors
        from page_views
        group by path
        order by views desc, path
        limit 20
      ) t
    ), '[]'::json),
    'top_referrers', coalesce((
      select json_agg(t) from (
        select referrer_host as host, count(*) as views
        from page_views
        where referrer_host is not null
        group by referrer_host
        order by views desc, host
        limit 10
      ) t
    ), '[]'::json),
    'posts', public.get_posts_stats(p_post_ids) -> 'posts'
  );
$$;


-- ---------- Permissions ----------------------------------------------

revoke execute on function public.record_view(text, integer, uuid, text)  from public;
revoke execute on function public.get_post_stats(integer, uuid)       from public;
revoke execute on function public.cast_vote(integer, uuid, integer)   from public;
revoke execute on function public.get_posts_stats(integer[])          from public;
revoke execute on function public.get_site_stats(integer, integer[])  from public;

grant execute on function public.record_view(text, integer, uuid, text)  to anon, authenticated;
grant execute on function public.get_post_stats(integer, uuid)        to anon, authenticated;
grant execute on function public.cast_vote(integer, uuid, integer)    to anon, authenticated;
grant execute on function public.get_posts_stats(integer[])           to anon, authenticated;
grant execute on function public.get_site_stats(integer, integer[])   to anon, authenticated;

-- Ask the API to pick up the new functions immediately.
notify pgrst, 'reload schema';
