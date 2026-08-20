import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BatchResponseSchema } from '../schema.js';
import {
  priceFrom,
  type AiProvider,
  type ChatTurn,
  type CompletionResult,
  type Rates,
} from './types.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

/** Per-million-token rates, for the cost report. */
const PRICING_USD_PER_MTOK: Record<string, Rates> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

const MAX_TOKENS = 16_000;

export function createAnthropicProvider(model: string): AiProvider {
  const client = new Anthropic();

  return {
    name: 'anthropic',
    model,

    async classify(system: string, turns: ChatTurn[]): Promise<CompletionResult> {
      const response = await client.messages.parse({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: turns as Anthropic.MessageParam[],
        output_config: { format: zodOutputFormat(BatchResponseSchema) },
      });

      return {
        parsed: response.parsed_output ?? null,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
      };
    },

    estimateCostUsd(inputTokens, outputTokens) {
      return priceFrom(PRICING_USD_PER_MTOK, model, inputTokens, outputTokens);
    },
  };
}
