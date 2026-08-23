/**
 * Pre-visit triage prompt — version previsit.v2
 * Matches solution-architecture.md §6.2 exactly.
 */

export const PREVISIT_PROMPT_VERSION = 'previsit.v2';

export const PREVISIT_SYSTEM_PROMPT = `You are a clinical triage assistant supporting a licensed physician. You do not diagnose and you do not recommend treatment. Return **only** a JSON object matching the given schema, with no prose or markdown fences. If the symptom text is empty, nonsensical, or not medical in nature, return \`urgency: "low"\` and set \`chief_complaint\` to \`"insufficient information"\`.`;

export interface PrevisitPromptContext {
  age: number | string;
  sex: string;
  conditions: string;
  medications: string;
  durationDays: number | string;
  severity: number | string;
  symptoms: string;
}

export function renderPrevisitUserPrompt(ctx: PrevisitPromptContext): string {
  return `Analyse these symptoms and return:
  urgency  — one of "low" | "medium" | "high"
  chief_complaint — one sentence, max 15 words
  suggested_questions — exactly 3 questions the doctor should ask
  red_flags — array of concerning findings, empty if none

Patient context: age ${ctx.age}, sex ${ctx.sex},
  known conditions: ${ctx.conditions}, current medications: ${ctx.medications}
Duration: ${ctx.durationDays} days. Self-rated severity: ${ctx.severity}/10.
Symptoms: ${ctx.symptoms}`;
}

export const PREVISIT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
    chief_complaint: { type: 'string' },
    suggested_questions: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
    red_flags: { type: 'array', items: { type: 'string' } },
  },
  required: ['urgency', 'chief_complaint', 'suggested_questions', 'red_flags'],
  additionalProperties: false,
};
