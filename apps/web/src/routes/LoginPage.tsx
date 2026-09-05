import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { loginRequestSchema } from '@sentinel/contracts';
import { useLogin } from '../auth/useSession.js';
import { StorefrontLink } from '../components/StorefrontLink.js';
import { Eye, EyeSlash, Plus } from '@phosphor-icons/react';
import razorpayLogo from '../assets/white.png';
import { LightStreaks } from '../components/LightStreaks.js';
import './LoginPage.css';

const DEMO_EMAIL = 'analyst@sentinel.local';
const DEMO_PASSWORD = 'sentinel-demo';

/** The three claims the art panel closes on — short enough to read at a glance. */
const HIGHLIGHTS = ['Real-time detection', 'A calibrated model', 'Immutable audit logs'];

type FieldErrors = { email?: string; password?: string };

function collectErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === 'email' && errors.email === undefined) errors.email = issue.message;
    if (field === 'password' && errors.password === undefined) errors.password = issue.message;
  }
  return errors;
}

function LoginArtPanel(): React.JSX.Element {
  return (
    <div className="lg-art">
      <LightStreaks className="lg-art__canvas" />
      <div className="lg-art__brand">
        <a className="lg-art__logo" href="/">
          <img src={razorpayLogo} alt="Razorpay" />
        </a>
        <span className="lg-art__tag">/ buildathon</span>
      </div>
      <div className="lg-art__copy">
        <h1>
          Catch card testing before
          <br />
          it drains your gateway
        </h1>
        <ul>
          {HIGHLIGHTS.map((item) => (
            <li key={item}>
              <span aria-hidden="true">+</span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LoginHead(): React.JSX.Element {
  return (
    <div className="lg-head">
      {/* The Razorpay wordmark ships as a white asset, so on this white panel it rendered as
          nothing. It stays on the art panel opposite, where there is a dark ground to sit on. */}
      {/* The shipped asset is a white wordmark, so on this white panel it is filtered to black
          rather than swapped for a second file. */}
      <div className="lg-lockup">
        <img src={razorpayLogo} alt="Razorpay" />
        <span className="lg-lockup__rule" aria-hidden="true" />
        <span className="lg-lockup__name">SENTINEL</span>
      </div>
      <p className="lg-welcome">
        Welcome to <strong>Sentinel</strong>
      </p>
      <h2 className="lg-title">Sign in to the console</h2>
    </div>
  );
}

interface FieldProps {
  value: string;
  onChange: (next: string) => void;
  error?: string | undefined;
}

function EmailField({ value, onChange, error }: FieldProps): React.JSX.Element {
  return (
    <div className="lg-field">
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        placeholder="Enter your email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error !== undefined}
      />
      {error && <p className="lg-field__error">{error}</p>}
    </div>
  );
}

function PasswordField({ value, onChange, error }: FieldProps): React.JSX.Element {
  const [shown, setShown] = useState(false);
  return (
    <div className="lg-field">
      <label htmlFor="password">Password</label>
      <div className="lg-field__wrap">
        <input
          id="password"
          name="password"
          type={shown ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder="Enter your password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error !== undefined}
        />
        <button
          type="button"
          className="lg-reveal"
          onClick={() => setShown((prev) => !prev)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {shown ? <EyeSlash size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {error && <p className="lg-field__error">{error}</p>}
    </div>
  );
}

function DemoAccess({ onFill }: { onFill: () => void }): React.JSX.Element {
  return (
    <div className="lg-demo">
      <div className="lg-demo__head">
        <span className="lg-demo__label">Demo credentials</span>
        <button
          type="button"
          className="lg-demo__fill"
          onClick={onFill}
          aria-label="Auto-fill the demo credentials into the form"
        >
          <Plus size={12} weight="bold" />
          Auto-fill
        </button>
      </div>
      {/* A flat definition list on a two-column grid, so every value starts at the same x. The
          previous shape justified each row to its own edges, which left the two values ending
          flush right and beginning nowhere in particular. */}
      <dl className="lg-demo__list">
        <dt>Email</dt>
        <dd>{DEMO_EMAIL}</dd>
        <dt>Password</dt>
        <dd>{DEMO_PASSWORD}</dd>
      </dl>
    </div>
  );
}

function LoginAside(): React.JSX.Element {
  return (
    <div className="lg-aside">
      <StorefrontLink className="lg-storefront">
        <span className="lg-storefront__text">
          <strong>Access the storefront</strong>
          Simulate payments against the demo checkout
        </span>
        <span className="lg-storefront__go" aria-hidden="true">
          →
        </span>
      </StorefrontLink>
      <Link to="/" className="lg-home">
        <span className="lg-home__arrow" aria-hidden="true">
          ←
        </span>
        Back to home
      </Link>
    </div>
  );
}

interface LoginFormProps {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isError: boolean;
  errorMessage?: string | undefined;
  isPending: boolean;
  email: string;
  setEmail: (next: string) => void;
  password: string;
  setPassword: (next: string) => void;
  fieldErrors: FieldErrors;
}

function LoginForm(props: LoginFormProps): React.JSX.Element {
  const { onSubmit, isError, errorMessage, isPending, fieldErrors } = props;
  return (
    <form className="lg-form" onSubmit={onSubmit} noValidate>
      {isError && (
        <p className="lg-alert" role="alert">
          {errorMessage}
        </p>
      )}

      <EmailField value={props.email} onChange={props.setEmail} error={fieldErrors.email} />
      <PasswordField
        value={props.password}
        onChange={props.setPassword}
        error={fieldErrors.password}
      />

      <button type="submit" className="lg-submit" disabled={isPending}>
        {isPending ? (
          'Signing in…'
        ) : (
          <>
            Sign in
            <span className="lg-submit__go" aria-hidden="true">
              →
            </span>
          </>
        )}
      </button>

      <DemoAccess
        onFill={() => {
          props.setEmail(DEMO_EMAIL);
          props.setPassword(DEMO_PASSWORD);
        }}
      />
    </form>
  );
}

export function LoginPage(): React.JSX.Element {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { redirect?: string };
  const loginMutation = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFieldErrors({});

    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(collectErrors(parsed.error.issues));
      return;
    }

    loginMutation.mutate(parsed.data, {
      onSuccess: () => void navigate({ to: search.redirect ?? '/console' }),
    });
  }

  return (
    <main className="lg">
      <LoginArtPanel />
      <section className="lg-panel">
        <div className="lg-panel__inner">
          <LoginHead />
          <LoginForm
            onSubmit={handleSubmit}
            isError={loginMutation.isError}
            errorMessage={loginMutation.error?.message}
            isPending={loginMutation.isPending}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            fieldErrors={fieldErrors}
          />
          <LoginAside />
        </div>
      </section>
    </main>
  );
}
