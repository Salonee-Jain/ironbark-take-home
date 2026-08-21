-- Multi-tenancy: companies, users, and an owner on every fact table.
--
-- Three decisions worth stating up front:
--   1. company_id is NOT NULL on every fact table and part of every uniqueness
--      constraint that used to be global. Invoice 40497 is unique within a
--      company, not globally.
--   2. Reference data stays global. Emission factors and rule definitions are
--      our taxonomy, and two tenants must not disagree about what a factor means.
--   3. Deleting a company cascades all the way down.

-- ---------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------
create table companies (
    id         bigint generated always as identity primary key,

    -- Stable, URL-safe, and assigned once. The display name can be corrected
    -- (spelling, a rebrand) without invalidating anything that referenced it.
    slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name       text not null,

    -- Optional at signup. An ABN is how an Australian reporting entity is
    -- actually identified, but demanding one before a user can see their own
    -- data would be gatekeeping the wrong thing, and a blank is honest where a
    -- placeholder is not. Validated when present, never invented.
    abn        text check (abn is null or abn ~ '^\d{11}$'),

    created_at timestamptz not null default now()
);

-- Users. One company each: a nullable "current company" on the session is the
-- shape that produces cross-tenant bugs. Multi-company membership can be added
-- later as a join table without changing anything here.
create table users (
    id            bigint generated always as identity primary key,
    company_id    bigint not null references companies (id) on delete cascade,

    -- Stored lowercased by the application; the constraint stops a future
    -- caller from creating 'Sam@x.com' alongside 'sam@x.com' and splitting one
    -- person into two accounts that cannot see each other's uploads.
    email         text not null unique check (email = lower(email) and email like '%@%'),

    -- `scrypt$N$r$p$salt$hash`. The parameters live in the string so the cost
    -- can be raised later without invalidating existing hashes.
    password_hash text not null,

    display_name  text not null,

    -- 'owner' is whoever signed the company up; 'member' is everyone invited
    -- after. Only owners may upload, because an upload replaces the company's
    -- entire dataset and that is not a thing a read-only viewer should be one
    -- misclick away from.
    role          text not null default 'member' check (role in ('owner', 'member')),

    created_at    timestamptz not null default now(),
    last_login_at timestamptz
);

create index users_company_idx on users (company_id);

-- Load audit. Uploads replace the company's data, so without this there is no
-- record of who loaded what. "Which upload produced last quarter's number" is a
-- question a compliance tool has to answer.
create table data_loads (
    id                  bigint generated always as identity primary key,
    company_id          bigint not null references companies (id) on delete cascade,

    -- Kept when the user is later removed: an audit row that forgets who acted
    -- is not an audit row. Hence `set null` rather than `cascade`.
    uploaded_by_user_id bigint references users (id) on delete set null,
    uploaded_by_email   text,

    source              text not null check (source in ('upload', 'cli')),

    -- What arrived, per file: original filename, byte size, rows parsed.
    files               jsonb not null default '[]'::jsonb,

    -- What came out: row counts per table, plus the data-quality tally.
    row_counts          jsonb not null default '{}'::jsonb,
    issue_count         integer not null default 0,
    error_count         integer not null default 0,

    status              text not null default 'succeeded'
                        check (status in ('succeeded', 'failed')),
    failure_reason      text,

    started_at          timestamptz not null default now(),
    finished_at         timestamptz,

    constraint data_loads_failure_has_reason check (
        status <> 'failed' or failure_reason is not null
    )
);

create index data_loads_company_idx on data_loads (company_id, started_at desc);

-- The demo tenant. Password `demo1234`, hashed with the same function the API
-- uses. A committed credential is normally a finding; it is acceptable here
-- because it opens a fictional mine's data in a local container, and seeding it
-- from a migration keeps it visible rather than hidden in a fixture.
insert into companies (slug, name, abn)
values ('ironbark-ridge', 'Ironbark Ridge Resources', null);

insert into users (company_id, email, password_hash, display_name, role)
select
    c.id,
    'demo@ironbarkridge.com.au',
    'scrypt$32768$8$1$jfZTqSqZDHwtf1OCzTzduw==$wh1ZA/U+tCX0MHH3gy57gR014X/cTDqHgVwnM3Kgh3g3vRySvACWQfsuivqk/Kj3hwx4FvB5gNF6NyhT4OIONQ==',
    'Demo Sustainability Lead',
    'owner'
from companies c
where c.slug = 'ironbark-ridge';

-- Site areas: the one piece of reference data that is not global. Rows 1-6 are
-- the shared taxonomy (company_id null); anything else came from one client's
-- export and must not appear in another client's dropdowns.
--
-- Two partial indexes rather than one composite, because unique (company_id,
-- name) treats NULL as distinct from itself and would allow duplicates in the
-- global set.
alter table site_areas
    add column company_id bigint references companies (id) on delete cascade;

alter table site_areas drop constraint site_areas_name_key;

create unique index site_areas_global_name_idx
    on site_areas (name) where company_id is null;

create unique index site_areas_company_name_idx
    on site_areas (company_id, name) where company_id is not null;

-- Fact tables: added nullable, backfilled, then made NOT NULL. A column default
-- would be a trap, since the next insert without an explicit company_id would
-- silently join the demo tenant.

