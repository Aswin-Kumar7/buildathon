import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OverviewController } from './overview.controller.js';
import { OverviewService } from './overview.service.js';

@Module({
  imports: [AuthModule],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
