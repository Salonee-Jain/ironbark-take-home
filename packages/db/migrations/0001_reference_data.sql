-- Reference dimensions.
--
-- These are seeded here rather than discovered by the ETL so that unexpected
-- values in the source data are a *detectable event*: the loader raises a
-- data-quality issue when it meets a site area or incident code that is not in
-- these tables, instead of silently widening the taxonomy.

-- Site areas. `Site Area` in the fuel file and `location` in the incident
-- register draw on the same vocabulary, which is what makes cross-dataset
-- analysis possible. It is not clean: two of the six values are fleets rather
-- than places, so `category` lets the UI group honestly.
create table site_areas (
    id       integer generated always as identity primary key,
    name     text not null unique,
    category text not null check (category in ('pit', 'fixed_plant', 'fleet', 'services', 'unknown')),
    notes    text
);

insert into site_areas (name, category, notes) values
    ('Open Cut - North Pit', 'pit',         null),
    ('Open Cut - South Pit', 'pit',         null),
    ('Processing Plant',     'fixed_plant', null),
    ('Site Services',        'services',    null),
    ('Haul Fleet',           'fleet',       'A fleet, not a geographic area. The source column mixes the two.'),
    ('Light Vehicles',       'fleet',       'A fleet, not a geographic area. The source column mixes the two.');

-- Incident type codes. The register ships bare three-letter codes with no code
-- table, so these labels are inferred from the descriptions filed under each and
-- marked as such: a reviewer should see which parts are the client's and which
-- are our reading.
create table incident_types (
    code        text primary key,
    label       text not null,
    is_inferred boolean not null default true,
    notes       text
);

insert into incident_types (code, label, notes) values
    ('DUS', 'Dust & air quality',           'Crusher dust exceedances, respiratory irritation.'),
    ('VEH', 'Vehicle & mobile equipment',   'Haul truck and light vehicle interactions, speeding, tyre failures.'),
    ('EQP', 'Equipment & plant',            'Plant failures, hydraulic releases, dropped objects.'),
    ('SLP', 'Slip, trip & fall',            'Also carries at least one fall-from-height that arguably belongs elsewhere.'),
    ('ENV', 'Environmental',                'Hydrocarbon sheens, sediment dam exceedances.'),
    ('ELE', 'Electrical & power',           'Only used once, for the March 2026 substation failure.'),
    ('OTH', 'Other / uncategorised',        'The register''s catch-all. Every psychosocial hazard is hidden in here.');

-- ---------------------------------------------------------------------------
-- Meters
-- ---------------------------------------------------------------------------
create table meters (
    meter_id     text primary key,
    description  text not null,
    first_period date,
    last_period  date
);

-- Emission factors, loaded from emission_factors.csv, which the brief says to
-- trust as-is. `factor_key` is ours: the source identifies an activity by a prose
-- string, and joining fact tables on prose is fragile.
--
-- Worth stating: real NGER factors are scoped to a financial year and this file
-- carries no validity period, so one factor is applied across all 18 months.
create table emission_factors (
    factor_key       text primary key,
    activity         text not null unique,
    scope            smallint not null check (scope in (1, 2)),
    unit             text not null,
    kg_co2e_per_unit numeric(10, 4) not null check (kg_co2e_per_unit > 0),
    source           text
);
