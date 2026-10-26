import { BadRequestException, Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Public } from '../auth/roles';
import { IsIn, IsString } from 'class-validator';
import { PaymentsService } from './payments.service';

class CreateOrderDto {
  @IsIn(['APPOINTMENT', 'LAB_BOOKING', 'PHARMA_ORDER', 'STAFF_VISIT']) purpose: 'APPOINTMENT' | 'LAB_BOOKING' | 'PHARMA_ORDER' | 'STAFF_VISIT';
  @IsString() refId: string;
}
class VerifyDto {
  @IsString() orderId: string;
  @IsString() paymentId: string;
  @IsString() signature: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post('create-order')
  create(@Req() req: any, @Body() b: CreateOrderDto) {
    return this.payments.createOrder(req.user.id, b.purpose, b.refId);
  }

  /** Razorpay webhook. Authenticated by signature over the raw body, not by a user token. */
  @Public() @Post('webhook') @HttpCode(200)
  webhook(@Req() req: any, @Headers('x-razorpay-signature') sig: string) {
    if (!req.rawBody) throw new BadRequestException('Missing body');
    return this.payments.handleWebhook(req.rawBody, sig);
  }

  @Post('verify')
  verify(@Req() req: any, @Body() b: VerifyDto) {
    return this.payments.verify(req.user.id, b.orderId, b.paymentId, b.signature);
  }
}
