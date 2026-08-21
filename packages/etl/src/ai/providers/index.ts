import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './anthropic.js';
import { createOpenAiProvider, DEFAULT_OPENAI_MODEL } from './openai.js';
import { PROVIDER_NAMES, type AiProvider, type ProviderName } from './types.js';

export type {
  AiProvider,
  ChatTurn,
  CompletionResult,
  OutputFormat,
  ProviderName,
} from './types.js';
export { PROVIDER_NAMES } from './types.js';

type ProviderSpec = {
  keyVar: string;
  modelVar: string;
  defaultModel: string;
  create: (model: string) => AiProvider;
};

const SPECS: Record<ProviderName, ProviderSpec> = {
  anthropic: {
    keyVar: 'ANTHROPIC_API_KEY',
    modelVar: 'ANTHROPIC_MODEL',
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    create: createAnthropicProvider,
  },
  openai: {
    keyVar: 'OPENAI_API_KEY',
    modelVar: 'OPENAI_MODEL',
    defaultModel: DEFAULT_OPENAI_MODEL,
    create: createOpenAiProvider,
  },
};

function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * Chooses a provider from an explicit request, or from whichever key is present.
 *
 * Precedence: `--provider=` flag, then AI_PROVIDER, then autodetection. The
 * autodetect path exists so that dropping a single key into `.env` is the whole
 * setup; it refuses to choose when both keys are present, because picking one
 * silently would mean the model that produced a set of findings depended on
 * which key happened to be exported.
 *
 * @param requested value of a `--provider=` flag, if one was passed
 */
export function resolveProvider(requested?: string): AiProvider {
  const explicit = (requested ?? process.env['AI_PROVIDER'])?.trim().toLowerCase();
  const source = requested ? '--provider' : 'AI_PROVIDER';

  if (explicit) {
    if (!isProviderName(explicit)) {
      throw new Error(
        `${source}="${explicit}" is not a known provider. Use one of: ${PROVIDER_NAMES.join(', ')}.`,
      );
    }
    const spec = SPECS[explicit];
    if (!process.env[spec.keyVar]) {
      throw new Error(
        `${source}=${explicit} but ${spec.keyVar} is not set.\n` +
          `  Add it to .env, then re-run.`,
      );
    }
    return build(explicit, spec);
  }

  const available = PROVIDER_NAMES.filter((name) => process.env[SPECS[name].keyVar]);

  if (available.length === 0) {
    throw new Error(
      'No AI provider key is set.\n' +
        '  Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env, then re-run.\n' +
        '  The committed cache at data/ai/incident_findings.json means the rest\n' +
        '  of the application runs without either.',
    );
  }

  if (available.length > 1) {
    throw new Error(
      `Both ${available.map((n) => SPECS[n].keyVar).join(' and ')} are set.\n` +
        `  Choose one: AI_PROVIDER=anthropic|openai in .env, or pass --provider=openai.`,
    );
  }

  const name = available[0] as ProviderName;
  return build(name, SPECS[name]);
}

function build(name: ProviderName, spec: ProviderSpec): AiProvider {
  const model = process.env[spec.modelVar]?.trim() || spec.defaultModel;
  return spec.create(model);
}

/** Reads a `--provider=<name>` argument out of argv. */
export function providerFlag(argv: string[]): string | undefined {
  const flag = argv.find((arg) => arg.startsWith('--provider='));
  return flag?.slice('--provider='.length);
}
