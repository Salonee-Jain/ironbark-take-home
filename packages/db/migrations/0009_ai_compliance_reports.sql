-- AI compliance summaries, and the citation guarantee at the storage layer.
--
-- A finding cites one record and can be re-verified against it any time. A
-- summary cites figures, and those move every time the data is reloaded, so
-- storing the prose alone would leave a paragraph of numbers with nothing to
-- check them against a month later.
--
-- The fact pack is therefore stored with the report. `facts` is the closed set
-- the model was given and `fact_digest` fingerprints it, which is what lets the
-- trigger below check every citation, lets the API re-verify claims on read
-- against current figures, and lets the committed artefact be offered only to a
-- dataset that reproduces the same digest.

create table ai_compliance_reports (
    id                   bigint generated always as identity primary key,
    company_id           bigint not null references companies (id) on delete cascade,

    -- 'YYYY-MM'. The reporting period the summary describes, which is the whole
    -- loaded export rather than a user-chosen window: a compliance summary of an
    -- arbitrary slice is a different document with different caveats.
    period_from          text not null check (period_from ~ '^\d{4}-\d{2}$'),
    period_to            text not null check (period_to ~ '^\d{4}-\d{2}$'),

    facts                jsonb not null,
    fact_digest          text not null,

    -- [{ section, claims: [{ text, citations: [factId] }] }]
    sections             jsonb not null,

    -- What the citation gate threw away, with the reason. Kept for the same
    -- reason the findings cache keeps its rejections: a run that discarded a
    -- third of its output and does not say so is reporting a cleaner process
    -- than the one that actually happened.
    rejected             jsonb not null default '[]'::jsonb,

    claims_accepted      integer not null check (claims_accepted >= 0),
    claims_rejected      integer not null check (claims_rejected >= 0),

    provider             text not null,
    model                text not null,
    prompt_version       text not null,
    token_usage          jsonb not null default '{}'::jsonb,

    -- Kept when the user is removed: an audit row that forgets who spent the
    -- money and published the claim is not an audit row.
    generated_by_user_id bigint references users (id) on delete set null,
    generated_at         timestamptz not null default now(),

    -- One report per company per model, prompt version and fact pack.
    -- Regenerating against unchanged data and an unchanged prompt replaces the
    -- row rather than accumulating near-identical narratives; change any of the
    -- three and it is a genuinely different document that deserves its own row.
    constraint ai_compliance_reports_unique_run
        unique (company_id, model, prompt_version, fact_digest)
);

create index ai_compliance_reports_company_idx
    on ai_compliance_reports (company_id, generated_at desc);

-- Citation enforcement. The application gate does the real work, including
-- checking the arithmetic of the prose, which SQL has no business attempting.
-- This enforces the part that is a storage invariant: no claim without a
-- citation, and no citation naming a fact absent from the pack stored with it.
-- The same belt and braces as the grounding trigger on ai_incident_findings.
create function assert_report_claims_are_cited() returns trigger
language plpgsql
as $$
declare
    fact_ids  text[];
    section   jsonb;
    claim     jsonb;
    citation  text;
begin
    select coalesce(array_agg(fact ->> 'id'), '{}')
      into fact_ids
      from jsonb_array_elements(new.facts) as fact;

    if array_length(fact_ids, 1) is null then
        raise exception 'Compliance report stores no facts, so none of its claims can be checked';
    end if;

    for section in select * from jsonb_array_elements(new.sections)
    loop
        for claim in select * from jsonb_array_elements(section -> 'claims')
        loop
            if jsonb_array_length(coalesce(claim -> 'citations', '[]'::jsonb)) = 0 then
                raise exception 'Compliance claim has no citations: %', claim ->> 'text'
                    using hint = 'Every claim in a generated summary must cite the facts it rests on.';
            end if;

            for citation in
                select value #>> '{}' from jsonb_array_elements(claim -> 'citations')
            loop
                if not (citation = any (fact_ids)) then
                    raise exception 'Compliance claim cites unknown fact %', citation
                        using hint = 'Citations must name a fact in the pack stored with the report.',
                              detail = format('claim: %L', claim ->> 'text');
                end if;
            end loop;
        end loop;
    end loop;

    return new;
end;
$$;

create trigger ai_compliance_reports_cited
    before insert or update on ai_compliance_reports
    for each row
    execute function assert_report_claims_are_cited();
