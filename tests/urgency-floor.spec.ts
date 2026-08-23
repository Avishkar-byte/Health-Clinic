/**
 * urgency-floor.spec.ts
 *
 * Model returns "low" for "crushing chest pain" → stored urgency is "high".
 *
 * Tests the deterministic urgency floor from §6.3 and packages/prompts/urgency-rules.ts.
 * The LLM may raise urgency but never lower it below the floor.
 */
import { applyUrgencyFloor, checkUrgencyFloor } from '@healthcare/prompts';

describe('Urgency floor', () => {
  describe('keyword-based floor', () => {
    it('forces high urgency for "crushing chest pain" regardless of model output', () => {
      const result = applyUrgencyFloor('low', 'crushing chest pain for 30 minutes', 7);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
      expect(result.matchedRules).toContain('chest_pain');
    });

    it('forces high urgency for "shortness of breath"', () => {
      const result = applyUrgencyFloor('low', 'experiencing shortness of breath', 4);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
      expect(result.matchedRules).toContain('breathlessness');
    });

    it('forces high urgency for "severe bleeding"', () => {
      const result = applyUrgencyFloor('medium', 'uncontrolled bleeding from wound', 8);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
    });

    it('forces high urgency for "loss of consciousness"', () => {
      const result = applyUrgencyFloor('low', 'patient had loss of consciousness', 5);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
      expect(result.matchedRules).toContain('altered_consciousness');
    });

    it('forces high urgency for stroke signs (facial droop)', () => {
      const result = applyUrgencyFloor('low', 'sudden facial droop on left side', 7);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
      expect(result.matchedRules).toContain('stroke_signs');
    });

    it('forces high urgency for "slurred speech"', () => {
      const result = applyUrgencyFloor('medium', 'has slurred speech since this morning', 6);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
    });

    it('forces high urgency for "one-sided weakness"', () => {
      const result = applyUrgencyFloor('low', 'sudden one-sided weakness in right arm', 7);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
    });
  });

  describe('severity-based floor', () => {
    it('forces high urgency when severity >= 9', () => {
      const result = applyUrgencyFloor('low', 'mild stomach ache', 9);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
      expect(result.matchedRules).toContain('severity_threshold');
    });

    it('forces high urgency when severity is 10', () => {
      const result = applyUrgencyFloor('medium', 'general discomfort', 10);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
    });

    it('does NOT force high for severity 8', () => {
      const result = applyUrgencyFloor('low', 'headache', 8);
      expect(result.urgency).toBe('low');
      expect(result.floorApplied).toBe(false);
    });
  });

  describe('model can raise but not lower', () => {
    it('preserves model "high" even without floor trigger', () => {
      const result = applyUrgencyFloor('high', 'mild headache', 3);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(false);
    });

    it('preserves model "medium" when no floor triggers', () => {
      const result = applyUrgencyFloor('medium', 'stomach cramps', 5);
      expect(result.urgency).toBe('medium');
      expect(result.floorApplied).toBe(false);
    });

    it('preserves model "low" when no floor triggers', () => {
      const result = applyUrgencyFloor('low', 'runny nose for 2 days', 2);
      expect(result.urgency).toBe('low');
      expect(result.floorApplied).toBe(false);
    });
  });

  describe('case insensitivity', () => {
    it('matches "CHEST PAIN" (uppercase)', () => {
      const result = checkUrgencyFloor('SEVERE CHEST PAIN', null);
      expect(result.triggered).toBe(true);
    });

    it('matches "Shortness Of Breath" (mixed case)', () => {
      const result = checkUrgencyFloor('Shortness Of Breath', null);
      expect(result.triggered).toBe(true);
    });
  });

  describe('multiple triggers', () => {
    it('matches multiple rules simultaneously', () => {
      const result = checkUrgencyFloor(
        'chest pain with shortness of breath and facial droop',
        10,
      );
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('chest_pain');
      expect(result.matchedRules).toContain('breathlessness');
      expect(result.matchedRules).toContain('stroke_signs');
      expect(result.matchedRules).toContain('severity_threshold');
      expect(result.matchedRules.length).toBe(4);
    });
  });
});
