/**
 * JCAH_TGenX — Single Source of Truth for Scoring Constants (WP5 / M6 / M7)
 * Frozen constants defining the authoritative grading scale, CEFR classification,
 * weights, and text normalization.
 * Consumed by:
 *  - shared/scoring.js (client scoring engine)
 *  - exam/js/answerService.js (Mode B client aggregator)
 *  - backend/google_apps_script.js (mirrored server grading engine)
 *  - tests/scoring_consistency.test.cjs (invariance verification suite)
 */

function normalizeText(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

const CEFR_LEVELS = Object.freeze([
  Object.freeze({ key: 'A0',  label: 'A0',  cssClass: 'chip-a0',  min:  0, max: 10 }),
  Object.freeze({ key: 'A1',  label: 'A1',  cssClass: 'chip-a1',  min: 10, max: 20 }),
  Object.freeze({ key: 'A1+', label: 'A1+', cssClass: 'chip-a1p', min: 20, max: 30 }),
  Object.freeze({ key: 'A2',  label: 'A2',  cssClass: 'chip-a2',  min: 30, max: 40 }),
  Object.freeze({ key: 'A2+', label: 'A2+', cssClass: 'chip-a2p', min: 40, max: 50 }),
  Object.freeze({ key: 'B1',  label: 'B1',  cssClass: 'chip-b1',  min: 50, max: 60 }),
  Object.freeze({ key: 'B1+', label: 'B1+', cssClass: 'chip-b1p', min: 60, max: 70 }),
  Object.freeze({ key: 'B2',  label: 'B2',  cssClass: 'chip-b2',  min: 70, max: 80 }),
  Object.freeze({ key: 'B2+', label: 'B2+', cssClass: 'chip-b2p', min: 80, max: 90 }),
  Object.freeze({ key: 'C1',  label: 'C1',  cssClass: 'chip-c1',  min: 90, max: 100 }),
]);

function mapPercentageToLevel(score) {
  if (typeof score !== 'number' || isNaN(score)) return null;
  const s = Math.max(0, Math.min(100, score));
  if (s <= 10) return 'A0';
  if (s <= 20) return 'A1';
  if (s <= 30) return 'A1+';
  if (s <= 40) return 'A2';
  if (s <= 50) return 'A2+';
  if (s <= 60) return 'B1';
  if (s <= 70) return 'B1+';
  if (s <= 80) return 'B2';
  if (s <= 90) return 'B2+';
  return 'C1';
}

const PASSING_SCORE_DEFAULT = 70;

const WRITING_WEIGHTS = Object.freeze({
  vocab: 0.5,
  grammar: 0.5
});

const OVERALL_WEIGHTS = Object.freeze({
  withoutSpeaking: 3,
  withSpeaking: 4
});

const SPEAKING_LEVEL_MAP = Object.freeze({
  'A0': 0,
  'A1': 15,
  'A1+': 25,
  'A2': 35,
  'A2+': 45,
  'B1': 55,
  'B1+': 65,
  'B2': 75,
  'B2+': 85,
  'C1': 95
});

const JCAHScoringConstants = Object.freeze({
  CEFR_LEVELS,
  mapPercentageToLevel,
  PASSING_SCORE_DEFAULT,
  WRITING_WEIGHTS,
  OVERALL_WEIGHTS,
  SPEAKING_LEVEL_MAP,
  normalizeText
});

if (typeof window !== 'undefined') {
  window.JCAHScoringConstants = JCAHScoringConstants;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JCAHScoringConstants;
}
