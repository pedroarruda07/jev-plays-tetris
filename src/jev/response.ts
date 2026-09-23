import type { JevDecision } from './types';
import { isRecord } from './validation';

function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Reject malformed distributions and select their maximum without sampling. */
export function parseJevDecision(raw: unknown, allowed: string[]): JevDecision {
  if (!isRecord(raw) || !isRecord(raw.answers) || !isRecord(raw.answers.nextPlacement)) {
    throw new Error('Jev response is missing answers.nextPlacement.');
  }
  const answer = raw.answers.nextPlacement;
  if (
    answer.type !== 'choice' ||
    typeof answer.choice !== 'string' ||
    !allowed.includes(answer.choice) ||
    !probability(answer.confidence) ||
    !isRecord(answer.probabilities)
  )
    throw new Error('Jev returned an invalid Choice answer.');

  const probabilities: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  const entries = Object.entries(answer.probabilities);
  if (!allowed.length || entries.length !== allowed.length) {
    throw new Error('Jev must return a probability for every requested placement.');
  }
  for (const [action, value] of entries) {
    if (!allowed.includes(action) || !probability(value)) {
      throw new Error('Jev returned an unknown placement or invalid probability.');
    }
    probabilities[action] = value;
  }
  const sum = entries.reduce((total, [, value]) => total + Number(value), 0);
  if (Math.abs(sum - 1) > 0.01) throw new Error('Jev probabilities must sum to one.');

  // Respect Jev's choice on ties; otherwise use the actual highest probability.
  let action = answer.choice;
  for (const candidate of allowed) {
    if (probabilities[candidate]! > probabilities[action]!) action = candidate;
  }
  return {
    placementId: action,
    modelChoice: answer.choice,
    confidence: answer.confidence,
    probabilities,
  };
}
