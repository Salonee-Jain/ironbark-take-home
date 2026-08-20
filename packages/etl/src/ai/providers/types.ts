import type { BatchResponse } from '../schema.js';

/**
 * The seam between the classifier and whichever model vendor is configured.
 *
 * The classifier owns everything that makes the output trustworthy — the
 * prompt, the batch size, the grounding gate, the corrective round. A provider
 * owns only the wire call. That split is the point: swapping vendors must not
 * be able to change what counts as an acceptable finding, because the gate is
 * the compliance guarantee and it lives on this side of the seam.
 */

export const PROVIDER_NAMES = ['anthropic', 'openai'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/**
 * A conversation turn. Deliberately narrower than either vendor's message
 * type — plain text, two roles — because that is all the classifier needs and
 * anything wider would leak vendor shape into the caller.
 */
export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type CompletionResult = {
  /** null when the model returned nothing that matched the schema. */
  parsed: BatchResponse | null;
  inputTokens: number;
  outputTokens: number;
  /** Vendor's own words for why generation stopped, for the error message. */
  stopReason: string | null;
};

export type AiProvider = {
  readonly name: ProviderName;
  readonly model: string;
  /** Sends one batch. `system` is passed separately because both vendors treat it separately. */
  classify(system: string, turns: ChatTurn[]): Promise<CompletionResult>;
  /**
   * Estimated spend, or null when no published rate is on file for this model.
   *
   * Null rather than zero: a run that silently reports $0.000 because the rate
   * table is stale reads as free, which is the one wrong answer.
   */
  estimateCostUsd(inputTokens: number, outputTokens: number): number | null;
};

export type Rates = { input: number; output: number };

/** Per-million-token rates → dollars, or null if the model is not in the table. */
export function priceFrom(
  table: Record<string, Rates>,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const rates = table[model];
  if (!rates) return null;
  return (
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output
  );
}
