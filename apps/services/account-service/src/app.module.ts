import { Module } from '@nestjs/common';

import { HealthController } from './interfaces/health.controller';

@Module({
  controllers: [HealthController],
})
export class AppModule {}
