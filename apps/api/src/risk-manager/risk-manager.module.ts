import { Module, type Provider } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IncidentsModule } from '../incidents/incidents.module.js';
import { ContainmentModule } from '../containment/containment.module.js';
import { RiskManagerController } from './risk-manager.controller.js';
import { RiskManagerService, RISK_PROVIDER } from './risk-manager.service.js';
import { GroqRiskProvider } from './groq.provider.js';

/**
 * The live reasoner is bound only when GROQ is configured. Absent, the service runs the deterministic
 * local/template tiers — a full, honest recommendation with no LLM — which is the default build.
 */
const riskProvider: Provider = {
  provide: RISK_PROVIDER,
  useFactory: () => {
    const key = process.env.GROQ_API_KEY;
    if (key === undefined || key === '') return undefined;
    return new GroqRiskProvider(key, process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b');
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
