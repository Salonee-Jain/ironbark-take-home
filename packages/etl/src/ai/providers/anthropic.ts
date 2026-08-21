import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  priceFrom,
  type AiProvider,
  type ChatTurn,
  type CompletionResult,
  type OutputFormat,
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

    async complete<T>(
      system: string,
      turns: ChatTurn[],
      output: OutputFormat<T>,
    ): Promise<CompletionResult<T>> {
      const response = await client.messages.parse({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: turns as Anthropic.MessageParam[],
        output_config: { format: zodOutputFormat(output.schema) },
      });

      return {
        // The helper infers its own output type from the schema it was handed;
        // narrowing that back to the caller's T is the one cast this seam needs,
        // and it is safe because the SDK validated the payload against exactly
        // that schema before returning it.
        parsed: (response.parsed_output ?? null) as T | null,
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
