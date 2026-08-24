import { useState, type FormEvent } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Button, Callout } from '@sentinel/ui';
import { loginRequestSchema } from '@sentinel/contracts';
import { useLogin } from '../auth/useSession.js';
import { DEMO_HINT } from '../config.js';
import { LoginField } from './LoginField.js';
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFieldErrors({});

    // Validated with the same schema the API uses, so the two cannot drift apart.
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
    <main className="login">
      <form className="login__card" onSubmit={handleSubmit} noValidate>
        <p className="login__eyebrow">Sentinel</p>
        <h1 className="login__title">Sign in</h1>
        <p className="login__lede">
          Every approval is recorded against the person who made it, so the console needs to know
          who you are.
        </p>

        {loginMutation.isError && (
          <Callout tone="critical" title="Could not sign in">
            <p role="alert">{loginMutation.error.message}</p>
          </Callout>
        )}

        <LoginField
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          error={fieldErrors.email}
          onChange={setEmail}
        />

        <LoginField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={fieldErrors.password}
          onChange={setPassword}
        />

        <Button type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="login__hint">{DEMO_HINT}</p>
      </form>
    </main>
  );
}
