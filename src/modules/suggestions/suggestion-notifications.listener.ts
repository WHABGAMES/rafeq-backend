import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserStatus } from '../../database/entities/user.entity';
import { MailService } from '../mail/mail.service';
import { SuggestionFollower } from './entities/suggestion-follower.entity';

interface SuggestionUpdateEvent {
  suggestionId: string;
  suggestionTitle: string;
  commenterId?: string;
  newStatus?: string;
}

const STATUS_LABELS: Record<string, string> = {
  under_review: 'قيد المراجعة',
  under_study: 'قيد الدراسة',
  in_progress: 'قيد التنفيذ',
  completed: 'تم التنفيذ',
  rejected: 'مرفوض',
};

@Injectable()
export class SuggestionNotificationsListener {
  private readonly logger = new Logger(SuggestionNotificationsListener.name);

  constructor(
    @InjectRepository(SuggestionFollower)
    private readonly followerRepo: Repository<SuggestionFollower>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent('suggestion.admin_replied', { async: true })
  async onAdminReply(event: SuggestionUpdateEvent): Promise<void> {
    await this.notifyFollowers(
      event,
      'رد جديد من فريق رفيق',
      `أضاف فريق رفيق رداً جديداً على الاقتراح: ${event.suggestionTitle}`,
    );
  }

  @OnEvent('suggestion.status_changed', { async: true })
  async onStatusChanged(event: SuggestionUpdateEvent): Promise<void> {
    const status = STATUS_LABELS[event.newStatus || ''] || event.newStatus || 'محدّثة';
    await this.notifyFollowers(
      event,
      'تحديث حالة اقتراح',
      `تم تحديث حالة الاقتراح «${event.suggestionTitle}» إلى: ${status}`,
    );
  }

  private async notifyFollowers(event: SuggestionUpdateEvent, subject: string, message: string) {
    const followers = await this.followerRepo.find({
      where: { suggestionId: event.suggestionId },
      select: ['merchantId'],
    });
    const userIds = [...new Set(followers.map(item => item.merchantId))]
      .filter(id => id !== event.commenterId);
    if (userIds.length === 0) return;

    const users = await this.userRepo.find({
      where: { id: In(userIds), status: UserStatus.ACTIVE },
      select: ['id', 'email', 'firstName'],
    });
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'https://rafeq.ai').replace(/\/$/, '');
    const actionUrl = `${frontendUrl}/dashboard/suggestions`;
    const safeMessage = this.escapeHtml(message);

    let failures = 0;
    const batchSize = 10;
    for (let offset = 0; offset < users.length; offset += batchSize) {
      const batch = users.slice(offset, offset + batchSize);
      const results = await Promise.allSettled(batch.map(user => this.mailService.sendMail({
        to: user.email,
        subject: `${subject} | رفيق`,
        html: `<p>مرحباً ${this.escapeHtml(user.firstName || '')}</p><p>${safeMessage}</p><p><a href="${actionUrl}">عرض الاقتراحات</a></p>`,
      })));
      failures += results.filter(result =>
        result.status === 'rejected' || (result.status === 'fulfilled' && result.value === false),
      ).length;
    }
    if (failures > 0) {
      this.logger.warn(`Failed to dispatch ${failures} suggestion follower notification(s)`);
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[character] || character);
  }
}
