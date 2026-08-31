import { useState } from 'react';
import { ChatTeardropText, Sparkle, PaperPlaneRight } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { copilotAnswerResponseSchema, type IncidentDetail } from '@sentinel/contracts';
import { apiMutate } from '../auth/api.js';
import './IncidentCopilot.css';

const SUGGESTIONS = [
  'Why is this risky?',
  'What should I do about it?',
  'Could this be a false alarm?',
  'What happens if I block it?',
];

type Turn = { q: string; a: string; available: boolean };

export function IncidentCopilotWidget({
  incident,
}: {
  incident: IncidentDetail;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="cop-widget">
      {open && <CopilotPanel incident={incident} onClose={() => setOpen(false)} />}
      <button
        type="button"
        className={`cop-fab${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close AI assistant' : 'Ask AI about this incident'}
      >
        {open ? (
          '✕'
        ) : (
          <>
            <ChatTeardropText /> Ask Assistant
          </>
        )}
      </button>
    </div>
  );
}

function CopilotPanel({
  incident,
  onClose,
}: {
  incident: IncidentDetail;
  onClose: () => void;
}): React.JSX.Element {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');

  const ask = useMutation({
    mutationFn: async (question: string) => {
      const response = await apiMutate(`/api/incidents/${incident.id}/ask`, { question });
      if (!response.ok) throw new Error(`api returned ${response.status}`);
      const data = copilotAnswerResponseSchema.parse(await response.json());
      return { question, data };
    },
    onSuccess: ({ question, data }) => {
      setTurns((prev) => [...prev, { q: question, a: data.answer, available: data.available }]);
      setInput('');
    },
  });

  const submit = (question: string): void => {
    const q = question.trim();
    if (q !== '' && !ask.isPending) ask.mutate(q);
  };

  return (
    <section className="cop-panel" role="dialog" aria-label="Ask Sentinel about this incident">
      <header className="cop-panel__head">
        <div className="cop-panel__head-title">
          <span className="cop-panel__avatar">
            <Sparkle />
          </span>
          <div>
            <strong>Sentinel Assistant</strong>
            <span>Grounded in incident evidence</span>
          </div>
        </div>
        <button type="button" className="cop-panel__x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <CopilotThread turns={turns} pending={ask.isPending} error={ask.isError} />

      <div className="cop-suggest">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => submit(s)} disabled={ask.isPending}>
            {s}
          </button>
        ))}
      </div>

      <form
        className="cop-input"
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about this incident…"
          aria-label="Ask about this incident"
          maxLength={500}
          disabled={ask.isPending}
        />
        <button type="submit" disabled={ask.isPending || input.trim() === ''}>
          {ask.isPending ? (
            '…'
          ) : (
            <>
              Ask <PaperPlaneRight />
            </>
          )}
        </button>
      </form>
    </section>
  );
}

function CopilotThread({
  turns,
  pending,
  error,
}: {
  turns: Turn[];
  pending: boolean;
  error: boolean;
}): React.JSX.Element {
  return (
    <div className="cop-thread" aria-live="polite">
      {turns.length === 0 && !pending && (
        <p className="cop-empty">
          Ask any question about this incident pattern, risk factors, or recommended containment
          policy.
        </p>
      )}
      {turns.map((turn, index) => (
        <div className="cop-turn" key={index}>
          <p className="cop-q">{turn.q}</p>
          {turn.available ? (
            <p className="cop-a">{turn.a}</p>
          ) : (
            <p className="cop-a cop-a--off">
              The AI assistant isn’t available right now — please try again in a moment.
            </p>
          )}
        </div>
      ))}
      {pending && (
        <p className="cop-a cop-thinking">
          <Sparkle /> Analyzing incident evidence…
        </p>
      )}
      {error && (
        <p className="cop-a cop-a--off" role="alert">
          Couldn’t reach the assistant. Please try again.
        </p>
      )}
    </div>
  );
}
