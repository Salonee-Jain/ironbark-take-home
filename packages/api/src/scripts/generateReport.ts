/**
 * Compliance summary generator.
 *
 *   npm run ai:report                        generate for the demo tenant
 *   npm run ai:report -- --company=<slug>    another workspace
 *   npm run ai:report -- --provider=openai   choose the vendor for this run
 *
 * Runs the same service the API endpoint runs, then writes the result to
 * data/ai/compliance_summary.json so the application can serve it without a key.
 * Requires ANTHROPIC_API_KEY or OPENAI_API_KEY; nothing else in the project does.
 */
import { closePool, loadEnv } from '@ironbark/db';
import { writeReportCache } from '@ironbark/etl/ai/report';
import { providerFlag } from '@ironbark/etl/ai/providers';
import * as repository from '../repositories/reports.repository.js';
import { generateAndStore } from '../services/reports.service.js';

const DEMO_SLUG = 'ironbark-ridge';

function flag(name: string): string | undefined {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

async function main(): Promise<void> {
  loadEnv();

  const slug = flag('company') ?? DEMO_SLUG;
  const company = await repository.findCompanyIdBySlug(slug);
  if (!company) {
    throw new Error(
      `No company with slug "${slug}". Run \`npm run etl\` to load the demo tenant.`,
    );
  }

  console.log(`\ncompany: ${company.name} (${slug})`);

  const { report } = await generateAndStore(
    company.id,
    { userId: null },
    { provider: providerFlag(process.argv) },
  );

  console.log(`provider: ${report.provider}, model: ${report.model}`);
  console.log(`facts in the pack:      ${report.facts.length}`);
  console.log(`claims accepted:        ${report.claimsAccepted}`);
  console.log(`claims rejected by the gate: ${report.claimsRejected}`);
  console.log(
    `tokens: ${report.usage.inputTokens} in / ${report.usage.outputTokens} out  ` +
      (report.usage.estimatedCostUsd === null
        ? '(no rate on file for this model)'
        : `(~$${report.usage.estimatedCostUsd.toFixed(3)})`),
  );

  if (report.rejected.length > 0) {
    console.log('\nrejected claims:');
    for (const rejection of report.rejected) {
      console.log(`  [round ${rejection.round}] ${rejection.reason}: ${rejection.detail}`);
      console.log(`      "${rejection.text}"`);
    }
  }

  for (const section of report.sections) {
    console.log(`\n${section.section}`);
    for (const claim of section.claims) {
      console.log(`  - ${claim.text}`);
      console.log(`      cites: ${claim.citations.join(', ')}`);
    }
  }

  writeReportCache({ ...report, generatedAt: new Date().toISOString() });
  console.log('\nWrote data/ai/compliance_summary.json');
  console.log('Stored in ai_compliance_reports for this company.\n');
}

try {
  await main();
} catch (error) {
  console.error(
    `\nReport generation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await closePool();
}
