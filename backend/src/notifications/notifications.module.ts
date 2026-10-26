import { Global, Module } from '@nestjs/common';
import { FcmSender } from './fcm.sender';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PUSH_SENDER } from './push';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, { provide: PUSH_SENDER, useClass: FcmSender }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
