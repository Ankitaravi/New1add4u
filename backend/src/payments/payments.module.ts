import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { RAZORPAY_GATEWAY, RazorpayGateway } from './razorpay.gateway';
import { PaymentsService } from './payments.service';

@Module({ controllers: [PaymentsController], providers: [PaymentsService, { provide: RAZORPAY_GATEWAY, useClass: RazorpayGateway }], exports: [PaymentsService] })
export class PaymentsModule {}
