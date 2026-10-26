import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsString, Max, Min, MinLength, ValidateNested,
} from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { MAX_UNIT_PRICE_PAISE } from '../common/money';
import { PHARMA_FLOW, assertTransition } from '../common/transitions';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';

/** A quote must be paid within this long or the order expires. */
export const QUOTE_TTL_MS = 24 * 3600 * 1000;

class ReqItem {
  @IsString() @MinLength(1) name: string;
  @IsInt() @Min(1) @Max(1000) qty: number;
}
class QuoteItem extends ReqItem {
  @IsInt() @Min(1) @Max(MAX_UNIT_PRICE_PAISE) unitPricePaise: number;
}
class CreateOrderDto {
  @IsString() pharmaId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ReqItem)
  items: ReqItem[];
}
class QuoteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => QuoteItem)
  items: QuoteItem[];
}
class StatusDto {
  @IsIn(['ready', 'completed']) status: string;
}

@Controller('pharma-orders')
export class PharmaOrdersController {
  constructor(private prisma: PrismaService, private payments: PaymentsService, private notifications: NotificationsService) {}

  private expireStale() {
    return this.prisma.pharmaOrder.updateMany({
      where: { status: 'quoted', quotedAt: { lt: new Date(Date.now() - QUOTE_TTL_MS) } },
      data: { status: 'expired' },
    });
  }

  private async asPharma(req: any, id: string) {
    await this.expireStale();
    const o = await this.prisma.pharmaOrder.findUnique({ where: { id }, include: { pharma: true } });
    if (!o || o.pharma.userId !== req.user.id) throw new NotFoundException('Order not found');
    return o;
  }

  private async asUser(req: any, id: string) {
    await this.expireStale();
    const o = await this.prisma.pharmaOrder.findUnique({ where: { id } });
    if (!o || o.userId !== req.user.id) throw new NotFoundException('Order not found');
    return o;
  }

  @Post() @Roles(Role.USER)
  async create(@Req() req: any, @Body() b: CreateOrderDto) {
    const pharma = await this.prisma.pharmaProfile.findUnique({ where: { id: b.pharmaId } });
    if (!pharma) throw new NotFoundException('Pharmacy not found');
    const o = await this.prisma.pharmaOrder.create({
      data: { userId: req.user.id, pharmaId: b.pharmaId, items: b.items as any },
    });
    await this.notifications.notify(pharma.userId, 'New medicine request', `${b.items.length} item(s) requested.`);
    return o;
  }

  @Get('my')
  async mine(@Req() req: any) {
    await this.expireStale();
    return this.prisma.pharmaOrder.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } });
  }

  @Get('incoming') @Roles(Role.PHARMA)
  async incoming(@Req() req: any) {
    await this.expireStale();
    return this.prisma.pharmaOrder.findMany({
      where: { pharma: { userId: req.user.id } },
      include: { user: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async one(@Req() req: any, @Param('id') id: string) {
    await this.expireStale();
    const o = await this.prisma.pharmaOrder.findUnique({ where: { id }, include: { pharma: true } });
    if (!o || (o.userId !== req.user.id && o.pharma.userId !== req.user.id)) throw new NotFoundException('Order not found');
    return o;
  }

  @Post(':id/quote') @Roles(Role.PHARMA)
  async quote(@Req() req: any, @Param('id') id: string, @Body() b: QuoteDto) {
    const o = await this.asPharma(req, id);
    if (o.status !== 'requested') throw new BadRequestException(`Order is ${o.status}`);
    const totalPaise = b.items.reduce((s, i) => s + i.qty * i.unitPricePaise, 0);
    const u = await this.prisma.pharmaOrder.update({
      where: { id },
      data: { status: 'quoted', quotedItems: b.items as any, totalPaise, quotedAt: new Date() },
    });
    await this.notifications.notify(o.userId, 'Quote received', 'Your pharmacy has quoted your order. Pay within 24 hours.');
    return u;
  }

  @Post(':id/reject') @Roles(Role.PHARMA)
  async reject(@Req() req: any, @Param('id') id: string) {
    const o = await this.asPharma(req, id);
    if (o.status !== 'requested') throw new BadRequestException(`Order is ${o.status}`);
    const u = await this.prisma.pharmaOrder.update({ where: { id }, data: { status: 'rejected' } });
    await this.notifications.notify(o.userId, 'Order rejected', 'The pharmacy could not fulfil your request.');
    return u;
  }

  @Post(':id/pay') @Roles(Role.USER)
  async pay(@Req() req: any, @Param('id') id: string) {
    await this.asUser(req, id);
    return this.payments.createOrder(req.user.id, 'PHARMA_ORDER', id);
  }

  @Patch(':id/cancel') @Roles(Role.USER)
  async cancel(@Req() req: any, @Param('id') id: string) {
    const o = await this.asUser(req, id);
    if (o.status !== 'requested' && o.status !== 'quoted') throw new BadRequestException(`Cannot cancel an order that is ${o.status}`);
    return this.prisma.pharmaOrder.update({ where: { id }, data: { status: 'cancelled' } });
  }

  @Patch(':id/status') @Roles(Role.PHARMA)
  async setStatus(@Req() req: any, @Param('id') id: string, @Body() b: StatusDto) {
    const o = await this.asPharma(req, id);
    assertTransition(PHARMA_FLOW, o.status, b.status);
    const u = await this.prisma.pharmaOrder.update({ where: { id }, data: { status: b.status as any } });
    await this.notifications.notify(o.userId, 'Order update', b.status === 'ready' ? 'Your order is ready for pickup.' : 'Your order is completed.');
    return u;
  }
}
