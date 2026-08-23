/**
 * Deterministic urgency floor — keyword rule set.
 *
 * These rules force urgency='high' regardless of model output.
 * The LLM may raise urgency but never lower it below this floor.
 *
 * Rule set: chest pain, breathlessness, severe bleeding,
 * altered consciousness, one-sided weakness/facial droop/slurred speech,
 * severity >= 9
 */

export interface UrgencyRule {
  /** Human-readable name for this rule */
  name: string;
  /** Keywords/phrases that trigger this rule (matched case-insensitive) */
  keywords: string[];
  /** If true, match against severity score instead of text */
  severityThreshold?: number;
}

export const URGENCY_RULES: UrgencyRule[] = [
  {
    name: 'chest_pain',
    keywords: [
      'chest pain',
      'chest tightness',
      'crushing chest',
      'chest pressure',
      'angina',
      'heart attack',
      'myocardial infarction',
    ],
  },
  {
    name: 'breathlessness',
    keywords: [
      'breathlessness',
      'shortness of breath',
      'difficulty breathing',
      'can\'t breathe',
      'cannot breathe',
      'breathing difficulty',
      'dyspnea',
      'dyspnoea',
      'gasping',
      'respiratory distress',
    ],
  },
  {
    name: 'severe_bleeding',
    keywords: [
      'severe bleeding',
      'heavy bleeding',
      'uncontrolled bleeding',
      'hemorrhage',
      'haemorrhage',
      'profuse bleeding',
      'bleeding won\'t stop',
      'bleeding heavily',
    ],
  },
  {
    name: 'altered_consciousness',
    keywords: [
      'altered consciousness',
      'loss of consciousness',
      'unconscious',
      'unresponsive',
      'fainting',
      'fainted',
      'passed out',
      'confusion',
      'disoriented',
      'altered mental status',
      'delirium',
      'seizure',
      'convulsion',
    ],
  },
  {
    name: 'stroke_signs',
    keywords: [
      'one-sided weakness',
      'one sided weakness',
      'facial droop',
      'face drooping',
      'slurred speech',
      'speech difficulty',
      'sudden numbness',
      'sudden weakness one side',
      'stroke',
      'hemiplegia',
      'hemiparesis',
      'aphasia',
    ],
  },
];

export const SEVERITY_THRESHOLD = 9;

/**
 * Check if the symptom text or severity triggers the urgency floor.
 * Returns true if urgency must be forced to 'high'.
 */
export function checkUrgencyFloor(
  symptomText: string,
  severity?: number | null,
): { triggered: boolean; matchedRules: string[] } {
  const matchedRules: string[] = [];
  const lowerText = symptomText.toLowerCase();

  // Check keyword rules
  for (const rule of URGENCY_RULES) {
    for (const keyword of rule.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        matchedRules.push(rule.name);
        break; // one match per rule is enough
      }
    }
  }

  // Check severity threshold
  if (severity != null && severity >= SEVERITY_THRESHOLD) {
    matchedRules.push('severity_threshold');
  }

  return {
    triggered: matchedRules.length > 0,
    matchedRules,
  };
}

/**
 * Apply the urgency floor to a model-returned urgency.
 * The LLM may raise urgency but never lower it below the floor.
 */
export function applyUrgencyFloor(
  modelUrgency: 'low' | 'medium' | 'high',
  symptomText: string,
  severity?: number | null,
): { urgency: 'low' | 'medium' | 'high'; floorApplied: boolean; matchedRules: string[] } {
  const { triggered, matchedRules } = checkUrgencyFloor(symptomText, severity);

  if (triggered && modelUrgency !== 'high') {
    return { urgency: 'high', floorApplied: true, matchedRules };
  }

  return { urgency: modelUrgency, floorApplied: false, matchedRules };
}
