import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PharmaOrdersController } from './pharma-orders.controller';
import { PharmaController } from './pharma.controller';

@Module({ imports: [PaymentsModule], controllers: [PharmaController, PharmaOrdersController] })
export class PharmaModule {}
