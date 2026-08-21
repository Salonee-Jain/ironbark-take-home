import type { ZodType } from 'zod';

/**
 * The seam between the AI tasks and whichever model vendor is configured.
 *
 * A task owns everything that makes its output trustworthy — the prompt, the
 * batching, the verification gate, the corrective round. A provider owns only
 * the wire call. That split is the point: swapping vendors must not be able to
 * change what counts as an acceptable finding, because the gate is the
 * compliance guarantee and it lives on this side of the seam.
 *
 * There are two tasks now — incident classification and the cited compliance
 * summary — and the seam is generic in the output type rather than naming
 * either. A provider that knew about `BatchResponse`, as this one did while
 * classification was the only caller, would have to be edited once per task,
 * and each edit is a chance to let one task's schema reach the other's vendor
 * call.
 */

export const PROVIDER_NAMES = ['anthropic', 'openai'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/**
 * A conversation turn. Deliberately narrower than either vendor's message
 * type — plain text, two roles — because that is all the classifier needs and
 * anything wider would leak vendor shape into the caller.
 */
export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/**
 * The shape a task requires back.
 *
 * `name` is only a label for the vendor's structured-output slot; the schema is
 * what does the work. Both vendors enforce it server-side, so a malformed
 * response is impossible rather than merely unlikely.
 */
export type OutputFormat<T> = { name: string; schema: ZodType<T> };

export type CompletionResult<T> = {
  /** null when the model returned nothing that matched the schema. */
  parsed: T | null;
  inputTokens: number;
  outputTokens: number;
  /** Vendor's own words for why generation stopped, for the error message. */
  stopReason: string | null;
};

export type AiProvider = {
  readonly name: ProviderName;
  readonly model: string;
  /** Sends one request. `system` is passed separately because both vendors treat it separately. */
  complete<T>(
    system: string,
    turns: ChatTurn[],
    output: OutputFormat<T>,
  ): Promise<CompletionResult<T>>;
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
