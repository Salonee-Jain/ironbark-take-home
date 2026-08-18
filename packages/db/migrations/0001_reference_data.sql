-- Reference dimensions.
--
-- These are seeded here rather than discovered by the ETL so that unexpected
-- values in the source data are a *detectable event*: the loader raises a
-- data-quality issue when it meets a site area or incident code that is not in
-- these tables, instead of silently widening the taxonomy.

-- ---------------------------------------------------------------------------
-- Site areas
--
-- `Site Area` in fuel_deliveries.csv and `location` in incident_register.csv
-- draw on the same vocabulary, which is what makes cross-dataset analysis
-- possible. The vocabulary is not clean: two of the six values are fleets
-- rather than places, so "where did this happen" and "which fleet burned this"
-- are conflated in one column. `category` lets the UI group honestly.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Incident type codes
--
-- The source register ships bare three-letter codes with no code table. These
-- labels are inferred from the free-text descriptions filed under each code and
-- are marked as such: a reviewer should be able to see which parts of this
-- schema are asserted by the client and which are our reading of the data.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Emission factors
--
-- Loaded from emission_factors.csv, which the brief says to trust as-is.
--
-- `factor_key` is ours: the source identifies an activity by a prose string
-- ('Diesel combustion (stationary & transport)'), and joining fact tables on
-- prose is fragile. The ETL maps each activity to a stable key.
--
-- Limitation worth stating: real NGER factors are scoped to a financial year,
-- and this file carries no validity period. A single factor is therefore
-- applied across all 18 months, which is fine for the exercise but would not
-- survive a real audit spanning a factor revision.
-- ---------------------------------------------------------------------------
create table emission_factors (
    factor_key       text primary key,
    activity         text not null unique,
    scope            smallint not null check (scope in (1, 2)),
    unit             text not null,
    kg_co2e_per_unit numeric(10, 4) not null check (kg_co2e_per_unit > 0),
    source           text
);
