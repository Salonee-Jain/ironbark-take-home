-- AI compliance summaries, and the citation guarantee at the storage layer.
--
-- A generated narrative is a different kind of artefact from a classified
-- incident, and the difference decides the shape of this table. A finding cites
-- one record and can be re-verified against it any time, because the record is
-- still there. A summary cites *figures* — a total, a share, a count — and those
-- move every time the data is reloaded. Storing only the prose would leave a
-- paragraph of numbers with nothing to check them against a month later.
--
-- So the fact pack is stored with the report. `facts` is the closed set the
-- model was given, `fact_digest` fingerprints it, and together they make three
-- things possible that prose alone cannot:
--
--   1. the trigger below can enforce that every claim cites something real;
--   2. the API can re-verify every claim on read, against the facts as they are
--      *now*, and tell the reader which sentences no longer hold;
--   3. the committed artefact in data/ai/ can be offered to a dataset only when
--      that dataset reproduces the same digest, so one company can never be
--      shown another company's narrative over its own numbers.

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

-- ---------------------------------------------------------------------------
-- Citation enforcement
--
-- The application gate in packages/etl/src/ai/report/citations.ts does the real
-- work — it also checks the arithmetic of the prose, which SQL has no business
-- attempting. This trigger enforces the part that is a storage invariant: no
-- claim may be stored without a citation, and no citation may name a fact that
-- is not in the pack stored alongside it.
--
-- The same belt-and-braces as the grounding trigger on ai_incident_findings,
-- and for the same reason: "every AI claim is traceable" is a promise this
-- product makes, and a promise the database is willing to enforce survives a
-- future script, a manual insert, or a refactor that forgets the validator.
-- ---------------------------------------------------------------------------
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
