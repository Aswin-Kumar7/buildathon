const STEPS = [
  { title: 'Checkout', note: 'logs hashed ip, device, session', sensor: true },
  { title: 'Razorpay', note: 'hosted checkout, signed webhooks', sensor: false },
  { title: 'Ingest', note: 'verify, persist, then acknowledge', sensor: false },
  { title: 'Detect', note: 'rules, change detection, model', sensor: false },
  { title: 'Decide', note: 'policy and approval gate', sensor: false },
  { title: 'Audit', note: 'tamper-evident chain', sensor: false },
];

export function Pipeline(): React.JSX.Element {
  return (
    <div>
      <div
        className="flow"
        role="img"
        aria-label="Pipeline: checkout to Razorpay to ingest to detect to decide to audit, with narration off the decision path"
      >
        {STEPS.map((step) => (
          <div key={step.title} className={`flow-step${step.sensor ? ' flow-step--sensor' : ''}`}>
            <strong>{step.title}</strong>
            <span>{step.note}</span>
          </div>
        ))}
      </div>
      <div className="flow" style={{ marginTop: 'var(--s-2)' }}>
        <div className="flow-step flow-step--aside">
          <strong>Narration</strong>
          <span>reads decisions, has no path to an action</span>
        </div>
      </div>
    </div>
  );
}
