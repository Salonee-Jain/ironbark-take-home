import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { BatchResponseSchema } from '../schema.js';
import type {
  AiProvider,
  ChatTurn,
  CompletionResult,
  Rates,
} from './types.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.5';

/**
 * Reasoning models bill their internal reasoning against the output budget, so
 * the ceiling is well above the ~2k tokens a batch of findings actually needs.
 * A truncated batch is reported as a hard error rather than silently short.
 */
const MAX_OUTPUT_TOKENS = 32_000;

/**
 * No rate table.
 *
 * The Anthropic side has one because this project pins a default model there
 * and the rates were checked. Hard-coding OpenAI rates that nobody verified
 * would produce a confident dollar figure with nothing behind it, which is
 * exactly the failure mode the rest of this pipeline exists to prevent. Set
 * OPENAI_PRICE_PER_MTOK="<input>,<output>" to get an estimate; without it the
 * run reports token counts and declines to guess at the cost.
 */
function ratesFromEnv(): Rates | null {
  const raw = process.env['OPENAI_PRICE_PER_MTOK']?.trim();
  if (!raw) return null;

  const [input, output] = raw.split(',').map((part) => Number(part.trim()));
  if (!Number.isFinite(input) || !Number.isFinite(output)) {
    throw new Error(
      `OPENAI_PRICE_PER_MTOK must be two numbers, "<input>,<output>" — got "${raw}".`,
    );
  }
  return { input: input as number, output: output as number };
}

export function createOpenAiProvider(model: string): AiProvider {
  const client = new OpenAI();
  const rates = ratesFromEnv();

  // Only sent when set: passing a reasoning block to a non-reasoning model is
  // an error, and the server default is the right answer for most models.
  const effort = process.env['OPENAI_REASONING_EFFORT']?.trim();

  return {
    name: 'openai',
    model,

    async classify(system: string, turns: ChatTurn[]): Promise<CompletionResult> {
      const response = await client.responses.parse({
        model,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        instructions: system,
        input: turns,
        text: {
          format: zodTextFormat(BatchResponseSchema, 'incident_findings'),
        },
        ...(effort
          ? { reasoning: { effort: effort as 'low' | 'medium' | 'high' } }
          : {}),
      });

      return {
        parsed: response.output_parsed ?? null,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        stopReason: response.incomplete_details?.reason ?? response.status ?? null,
      };
    },

    estimateCostUsd(inputTokens, outputTokens) {
      if (!rates) return null;
      return (
        (inputTokens / 1_000_000) * rates.input +
        (outputTokens / 1_000_000) * rates.output
      );
    },
  };
}