alter table fuel_deliveries      add column company_id bigint references companies (id) on delete cascade;
alter table electricity_readings add column company_id bigint references companies (id) on delete cascade;
alter table meters               add column company_id bigint references companies (id) on delete cascade;
alter table incidents            add column company_id bigint references companies (id) on delete cascade;
alter table suppliers            add column company_id bigint references companies (id) on delete cascade;
alter table data_quality_issues  add column company_id bigint references companies (id) on delete cascade;
alter table ai_incident_findings add column company_id bigint references companies (id) on delete cascade;

update fuel_deliveries      set company_id = (select id from companies where slug = 'ironbark-ridge');
update electricity_readings set company_id = (select id from companies where slug = 'ironbark-ridge');
update meters               set company_id = (select id from companies where slug = 'ironbark-ridge');
update incidents            set company_id = (select id from companies where slug = 'ironbark-ridge');
update suppliers            set company_id = (select id from companies where slug = 'ironbark-ridge');
update data_quality_issues  set company_id = (select id from companies where slug = 'ironbark-ridge');
update ai_incident_findings set company_id = (select id from companies where slug = 'ironbark-ridge');

-- Site areas discovered by a previous load (category 'unknown') belong to the
-- demo tenant; the six seeded ones stay global.
update site_areas
   set company_id = (select id from companies where slug = 'ironbark-ridge')
 where category = 'unknown';

alter table fuel_deliveries      alter column company_id set not null;
alter table electricity_readings alter column company_id set not null;
alter table meters               alter column company_id set not null;
alter table incidents            alter column company_id set not null;
alter table suppliers            alter column company_id set not null;
alter table data_quality_issues  alter column company_id set not null;
alter table ai_incident_findings alter column company_id set not null;

-- Re-scope the identity constraints. Business keys like INC-2025-001 are the
-- client's, and two clients will collide on them. The primary key becomes
-- (company_id, key), so a lookup without a company is not a lookup at all.

-- meters -> electricity_readings
alter table electricity_readings drop constraint electricity_readings_meter_id_fkey;
alter table electricity_readings drop constraint electricity_readings_meter_period_key;
alter table meters drop constraint meters_pkey;
alter table meters add primary key (company_id, meter_id);
alter table electricity_readings
    add constraint electricity_readings_meter_fkey
    foreign key (company_id, meter_id) references meters (company_id, meter_id) on delete cascade;
alter table electricity_readings
    add constraint electricity_readings_meter_period_key unique (company_id, meter_id, period);

-- incidents -> ai_incident_findings
alter table ai_incident_findings drop constraint ai_incident_findings_incident_id_fkey;
alter table ai_incident_findings drop constraint ai_incident_findings_unique_run;
alter table incidents drop constraint incidents_pkey;
alter table incidents add primary key (company_id, id);
alter table ai_incident_findings
    add constraint ai_incident_findings_incident_fkey
    foreign key (company_id, incident_id) references incidents (company_id, id) on delete cascade;
alter table ai_incident_findings
    add constraint ai_incident_findings_unique_run
    unique (company_id, incident_id, model, prompt_version);

-- fuel invoice numbers
alter table fuel_deliveries drop constraint fuel_deliveries_invoice_no_key;
alter table fuel_deliveries add constraint fuel_deliveries_invoice_no_key unique (company_id, invoice_no);

-- Grounding trigger, re-scoped. Looking an incident up by id alone would now
-- find another company's incident with the same id and validate the quote
-- against the wrong text.
create or replace function assert_ai_finding_is_grounded() returns trigger
language plpgsql
as $$
declare
    source_description text;
begin
    select description into source_description
    from incidents
    where id = new.incident_id
      and company_id = new.company_id;

    if source_description is null then
        raise exception 'AI finding cites unknown incident % for company %',
            new.incident_id, new.company_id;
    end if;

    if length(btrim(new.evidence_quote)) = 0 then
        raise exception 'AI finding for % has an empty evidence quote', new.incident_id;
    end if;

    if position(new.evidence_quote in source_description) = 0 then
        raise exception
            'AI finding for % is not grounded: evidence quote does not appear in the source description',
            new.incident_id
            using hint = 'Every AI-generated finding must be traceable to the record it came from.',
                  detail = format('quote: %L', new.evidence_quote);
    end if;

    return new;
end;
$$;

-- Tenant-first indexes. Every analytical query begins `where company_id = $1`,
-- so a single-column index on the date finds every tenant's March and discards
-- all but one.
drop index fuel_deliveries_delivery_date_idx;
drop index electricity_readings_period_idx;
drop index incidents_date_idx;
drop index data_quality_issues_source_idx;

create index fuel_deliveries_company_date_idx      on fuel_deliveries (company_id, delivery_date);
create index electricity_readings_company_period_idx on electricity_readings (company_id, period);
create index incidents_company_date_idx            on incidents (company_id, incident_date);
create index data_quality_issues_company_source_idx on data_quality_issues (company_id, source_file, source_row_number);
create index suppliers_company_idx                 on suppliers (company_id);
create index ai_incident_findings_company_idx      on ai_incident_findings (company_id, incident_id);
