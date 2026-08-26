import { Global, Module } from '@nestjs/common';
import { ModelScoringService } from './model-scoring.service.js';

/** Global: the incident pass and the registry endpoint both need the one loaded model. */
@Global()
@Module({ providers: [ModelScoringService], exports: [ModelScoringService] })
export class ModelScoringModule {}
