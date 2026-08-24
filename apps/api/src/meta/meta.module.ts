import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller.js';

@Module({ controllers: [MetaController] })
export class MetaModule {}
