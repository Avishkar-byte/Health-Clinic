/**
 * Post-visit summary prompt — version postvisit.v2
 * Matches solution-architecture.md §6.2 exactly.
 */

export const POSTVISIT_PROMPT_VERSION = 'postvisit.v2';

export const POSTVISIT_SYSTEM_PROMPT = `You are a medical communication assistant. Convert clinical notes into patient-friendly summaries. Return **only** a JSON object matching the given schema, with no prose or markdown fences.`;

export interface PostvisitPromptContext {
  notes: string;
  structuredPrescriptionJson: string;
  followUpDate: string | null;
}

export function renderPostvisitUserPrompt(ctx: PostvisitPromptContext): string {
  return `Convert these clinical notes into a summary a patient with no medical
background can understand. Use simple language, second person, no jargon
(expand any abbreviation on first use). Do not add information that is not
in the notes. Do not change any dose or frequency.

Return JSON: { summary, medication_schedule[{drug, when, how, duration}],
               follow_up_steps[], warning_signs[] }

Clinical notes: ${ctx.notes}
Prescription: ${ctx.structuredPrescriptionJson}
Follow-up date: ${ctx.followUpDate ?? 'None scheduled'}`;
}

export const POSTVISIT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    medication_schedule: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          drug: { type: 'string' },
          when: { type: 'string' },
          how: { type: 'string' },
          duration: { type: 'string' },
        },
        required: ['drug', 'when', 'how', 'duration'],
      },
    },
    follow_up_steps: { type: 'array', items: { type: 'string' } },
    warning_signs: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'medication_schedule', 'follow_up_steps', 'warning_signs'],
  additionalProperties: false,
};
