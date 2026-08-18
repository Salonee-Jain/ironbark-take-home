-- Fact tables.
--
-- Design rule applied throughout: **every normalised value keeps the raw string
-- it came from**. `quantity_l` sits next to `original_quantity` and
-- `original_unit`; `delivery_date` next to `original_date`. This costs a little
-- storage and buys the thing the brief actually asks for — any number in the UI
-- can be walked back to the exact cell in the client's export. Corrections that
-- erase their own evidence are not auditable.

-- ---------------------------------------------------------------------------
-- Fuel deliveries
-- ---------------------------------------------------------------------------
create table fuel_deliveries (
    id                bigint generated always as identity primary key,
    invoice_no        text not null,
    delivery_date     date not null,

    -- 29 of 150 rows are dated 'Mon-YY' with no day. Those are anchored to the
    -- first of the month and marked 'month'. Monthly aggregates stay correct;
    -- anything day-level must exclude them, and can now tell which they are.
    date_precision    text not null check (date_precision in ('day', 'month')),

    fuel_type         text not null,
    factor_key        text not null references emission_factors (factor_key),

    -- Always litres. The source uses L, litres, Litres and kL interchangeably.
    quantity_l        numeric(14, 2) not null,
    cost_aud          numeric(14, 2),
    site_area_id      integer references site_areas (id),

    -- One row (INV-41777) is a negative quantity with an out-of-sequence
    -- invoice number: a credit note, not corruption. It is loaded and nets off
    -- the totals rather than being dropped, and is flagged for the client.
    is_credit_note    boolean not null default false,

    -- Audit trail back to the raw cells.
    original_date     text not null,
    original_quantity text not null,
    original_unit     text not null,
    original_cost     text,

    source_file       text not null default 'fuel_deliveries.csv',
    source_row_number integer not null,
    loaded_at         timestamptz not null default now(),

    -- The source contains 7 duplicated invoice numbers, each an exact repeat of
    -- another row. The loader keeps the first and rejects the copy, so by the
    -- time data lands here invoice numbers are unique. Stating that as a
    -- constraint means a regression in the dedup logic fails loudly at load
    -- time instead of quietly inflating Scope 1.
    constraint fuel_deliveries_invoice_no_key unique (invoice_no),

    -- Sign and credit-note flag must agree, in both directions.
    constraint fuel_deliveries_credit_note_sign check (
        (is_credit_note and quantity_l < 0) or (not is_credit_note and quantity_l > 0)
    )
);

create index fuel_deliveries_delivery_date_idx on fuel_deliveries (delivery_date);
create index fuel_deliveries_site_area_idx     on fuel_deliveries (site_area_id);
create index fuel_deliveries_source_row_idx    on fuel_deliveries (source_row_number);

-- ---------------------------------------------------------------------------
-- Electricity meter readings
-- ---------------------------------------------------------------------------
create table electricity_readings (
    id                     bigint generated always as identity primary key,
    meter_id               text not null references meters (meter_id),
    period                 date not null,

    consumption_kwh        numeric(14, 2) not null check (consumption_kwh >= 0),

    -- MTR-07 drops by a factor of 1000 from 2025-10 onward — readings taken in
    -- MWh but labelled kWh. Those nine rows are multiplied back up, and the
    -- factor applied is recorded per row so the correction is visible rather
    -- than assumed. Left uncorrected it under-reports Scope 2 for half the
    -- reporting period.
    original_consumption   numeric(14, 2) not null,
    original_unit          text not null,
    unit_correction_factor numeric(10, 4) not null default 1,

    source_file            text not null default 'electricity_meter_readings.csv',
    source_row_number      integer not null,
    loaded_at              timestamptz not null default now(),

    constraint electricity_readings_meter_period_key unique (meter_id, period),

    -- Monthly data: always anchored to the first of the month.
    constraint electricity_readings_period_is_month_start check (
        period = date_trunc('month', period)::date
    )
);

create index electricity_readings_period_idx on electricity_readings (period);

-- ---------------------------------------------------------------------------
-- Incidents
-- ---------------------------------------------------------------------------
create table incidents (
    id                 text primary key,

    -- INC-2025-011 is used for two genuinely different incidents on different
    -- dates. Neither can be thrown away, and neither can keep an ID that no
    -- longer identifies anything, so `id` is a surrogate (the second gets a
    -- suffix) and the register's own ID is preserved here unmodified.
    source_incident_id text not null,

    incident_date      date not null,
    site_area_id       integer references site_areas (id),
    location_raw       text not null,
    type_code          text references incident_types (code),

    -- The register mixes two severity scales: Low/Medium and 1/2/3. Both are
    -- kept — `severity` for arithmetic, `severity_raw` because a reviewer
    -- needs to see that the client was recording two different things.
    severity           smallint check (severity between 1 and 3),
    severity_raw       text not null,

    description        text not null,
    source_row_number  integer not null,
    loaded_at          timestamptz not null default now()
);

create index incidents_date_idx      on incidents (incident_date);
create index incidents_type_idx      on incidents (type_code);
create index incidents_site_area_idx on incidents (site_area_id);

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
create table suppliers (
    id                 integer generated always as identity primary key,
    supplier_name      text not null,
    name_canonical     text not null,

    abn_raw            text,
    abn                text,  -- digits only, null when absent or unparseable
    abn_valid          boolean not null default false,

    category           text,
    category_canonical text,
    fy_spend_aud       numeric(14, 2) not null,

    -- Two entities appear twice: once as a spelling variant ('Maintanence',
    -- 'P/L'). The duplicate row is kept and pointed at its primary rather than
    -- merged away, because the client's own ledger has both and reconciling
    -- against it later requires seeing both.
    duplicate_of_id    integer references suppliers (id),

    source_row_number  integer not null,
    loaded_at          timestamptz not null default now(),

    constraint suppliers_no_self_duplicate check (duplicate_of_id is null or duplicate_of_id <> id)
);

create index suppliers_duplicate_of_idx on suppliers (duplicate_of_id);
