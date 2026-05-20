import { Module } from '@nestjs/common';
import { ActivityLogsController } from './activity-logs.controller';

@Module({
  controllers: [ActivityLogsController],
})
export class ActivityLogsModule {}
