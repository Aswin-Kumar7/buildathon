import { Module, type Provider } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IncidentsModule } from '../incidents/incidents.module.js';
import { ContainmentModule } from '../containment/containment.module.js';
import { RiskManagerController } from './risk-manager.controller.js';
import { RiskManagerService, RISK_PROVIDER } from './risk-manager.service.js';
import { GroqRiskProvider } from './groq.provider.js';

/**
 * The live reasoner is bound only when the mode asks for it AND Groq is configured. Absent, the
 * service runs the deterministic local/template tiers — a full, honest recommendation with no LLM —
 * which is the default build.
 *
 * The mode is checked here as well as the key. It used to bind on the key alone, so a workspace with
 * `RISK_MANAGER_MODE=local` and a key still lying around in the environment would quietly call the
 * model while the settings page — which does read the mode — reported AI as switched off. The
 * setting now decides, and the two agree by construction.
 */
export function liveProviderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.GROQ_API_KEY;
  return (
    (env.RISK_MANAGER_MODE ?? 'local').toLowerCase() === 'live' && key !== undefined && key !== ''
  );
}

const riskProvider: Provider = {
  provide: RISK_PROVIDER,
  useFactory: () => {
    if (!liveProviderEnabled()) return undefined;
    return new GroqRiskProvider(
      process.env.GROQ_API_KEY!,
      process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
    );
  },
};

/**
 * The AI Risk Manager hangs off incidents (the verified record) and containment (the policy preview
 * and the propose/approve rail it dispatches into). Both are imported for their services; the audit
 * chain is global.
 */
@Module({
  imports: [AuthModule, IncidentsModule, ContainmentModule],
  controllers: [RiskManagerController],
  providers: [RiskManagerService, riskProvider],
  exports: [RiskManagerService],
})
export class RiskManagerModule {}
