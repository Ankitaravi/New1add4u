import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { AppointmentsController } from './appointments.controller';

@Module({ imports: [PaymentsModule], controllers: [AppointmentsController] })
export class AppointmentsModule {}
