import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get dead notifications — admin dashboard queue.
   */
  async getDeadNotifications() {
    return this.prisma.notification.findMany({
      where: { status: 'dead' },
      include: {
        recipient: { select: { fullName: true, email: true } },
        appointment: { select: { id: true } },
      },
      orderBy: { nextRetryAt: 'desc' },
    });
  }

  /**
   * Retry a dead notification.
   */
  async retryNotification(notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Notification not found' });
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'queued',
        attemptCount: 0,
        lastError: null,
        nextRetryAt: new Date(),
      },
    });

    return { success: true };
  }

  /**
   * Get queue depth stats.
   */
  async getQueueStats() {
    const [queued, sent, failed, dead] = await Promise.all([
      this.prisma.notification.count({ where: { status: 'queued' } }),
      this.prisma.notification.count({ where: { status: 'sent' } }),
      this.prisma.notification.count({ where: { status: 'failed' } }),
      this.prisma.notification.count({ where: { status: 'dead' } }),
    ]);

    return { queued, sent, failed, dead };
  }
}
