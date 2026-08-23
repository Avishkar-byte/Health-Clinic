import { describe, it, expect } from 'vitest';
import {
  checkUrgencyFloor,
  applyUrgencyFloor,
  URGENCY_RULES,
  SEVERITY_THRESHOLD,
} from '../src/urgency-rules';

describe('urgency-rules', () => {
  describe('checkUrgencyFloor', () => {
    it('triggers on "chest pain"', () => {
      const result = checkUrgencyFloor('I have severe chest pain', null);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('chest_pain');
    });

    it('triggers on "crushing chest"', () => {
      const result = checkUrgencyFloor('crushing chest pressure for 2 hours', null);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('chest_pain');
    });

    it('triggers on "shortness of breath"', () => {
      const result = checkUrgencyFloor('experiencing shortness of breath', null);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('breathlessness');
    });

    it('triggers on "severe bleeding"', () => {
      const result = checkUrgencyFloor('severe bleeding from wound', null);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('severe_bleeding');
    });

    it('triggers on "loss of consciousness"', () => {
      const result = checkUrgencyFloor('experienced loss of consciousness', null);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('altered_consciousness');
    });

    it('triggers on "facial droop"', () => {
      const result = checkUrgencyFloor('noticed facial droop on one side', null);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('stroke_signs');
    });

    it('triggers on "slurred speech"', () => {
      const result = checkUrgencyFloor('has slurred speech since morning', null);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('stroke_signs');
    });

    it('triggers on "one-sided weakness"', () => {
      const result = checkUrgencyFloor('sudden one-sided weakness in left arm', null);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('stroke_signs');
    });

    it('triggers on severity >= 9', () => {
      const result = checkUrgencyFloor('mild headache', 9);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('severity_threshold');
    });

    it('triggers on severity 10', () => {
      const result = checkUrgencyFloor('mild headache', 10);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('severity_threshold');
    });

    it('does not trigger on normal symptoms', () => {
      const result = checkUrgencyFloor('mild headache for 2 days', 3);
      expect(result.triggered).toBe(false);
      expect(result.matchedRules).toHaveLength(0);
    });

    it('does not trigger on severity 8', () => {
      const result = checkUrgencyFloor('mild headache', 8);
      expect(result.triggered).toBe(false);
    });

    it('case-insensitive matching', () => {
      const result = checkUrgencyFloor('CHEST PAIN is severe', null);
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('chest_pain');
    });

    it('can match multiple rules', () => {
      const result = checkUrgencyFloor(
        'chest pain with shortness of breath and slurred speech',
        10,
      );
      expect(result.triggered).toBe(true);
      expect(result.matchedRules).toContain('chest_pain');
      expect(result.matchedRules).toContain('breathlessness');
      expect(result.matchedRules).toContain('stroke_signs');
      expect(result.matchedRules).toContain('severity_threshold');
    });
  });

  describe('applyUrgencyFloor', () => {
    it('overrides model "low" to "high" when floor triggers', () => {
      const result = applyUrgencyFloor('low', 'crushing chest pain', 5);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
    });

    it('overrides model "medium" to "high" when floor triggers', () => {
      const result = applyUrgencyFloor('medium', 'severe bleeding', null);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
    });

    it('does not change model "high" even when floor triggers', () => {
      const result = applyUrgencyFloor('high', 'chest pain', null);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(false);
    });

    it('preserves model "low" when no floor triggers', () => {
      const result = applyUrgencyFloor('low', 'mild headache', 3);
      expect(result.urgency).toBe('low');
      expect(result.floorApplied).toBe(false);
    });

    it('preserves model "medium" when no floor triggers', () => {
      const result = applyUrgencyFloor('medium', 'stomach ache with nausea', 6);
      expect(result.urgency).toBe('medium');
      expect(result.floorApplied).toBe(false);
    });

    it('severity 9 alone forces high', () => {
      const result = applyUrgencyFloor('low', 'headache', 9);
      expect(result.urgency).toBe('high');
      expect(result.floorApplied).toBe(true);
      expect(result.matchedRules).toContain('severity_threshold');
    });
  });

  describe('rule completeness', () => {
    it('covers all required categories', () => {
      const ruleNames = URGENCY_RULES.map((r) => r.name);
      expect(ruleNames).toContain('chest_pain');
      expect(ruleNames).toContain('breathlessness');
      expect(ruleNames).toContain('severe_bleeding');
      expect(ruleNames).toContain('altered_consciousness');
      expect(ruleNames).toContain('stroke_signs');
    });

    it('severity threshold is 9', () => {
      expect(SEVERITY_THRESHOLD).toBe(9);
    });
  });
});
