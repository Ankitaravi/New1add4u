import { Module } from '@nestjs/common';
import { HealthRecordsController } from './health-records.controller';

@Module({ controllers: [HealthRecordsController] })
export class HealthRecordsModule {}
