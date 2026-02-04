// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 FIX M2: Tenant Isolation
//
// استبدل الدوال التالية في src/modules/webhooks/salla-webhooks.service.ts
// ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔧 FIX M2: updateStatus مع فحص tenantId
   */
  async updateStatus(
    webhookEventId: string,
    status: WebhookStatus,
    options?: {
      errorMessage?: string;
      processingResult?: Record<string, unknown>;
      processingDurationMs?: number;
    },
    tenantId?: string, // 🔧 FIX M2: إضافة tenantId اختياري للتحقق
  ): Promise<void> {
    // بناء شرط البحث
    const whereCondition: Record<string, unknown> = { id: webhookEventId };
    if (tenantId) {
      whereCondition.tenantId = tenantId; // 🔧 FIX M2: tenant isolation
    }

    const event = await this.webhookEventRepository.findOne({
      where: whereCondition,
    });

    if (!event) {
      this.logger.warn(`Webhook event not found: ${webhookEventId}`);
      return;
    }

    event.status = status;

    if (status === WebhookStatus.PROCESSED) {
      event.processedAt = new Date();
    }

    if (options?.errorMessage) {
      event.errorMessage = options.errorMessage;
    }

    if (options?.processingResult) {
      event.processingResult = options.processingResult;
    }

    if (options?.processingDurationMs) {
      event.processingDurationMs = options.processingDurationMs;
    }

    await this.webhookEventRepository.save(event);
  }

  /**
   * 🔧 FIX M2: retryWebhook مع فحص tenantId إجباري
   * لا يمكن لـ Tenant A إعادة محاولة webhook الخاص بـ Tenant B
   */
  async retryWebhook(webhookEventId: string, tenantId: string): Promise<string> {
    const event = await this.webhookEventRepository.findOne({
      where: {
        id: webhookEventId,
        tenantId, // 🔧 FIX M2: tenant isolation
      },
    });

    if (!event) {
      throw new Error('Webhook event not found or access denied');
    }

    const job = await this.webhookQueue.add(
      event.eventType,
      {
        webhookEventId: event.id,
        eventType: event.eventType,
        data: event.payload,
        tenantId: event.tenantId,
        storeId: event.storeId,
        isRetry: true,
      },
      { priority: 1 },
    );

    if (event.tenantId) {
      await this.createLog(event.id, event.tenantId, {
        action: WebhookLogAction.MANUALLY_RETRIED,
        previousStatus: event.status as WebhookStatus,
        newStatus: WebhookStatus.RETRY_PENDING,
        message: 'Manual retry requested',
      });
    }

    await this.updateStatus(webhookEventId, WebhookStatus.RETRY_PENDING);

    return job.id as string;
  }

  /**
   * 🔧 FIX M2: getFailedWebhooks يتطلب tenantId (موجود أصلاً - تأكيد)
   */
  async getFailedWebhooks(tenantId: string, limit: number = 50): Promise<WebhookEvent[]> {
    return this.webhookEventRepository.find({
      where: {
        tenantId, // ✅ tenant isolation موجود
        status: WebhookStatus.FAILED,
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 🔧 FIX M2: getStatistics يتطلب tenantId (موجود أصلاً - تأكيد)
   */
  async getStatistics(tenantId: string, days: number = 7): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byEventType: Record<string, number>;
    averageProcessingTime: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const events = await this.webhookEventRepository
      .createQueryBuilder('event')
      .where('event.tenantId = :tenantId', { tenantId }) // ✅ tenant isolation
      .andWhere('event.createdAt >= :startDate', { startDate })
      .select(['event.status', 'event.eventType', 'event.processingDurationMs'])
      .getMany();

    const byStatus: Record<string, number> = {};
    const byEventType: Record<string, number> = {};
    let totalProcessingTime = 0;
    let processedCount = 0;

    for (const event of events) {
      byStatus[event.status] = (byStatus[event.status] || 0) + 1;
      byEventType[event.eventType] = (byEventType[event.eventType] || 0) + 1;

      if (event.processingDurationMs) {
        totalProcessingTime += event.processingDurationMs;
        processedCount++;
      }
    }

    return {
      total: events.length,
      byStatus,
      byEventType,
      averageProcessingTime: processedCount > 0
        ? Math.round(totalProcessingTime / processedCount)
        : 0,
    };
  }
