import { Module } from '@nestjs/common';
import { HospitalsController } from './hospitals.controller';

@Module({ controllers: [HospitalsController] })
export class HospitalsModule {}
