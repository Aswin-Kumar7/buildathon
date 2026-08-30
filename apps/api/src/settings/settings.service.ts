import { Injectable } from '@nestjs/common';
import type { WorkspaceResponse } from '@sentinel/contracts';
import { loadEnv } from '../config/env.js';

/**
 * The read-only facts about this workspace's environment.
 *
 * Everything here is the real config the rest of the system runs on — the point of this service is
 * that the settings page stops inventing values and reads the ones that are actually true.
 */
@Injectable()
export class SettingsService {
  private readonly env = loadEnv();

  workspace(): WorkspaceResponse {
    const mode = (process.env.RISK_MANAGER_MODE ?? 'local').toLowerCase();
    const key = process.env.GROQ_API_KEY;
    const providerConfigured = key !== undefined && key !== '';
    return {
      environment: this.env.NODE_ENV,
      liveMode: this.env.NODE_ENV === 'production',
      currency: 'INR',
      retentionDays: this.env.FORENSIC_RETENTION_DAYS,
      sessionHours: this.env.SESSION_TTL_HOURS,
      loginMaxAttempts: this.env.LOGIN_MAX_ATTEMPTS,
      loginWindowMinutes: this.env.LOGIN_WINDOW_MINUTES,
      ai: {
        enabled: mode === 'live' && providerConfigured,
        mode,
        provider: providerConfigured ? 'Groq' : null,
        model: providerConfigured ? (process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b') : null,
      },
    };
  }
}
