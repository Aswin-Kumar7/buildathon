import { Logger } from '@nestjs/common';
import {
  availableChanges,
  availableReasons,
  ceilingAction,
  type RiskFacts,
  type RiskProvider,
  type RiskSelection,
} from '@sentinel/risk-manager';

/**
 * The live reasoning tier, backed by Groq's OpenAI-compatible chat API.
 *
 * The model is given the incident's already-verified facts and the fixed catalog of grounded claim
 * ids, and asked for one thing: an ordering. It selects an action (never above the ceiling the rules
 * and policy already set) and picks which reason/change ids to surface. It returns ids only — it
 * never authors a number, a value, or a sentence, and anything it names that is not in the catalog
 * is dropped by the fact guard downstream. The facts it sees carry no PII by construction (counts,
 * codes and pseudonymised scores — never a card, an IP, or a fingerprint).
 */
export class GroqRiskProvider implements RiskProvider {
  private readonly logger = new Logger(GroqRiskProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly endpoint = 'https://api.groq.com/openai/v1/chat/completions',
  ) {
    this.logger.log(`groq provider ready — model=${model}`);
  }

  async propose(
    facts: RiskFacts,
    reasons: readonly string[],
    changes: readonly string[],
  ): Promise<RiskSelection> {
    const reasonMenu = availableReasons(facts)
      .filter((c) => reasons.includes(c.id))
      .map((c) => ({ id: c.id, text: c.text }));
    const changeMenu = availableChanges(facts)
      .filter((c) => changes.includes(c.id))
      .map((c) => ({ id: c.id, text: c.text }));
    const ceiling = ceilingAction(facts);

    const body = {
      model: this.model,
      temperature: 0,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            instruction:
              'Choose the recommended action and select which reason/change ids to surface. ' +
              `The action must be one of "contain", "review", "monitor" and MUST NOT be stronger than the ceiling "${ceiling}" ` +
              '(strength order: monitor < review < contain). Pick reasonIds only from reasons and changeIds only from changes, ' +
              'ordered most important first. Also write "rationale": one plain sentence for a merchant, in your own ' +
              'words, explaining the recommendation. You MAY reference numbers that appear in the facts or the reason ' +
              'texts, but you MUST NOT invent any number or fact. ' +
              'Return JSON {"action","reasonIds","changeIds","rationale"} and nothing else.',
            ceiling,
            facts: digest(facts),
            reasons: reasonMenu,
            changes: changeMenu,
          }),
        },
      ],
    };

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) {
      throw new Error(`groq returned ${response.status}`);
    }

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (content === undefined) throw new Error('groq returned no content');

    const parsed = JSON.parse(content) as {
      action?: unknown;
      reasonIds?: unknown;
      changeIds?: unknown;
      rationale?: unknown;
    };
    const action = parsed.action;
    if (action !== 'contain' && action !== 'review' && action !== 'monitor') {
      throw new Error(`groq proposed an invalid action: ${String(action)}`);
    }

    // Keep only ids the model was actually offered — the fact guard drops the rest, but filtering
    // here keeps the recorded selection honest about what was on the menu.
    const reasonSet = new Set(reasons);
    const changeSet = new Set(changes);
    const selection: RiskSelection = {
      action,
      reasonIds: asIds(parsed.reasonIds).filter((id) => reasonSet.has(id)),
      changeIds: asIds(parsed.changeIds).filter((id) => changeSet.has(id)),
    };
    // The model's own sentence — the prose guard downstream rejects any number it did not ground.
    if (typeof parsed.rationale === 'string') selection.rationale = parsed.rationale;
    return selection;
  }
}

const SYSTEM =
  'You are a grounded risk analyst for a card-testing fraud console. You are advisory only: you do ' +
  "not decide policy and you do not execute anything. You are given an incident's already-verified " +
  'facts and a fixed menu of claim ids with their bound text. Pick an action within the stated ceiling ' +
  'and choose which claim ids to surface. You may also write one plain rationale sentence in your own ' +
  'words, but you must NOT invent any number, card, IP, identity, count, or fact — every number you ' +
  'write has to already appear in the facts or the claim texts you were given. Respond with strict JSON only.';

/** A compact, PII-free digest of the facts for the prompt. */
function digest(facts: RiskFacts): Record<string, unknown> {
  return {
    entityKind: facts.entityKind,
    severity: facts.severity,
    score: facts.score,
    recommendedDecision: facts.recommendedDecision,
    attempts: facts.attempts,
    failures: facts.failures,
    distinctCards: facts.distinctCards,
    firedRules: facts.evidence.filter((e) => e.weight > 0).map((e) => e.code),
    mitigating: facts.evidence.filter((e) => e.weight < 0).map((e) => e.code),
    arbitration: { best: facts.best, runnerUp: facts.runnerUp, margin: facts.margin },
    modelInfluence: facts.modelInfluence,
    model:
      facts.model === null ? null : { risk: facts.model.risk, class: facts.model.predictedClass },
    policy: facts.policy,
    rehearsal: facts.rehearsal,
  };
}

function asIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
