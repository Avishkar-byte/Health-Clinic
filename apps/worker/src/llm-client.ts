import OpenAI from 'openai';

/**
 * Both Groq and Gemini expose OpenAI-compatible chat completion endpoints,
 * so provider selection is just a baseURL/apiKey/model swap — no processor
 * code needs to change.
 *
 * Provider is explicit via LLM_PROVIDER, or inferred: GEMINI_API_KEY present
 * → gemini, otherwise groq (preserves existing behaviour when unset).
 */
export interface LlmClient {
  client: OpenAI;
  model: string;
  provider: string;
  /** Extra per-request params to spread into every chat.completions.create() call. */
  extraParams: Record<string, unknown>;
}

export function createLlmClient(): LlmClient {
  const provider = (
    process.env.LLM_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'groq')
  ).toLowerCase();

  if (provider === 'gemini') {
    return {
      provider,
      client: new OpenAI({
        apiKey: process.env.GEMINI_API_KEY || '',
        baseURL:
          process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
      }),
      // gemini-2.0-flash was retired by Google; gemini-3.6-flash is its
      // suggested replacement and verified to work well for this workload.
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      // Gemini 3.x models "think" before answering, and those hidden
      // reasoning tokens are drawn from the same max_tokens budget as the
      // visible output — at the default effort they can consume the whole
      // budget and truncate the JSON response before it's emitted (seen
      // directly: finish_reason "length" with valid-looking but cut-off
      // content). Low effort leaves enough budget for the actual answer.
      extraParams: { reasoning_effort: 'low' },
    };
  }

  return {
    provider: 'groq',
    client: new OpenAI({
      apiKey: process.env.GROQ_API_KEY || '',
      baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    }),
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    extraParams: {},
  };
}
