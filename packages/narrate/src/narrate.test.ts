import { describe, expect, it } from 'vitest';
import {
  CircuitBreaker,
  evidenceHash,
  fallbackChain,
  guarded,
  liveSelector,
  localSelector,
  narrateWith,
  replaySelector,
  runFallback,
  templateSelector,
  type NarrationFacts,
  type NarrationProvider,
  type ReplayStore,
} from './index.js';

function facts(over: Partial<NarrationFacts> = {}): NarrationFacts {
  return {
    entityKind: 'session',
    severity: 'high',
    score: 0.82,
    timeToDetectMs: 4200,
    evidence: [
      { rule: 'velocity', code: 'velocity', observed: 142, threshold: 40, weight: 3 },
      { rule: 'card_spread', code: 'card_spread', observed: 90, threshold: 20, weight: 2 },
      { rule: 'recovery', code: 'recovery', observed: 0.6, threshold: 0.3, weight: -1 },
    ],
    best: 'attack',
    runnerUp: 'retry_storm',
    decision: 'contain',
    changeFired: { ewma: true, cusum: false },
    model: { risk: 0.91, predictedClass: 'abuse', abstained: false },
    ...over,
  };
}

function memoryStore(): ReplayStore {
  const map = new Map<string, string[]>();
  return { get: (h) => map.get(h), put: (h, ids) => void map.set(h, ids) };
}

describe('the fact guard', () => {
  it('drops a claim id the catalog has never heard of, and counts it', async () => {
    const hallucinator = {
      source: 'live' as const,
      select: () => ['headline', 'not_a_real_claim'],
    };
    const narrative = await narrateWith(facts(), hallucinator);

    expect(narrative.lines.map((l) => l.claimId)).toEqual(['headline']);
    expect(narrative.dropped).toBe(1); // the invented id is the hallucination signal
  });

  it('drops a real claim that does not apply to these facts', async () => {
    // model_opinion is a real id, but with no model there is nothing to resolve it against.
    const selector = { source: 'live' as const, select: () => ['headline', 'model_opinion'] };
    const narrative = await narrateWith(facts({ model: null }), selector);

    expect(narrative.lines.map((l) => l.claimId)).toEqual(['headline']);
    expect(narrative.dropped).toBe(1);
  });

  it('binds every number from the facts, never from the selector', async () => {
    const narrative = await narrateWith(facts(), templateSelector);
    const text = narrative.lines.map((l) => l.text).join(' ');
    // The values a reader sees are the evidence values, formatted here — not anything a model said.
    expect(text).toContain('142 attempts');
    expect(text).toContain('90 different cards');
    expect(text).toContain('4.2s');
  });

  it('treats a repeated id as a duplicate, not a drop', async () => {
    const selector = {
      source: 'live' as const,
      select: () => ['headline', 'headline', 'decision'],
    };
    const narrative = await narrateWith(facts(), selector);
    expect(narrative.lines.map((l) => l.claimId)).toEqual(['headline', 'decision']);
    expect(narrative.dropped).toBe(0);
  });
});

describe('degradation', () => {
  it('falls through an unreachable provider to a working tier, and everything still works', async () => {
    const dead: NarrationProvider = {
      propose: () => Promise.reject(new Error('network unreachable')),
    };
    const chain = fallbackChain('live', {
      live: liveSelector(dead),
      replay: replaySelector(memoryStore()),
      local: localSelector,
      template: templateSelector,
    });

    const narrative = await runFallback(facts(), chain);
    // Not live, not replay (nothing recorded) — it landed on local, and produced real lines.
    expect(narrative.source).toBe('local');
    expect(narrative.lines.length).toBeGreaterThan(0);
  });

  it('pulling the provider changes the badge but not a word of the narrative', async () => {
    const store = memoryStore();
    // A live provider that mirrors what the local heuristic would choose, so its recording is real.
    const live: NarrationProvider = {
      propose: (f, available) =>
        localSelector.select(f, available, evidenceHash(f)) as Promise<string[]>,
    };

    // First, live succeeds and its selection is recorded.
    const online = await runFallback(
      facts(),
      fallbackChain('live', {
        live: liveSelector(live),
        replay: replaySelector(store),
        template: templateSelector,
      }),
      (n) => {
        if (n.source === 'live')
          store.put(
            n.evidenceHash,
            n.lines.map((l) => l.claimId),
          );
      },
    );
    expect(online.source).toBe('live');

    // Then the provider vanishes. Replay reproduces the recorded selection from the same evidence.
    const deadLive: NarrationProvider = { propose: () => Promise.reject(new Error('gone')) };
    const offline = await runFallback(
      facts(),
      fallbackChain('live', {
        live: liveSelector(deadLive),
        replay: replaySelector(store),
        template: templateSelector,
      }),
    );

    expect(offline.source).toBe('replay');
    // The whole point of the slice: identical text, only the badge differs.
    expect(offline.lines.map((l) => l.text)).toEqual(online.lines.map((l) => l.text));
  });

  it('replay is byte-identical offline across repeated runs', async () => {
    const store = memoryStore();
    store.put(evidenceHash(facts()), ['headline', 'top_reason', 'decision']);
    const chain = fallbackChain('replay', {
      replay: replaySelector(store),
      template: templateSelector,
    });

    const a = await runFallback(facts(), chain);
    const b = await runFallback(facts(), chain);
    expect(a.source).toBe('replay');
    expect(JSON.stringify(a.lines)).toBe(JSON.stringify(b.lines));
  });

  it('the template tier needs nothing and always produces something', async () => {
    const narrative = await runFallback(facts(), [templateSelector]);
    expect(narrative.source).toBe('template');
    expect(narrative.lines.length).toBeGreaterThan(0);
  });
});

describe('the circuit breaker', () => {
  it('opens after the threshold and refuses further calls until the cooldown', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => now });

    expect(breaker.canAttempt()).toBe(true);
    breaker.recordFailure();
    breaker.recordFailure(); // hits the threshold
    expect(breaker.current).toBe('open');
    expect(breaker.canAttempt()).toBe(false);

    now = 1000; // cooldown elapsed
    expect(breaker.canAttempt()).toBe(true); // one trial allowed
    expect(breaker.current).toBe('half-open');
    breaker.recordSuccess();
    expect(breaker.current).toBe('closed');
  });

  it('a guarded selector stops calling a provider once the breaker is open', async () => {
    let calls = 0;
    const now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => now });
    const flaky = guarded(
      {
        source: 'live',
        select: () => {
          calls += 1;
          return Promise.reject(new Error('boom'));
        },
      },
      breaker,
      50,
    );

    await expect(narrateWith(facts(), flaky)).rejects.toThrow();
    expect(breaker.current).toBe('open');
    // Second attempt is refused by the breaker without the provider being touched again.
    await expect(narrateWith(facts(), flaky)).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
