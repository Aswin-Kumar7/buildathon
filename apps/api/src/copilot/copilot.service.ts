import { Injectable, Logger } from '@nestjs/common';
import type { CopilotAnswerResponse, IncidentDetail, PolicyDecisionDto } from '@sentinel/contracts';
import { IncidentsService } from '../incidents/incidents.service.js';
import { ContainmentService } from '../containment/containment.service.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM =
  'You are Sentinel, an assistant helping a merchant understand ONE payment-fraud incident. ' +
  "Answer the merchant's question using ONLY the incident context provided below. Write plainly and " +
  'concisely for a non-expert — a few sentences, no jargon dumps. Do NOT invent numbers, card ' +
  'details, customer identities, or any fact not present in the context; if the context does not ' +
  'answer the question, say so plainly. You are advisory only: you never take any action, and any ' +
  'block or change is only ever applied after the merchant approves it in the console.';

/**
 * The incident copilot: grounded, prose question-answering over one incident's verified record.
 *
 * It reuses the same live model as the risk manager (Groq), but for free text rather than a structured
 * selection. Because an arbitrary question has no deterministic answer, this surface is LLM-only: when
 * the model is not configured or cannot be reached, it returns `available: false` — it never fabricates
 * an answer. The context it is given is PII-free (codes, counts and pseudonymised scores, never a card,
 * an IP, or a raw identifier), so the model cannot surface anything the rest of the console hides.
 */
@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);
  private readonly key = process.env.GROQ_API_KEY;
  private readonly model = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';

  constructor(
    private readonly incidents: IncidentsService,
    private readonly containment: ContainmentService,
  ) {}

  async ask(incidentId: string, question: string): Promise<CopilotAnswerResponse> {
    // Loads the incident (throws NotFound if it does not exist) before spending a model call.
    const detail = await this.incidents.detail(incidentId);
    if (this.key === undefined || this.key === '') {
      return { incidentId, available: false, answer: '' };
    }
    // The current policy decision, so a policy change is reflected in the very next answer.
    const policy = await this.containment.preview(incidentId);
    try {
      const answer = await this.callGroq(buildContext(detail, policy), question);
      return { incidentId, available: true, answer };
    } catch (error) {
      this.logger.warn(
        `copilot live call failed: ${error instanceof Error ? error.message : String(error)}` +
          (error instanceof Error && error.cause instanceof Error
            ? ` | cause: ${error.cause.message}`
            : ''),
      );
      return { incidentId, available: false, answer: '' };
    }
  }

  private async callGroq(context: string, question: string): Promise<string> {
    const body = {
      model: this.model,
      temperature: 0.2,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Incident context:\n${context}\n\nMerchant question: ${question}`,
        },
      ],
    };
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key!}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) throw new Error(`groq returned ${response.status}`);
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (content === undefined || content.trim() === '') throw new Error('groq returned no content');
    return content.trim();
  }
}

/**
 * A PII-free, grounded digest of the incident for the prompt: codes, counts, the model's read and the
 * status history — never a card, an IP, a payment id or a pseudonym. The model answers from this alone.
 */
function buildContext(it: IncidentDetail, policy: PolicyDecisionDto | null): string {
  const pct = (n: number): string => `${Math.round(n * 100)}%`;
  const lines: string[] = [];
  lines.push(`Title: ${it.title}`);
  lines.push(
    `Severity: ${it.severity}. Risk score: ${Math.round(it.score * 100)}/100 (${it.band} band). Status: ${it.status}.`,
  );
  lines.push(
    `Correlated ${it.attempts} payment attempts (${it.failures} failed) across ` +
      `${it.distinctCards ?? 'an unconfirmed number of'} distinct cards, on one ${it.entityKind}.`,
  );
  lines.push(
    `Sentinel's read: ${it.primaryHypothesis.replace(/_/g, ' ')}. Recommended response: ${it.recommendedDecision}.`,
  );

  const fired = it.evidence.filter((e) => e.weight > 0);
  if (fired.length > 0) {
    lines.push('Signals that fired (code: observed vs threshold):');
    for (const e of fired)
      lines.push(`- ${e.code}: observed ${e.observed}, threshold ${e.threshold}`);
  }
  const mitigating = it.evidence.filter((e) => e.weight < 0);
  if (mitigating.length > 0) {
    lines.push('Mitigating signals (argue against acting):');
    for (const e of mitigating)
      lines.push(`- ${e.code}: observed ${e.observed}, threshold ${e.threshold}`);
  }

  if (it.modelOpinion !== null) {
    const m = it.modelOpinion;
    const top = m.contributions
      .slice(0, 3)
      .map((c) => `${c.feature} ${c.contribution >= 0 ? '+' : ''}${c.contribution.toFixed(2)}`)
      .join(', ');
    lines.push(
      `ML model: estimated abuse risk ${pct(m.risk)}, predicted "${m.predictedClass}". Top factors: ${top}.`,
    );
  } else {
    lines.push('ML model: no opinion produced for this incident.');
  }

  lines.push(`Detected ${Math.round(it.timeToDetectMs / 1000)}s after the first attempt.`);
  if (it.history.length > 0) {
    lines.push(`Status history: ${it.history.map((h) => `${h.from} -> ${h.to}`).join(', ')}.`);
  }

  if (policy !== null) {
    const needs =
      policy.approvalsRequired > 0
        ? ` (needs ${policy.approvalsRequired} approval${policy.approvalsRequired === 1 ? '' : 's'})`
        : '';
    const held =
      policy.refusals.length > 0
        ? `; a stronger action is held back because: ${policy.refusals.join(', ')}`
        : '';
    lines.push(
      `Current policy: it would ${policy.action}${needs}${held}. (policy v${policy.policyVersion})`,
    );
  } else {
    lines.push('Current policy: no containment decision on this incident yet.');
  }
  return lines.join('\n');
}
