import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { StaffController } from './staff.controller';

@Module({ imports: [PaymentsModule], controllers: [StaffController] })
export class StaffModule {}
