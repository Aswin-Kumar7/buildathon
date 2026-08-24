import { Controller, Get } from '@nestjs/common';
import { metaSchema, type Meta } from '@sentinel/contracts';

const CLAIM =
  'Sentinel detects and safely responds to merchant-side suspicious failed-payment clusters, ' +
  'while explicitly separating likely attack behaviour from outage, retry-storm and flash-sale lookalikes.';

/**
 * Evidence status is hardcoded per slice and moves to 'ready' only when the slice
 * that produces the evidence has actually landed. It is deliberately not derived
 * from configuration a demo could flip.
 */
const EVIDENCE: Meta['evidenceLayers'] = [
  {
    id: 'L1',
    name: 'Integration',
    source: 'Real Razorpay test-mode webhooks',
    proves: 'The ingestion contract works against the real sandbox',
    status: 'not-started',
    arrivesIn: 'Slice 4',
  },
  {
    id: 'L2',
    name: 'Scenario compliance',
    source: 'Seeded synthetic corpus, pre-registered',
    proves: 'The detector complies with disclosed scenario specifications',
    status: 'not-started',
    arrivesIn: 'Slice 9',
  },
  {
    id: 'L3',
    name: 'Benchmark',
    source: 'Public labelled fraud data',
    proves: 'Precision and recall on labels we did not author',
    status: 'not-started',
    arrivesIn: 'Slice 12',
  },
];

@Controller('meta')
export class MetaController {
  @Get()
  get(): Meta {
    return metaSchema.parse({
      name: 'Sentinel',
      claim: CLAIM,
      version: process.env.APP_VERSION ?? '0.1.0',
      commit: process.env.GIT_COMMIT ?? 'dev',
      slice: { number: 1, name: 'Landing page' },
      evidenceLayers: EVIDENCE,
    });
  }
}
