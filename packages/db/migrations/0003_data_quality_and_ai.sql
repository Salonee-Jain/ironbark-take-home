-- Data quality and AI findings.
--
-- This is the spine of the project. The brief says "do not silently discard
-- problems", so nothing is dropped without leaving a row here explaining what
-- was wrong, what we did, and what the value used to be.

-- Rule catalogue. The rules live in TypeScript and are upserted here by the ETL,
-- so the API can serve the justification alongside each issue: a user looking at
-- a corrected number needs to know why we felt entitled to correct it.
create table data_quality_rules (
    rule_id          text primary key,
    title            text not null,
    source_file      text not null,
    category         text not null,
    default_severity text not null check (default_severity in ('error', 'warning', 'info')),
    default_action   text not null check (default_action in ('fixed', 'flagged', 'rejected')),
    rationale        text not null
);

-- Issues: one row per problem per source record. `action` carries the editorial
-- decision. fixed means corrected in flight with the original kept. flagged means
-- loaded as-is and surfaced for a human, wherever a correction would be a guess.
-- rejected means excluded from the fact tables but recorded here in full, so
-- "rejected" never means "vanished".
create table data_quality_issues (
    id                bigint generated always as identity primary key,
    rule_id           text not null references data_quality_rules (rule_id),

    source_file       text not null,
    source_row_number integer,

    -- Business key of the offending record (invoice no, incident id, meter id)
    -- so an issue can be shown next to the record without a row-number join.
    record_key        text,
    field             text,

    severity          text not null check (severity in ('error', 'warning', 'info')),
    action            text not null check (action in ('fixed', 'flagged', 'rejected')),

    description       text not null,
    original_value    text,
    resolved_value    text,

    detected_at       timestamptz not null default now(),

    -- A 'fixed' issue that cannot say what it changed the value to is not
    -- auditable, and is almost always a bug in the rule.
    constraint data_quality_issues_fixed_has_resolution check (
        action <> 'fixed' or resolved_value is not null
    )
);

create index data_quality_issues_rule_idx     on data_quality_issues (rule_id);
create index data_quality_issues_source_idx   on data_quality_issues (source_file, source_row_number);
create index data_quality_issues_severity_idx on data_quality_issues (severity);
create index data_quality_issues_action_idx   on data_quality_issues (action);

-- ---------------------------------------------------------------------------
-- AI incident findings
--
-- Every finding must quote the span of the source description it was drawn
-- from. That quote is not decoration, see the trigger below.
-- ---------------------------------------------------------------------------
create table ai_incident_findings (
    id                  bigint generated always as identity primary key,
    incident_id         text not null references incidents (id) on delete cascade,

    category            text not null,
    is_psychosocial     boolean not null default false,

    -- What the model thinks the severity should be, versus what was recorded.
    severity_assessment smallint check (severity_assessment between 1 and 3),
    severity_mismatch   boolean not null default false,

    confidence          numeric(3, 2) check (confidence between 0 and 1),

    evidence_quote      text not null,
    rationale           text not null,

    model               text not null,
    prompt_version      text not null,
    created_at          timestamptz not null default now(),

    constraint ai_incident_findings_unique_run unique (incident_id, model, prompt_version)
);

create index ai_incident_findings_incident_idx     on ai_incident_findings (incident_id);
create index ai_incident_findings_psychosocial_idx on ai_incident_findings (is_psychosocial) where is_psychosocial;
create index ai_incident_findings_mismatch_idx     on ai_incident_findings (severity_mismatch) where severity_mismatch;

-- Grounding enforcement. The application validates that every evidence_quote
-- appears verbatim in the incident it cites, and this says the same thing at the
-- storage layer, against a future script or a careless manual insert. A CHECK
-- constraint cannot reference another table, so it has to be a trigger.
create function assert_ai_finding_is_grounded() returns trigger
language plpgsql
as $$
declare
    source_description text;
begin
    select description into source_description
    from incidents
    where id = new.incident_id;

    if source_description is null then
        raise exception 'AI finding cites unknown incident %', new.incident_id;
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

create trigger ai_incident_findings_grounded
    before insert or update on ai_incident_findings
    for each row
    execute function assert_ai_finding_is_grounded();
