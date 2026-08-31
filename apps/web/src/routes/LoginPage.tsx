import { useState, type FormEvent } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Callout } from '@sentinel/ui';
import { loginRequestSchema } from '@sentinel/contracts';
import { useLogin } from '../auth/useSession.js';
import { DEMO_HINT } from '../config.js';
import {
  Eye,
  EyeSlash,
  ShieldCheck,
  EnvelopeSimple,
  LockKey,
  Lightning,
  ShieldCheckered,
  Target,
  FileText,
} from '@phosphor-icons/react';
import mobileCardBannerImg from '../assets/login_mobile_card-nobg.png';
import './LoginPage.css';

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

export function LoginPage(): React.JSX.Element {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { redirect?: string };
  const loginMutation = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="login-split-page">
      {/* Left 50% Banner Section - Warm Dark Matte Theme */}
      <div className="login-split-left">
        <div className="login-split-left__header">
          <p className="login-split-left__subtitle">
            Real-time AI payment protection, velocity anomaly detection & automated risk policies.
          </p>
          <h1 className="login-split-left__title">
            Autonomous <br />
            Fraud Defense
          </h1>
        </div>

        {/* Center Content: Left Phone Graphic, Right Clean Bullet Points (No Box) */}
        <div className="login-split-left__content-wrap">
          <div className="login-split-left__graphic-side">
            <img
              src={mobileCardBannerImg}
              alt="Sentinel Fraud Detection Mobile Dashboard"
              className="login-split-left__graphic"
            />
          </div>

          <div className="login-split-left__points-side">
            <div className="login-points-container">
              <div className="login-point-row">
                <div className="login-point-icon-badge">
                  <Lightning size={18} weight="fill" />
                </div>
                <div className="login-point-text">
                  <h3>Sub-45ms Real-Time AI Scoring</h3>
                  <p>Instant risk evaluation before transaction authorization</p>
                </div>
              </div>

              <div className="login-point-row">
                <div className="login-point-icon-badge">
                  <ShieldCheckered size={18} weight="fill" />
                </div>
                <div className="login-point-text">
                  <h3>Autonomous Velocity Defense</h3>
                  <p>Blocks botnet card testing & stolen credential spikes</p>
                </div>
              </div>

              <div className="login-point-row">
                <div className="login-point-icon-badge">
                  <Target size={18} weight="bold" />
                </div>
                <div className="login-point-text">
                  <h3>99.98% Detection Precision</h3>
                  <p>Eliminates false declines for legitimate buyers</p>
                </div>
              </div>

              <div className="login-point-row">
                <div className="login-point-icon-badge">
                  <FileText size={18} weight="bold" />
                </div>
                <div className="login-point-text">
                  <h3>Automated Policy Enforcement</h3>
                  <p>Approve, challenge, or block with immutable audit logs</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right 50% Form Section - Clean Enterprise Light Theme */}
      <div className="login-split-right">
        <div className="login-split-right__content">
          <div className="login-brand">
            <div className="login-brand__logo">
              <ShieldCheck size={22} weight="fill" />
            </div>
            <span className="login-brand__name">Sentinel</span>
            <span className="login-brand__tag">Fraud Engine</span>
          </div>

          <div className="login-header">
            <h2 className="login-title">Welcome Back</h2>
            <p className="login-subtitle">Enter your credentials to access the risk console</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {loginMutation.isError && (
              <Callout tone="critical" title="Could not sign in">
                <p role="alert">{loginMutation.error.message}</p>
              </Callout>
            )}

            <div className="login-field">
              <label htmlFor="email">Work Email</label>
              <div className="login-input-icon-wrap">
                <EnvelopeSimple size={18} className="login-input-icon" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={fieldErrors.email !== undefined}
                />
              </div>
              {fieldErrors.email && <p className="login-field__error">{fieldErrors.email}</p>}
            </div>

            <div className="login-field">
              <label htmlFor="password">Password</label>
              <div className="login-input-icon-wrap">
                <LockKey size={18} className="login-input-icon" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={fieldErrors.password !== undefined}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {fieldErrors.password && <p className="login-field__error">{fieldErrors.password}</p>}
            </div>

            <div className="login-options-row">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span>Remember session</span>
              </label>
              <a
                href="#forgot"
                className="login-forgot-link"
                onClick={(e) => {
                  e.preventDefault();
                  alert('Please contact your administrator to reset your password.');
                }}
              >
                Forgot Password?
              </a>
            </div>

            <button type="submit" className="login-submit-btn" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? 'Signing In…' : 'Sign In'}
            </button>
          </form>

          <div className="login-demo-box">
            <span className="login-demo-box__label">Demo Analyst Credentials:</span>
            <code>{DEMO_HINT}</code>
          </div>

          <div className="login-footer">
            <p>
              Need an account?{' '}
              <a
                href="#contact"
                className="login-signup-link"
                onClick={(e) => {
                  e.preventDefault();
                  alert('Please contact your administrator to create an account.');
                }}
              >
                Contact administrator to create account
              </a>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
