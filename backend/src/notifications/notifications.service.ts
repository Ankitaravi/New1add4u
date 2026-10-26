import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_SENDER, PushSender } from './push';

@Injectable()
export class NotificationsService {
  private log = new Logger(NotificationsService.name);
  constructor(private prisma: PrismaService, @Inject(PUSH_SENDER) private push: PushSender) {}

  /** Stores an in-app notification and pushes to the user's devices. Never throws: a push
   *  failure must not fail the business action that triggered it. */
  async notify(userId: string, title: string, body: string) {
    try {
      await this.prisma.notification.create({ data: { userId, title, body } });
      const devices = await this.prisma.deviceToken.findMany({ where: { userId } });
      const dead = await this.push.send(devices.map((d) => d.token), title, body);
      if (dead.length) await this.prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
    } catch (e: any) {
      this.log.warn(`notify(${userId}) failed: ${e?.message}`);
    }
  }
}
