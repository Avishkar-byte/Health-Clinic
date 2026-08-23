import { Controller, Get, Post, Param } from '@nestjs/common';
import { Auth } from '../auth/auth.decorator';
import { NotificationsService } from './notifications.service';

@Controller('admin/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('dead')
  @Auth('admin')
  getDeadNotifications() {
    return this.notifications.getDeadNotifications();
  }

  @Post(':id/retry')
  @Auth('admin')
  retryNotification(@Param('id') id: string) {
    return this.notifications.retryNotification(id);
  }

  @Get('stats')
  @Auth('admin')
  getQueueStats() {
    return this.notifications.getQueueStats();
  }
}
