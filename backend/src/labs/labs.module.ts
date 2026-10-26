import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { LabBookingsController } from './lab-bookings.controller';
import { LabsController } from './labs.controller';

@Module({ imports: [PaymentsModule], controllers: [LabsController, LabBookingsController] })
export class LabsModule {}
