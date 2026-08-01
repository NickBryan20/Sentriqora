import type { Logger } from 'pino';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';

import { withTenantTransaction } from './database';
import { recordNotificationDelivery } from './detection.metrics';
import type { NotificationJob } from './outbox-dispatcher';

interface NotificationRow {
  body: string;
  channel: 'EMAIL' | 'INTERNAL';
  email: string | null;
  incident_id: string | null;
  status: 'FAILED' | 'PENDING' | 'SENT';
  title: string;
  type: string;
}

export interface EmailNotificationAdapter {
  send(input: { recipient: string; subject: string; text: string }): Promise<void>;
}

export class LogEmailNotificationAdapter implements EmailNotificationAdapter {
  constructor(private readonly logger: Logger) {}

  send(input: { recipient: string; subject: string; text: string }): Promise<void> {
    this.logger.info(
      {
        recipientHash: createHash('sha256').update(input.recipient).digest('hex').slice(0, 12),
        subjectLength: input.subject.length,
        textLength: input.text.length,
      },
      'Development email notification delivered',
    );
    return Promise.resolve();
  }
}

export class NotificationProcessor {
  constructor(
    private readonly pool: Pool,
    private readonly email: EmailNotificationAdapter,
    private readonly logger: Logger,
  ) {}

  process(job: NotificationJob): Promise<{ delivered: boolean }> {
    return withTenantTransaction(this.pool, job.organizationId, async (client) => {
      const result = await client.query<NotificationRow>(
        `SELECT notification.channel, notification.type, notification.title, notification.body,
                notification.status, notification.incident_id, user_account.email
         FROM notifications AS notification
         LEFT JOIN memberships AS membership
           ON membership.id = notification.recipient_membership_id
          AND membership.organization_id = notification.organization_id
         LEFT JOIN users AS user_account ON user_account.id = membership.user_id
         WHERE notification.organization_id = $1 AND notification.id = $2`,
        [job.organizationId, job.notificationId],
      );
      const notification = result.rows[0];
      if (notification === undefined) return { delivered: false };
      if (notification.status === 'SENT') return { delivered: true };
      try {
        if (notification.channel === 'EMAIL') {
          if (notification.email === null) throw new Error('NotificationRecipientMissing');
          await this.email.send({
            recipient: notification.email,
            subject: notification.title,
            text: notification.body,
          });
        }
        await client.query(
          `UPDATE notifications SET status = 'SENT', attempt_count = attempt_count + 1,
             sent_at = now(), last_error_code = NULL, updated_at = now()
           WHERE organization_id = $1 AND id = $2 AND status <> 'SENT'`,
          [job.organizationId, job.notificationId],
        );
        if (notification.incident_id !== null) {
          const key = createHash('sha256')
            .update(`notification:${job.notificationId}`)
            .digest('hex');
          await client.query(
            `INSERT INTO incident_timeline_entries (
               organization_id, incident_id, type, title, detail, idempotency_key
             ) VALUES ($1, $2, 'NOTIFICATION_SENT', 'Notification delivered', $3, $4)
             ON CONFLICT (organization_id, incident_id, idempotency_key) DO NOTHING`,
            [
              job.organizationId,
              notification.incident_id,
              `${notification.channel} ${notification.type}`,
              key,
            ],
          );
        }
        recordNotificationDelivery(notification.channel, 'success');
        return { delivered: true };
      } catch (error) {
        const code = error instanceof Error ? error.name : 'UnknownError';
        await client.query(
          `UPDATE notifications SET status = 'FAILED', attempt_count = attempt_count + 1,
             last_error_code = $3, updated_at = now()
           WHERE organization_id = $1 AND id = $2`,
          [job.organizationId, job.notificationId, code.slice(0, 100)],
        );
        recordNotificationDelivery(notification.channel, 'failed');
        this.logger.warn(
          { errorName: code, notificationId: job.notificationId },
          'Notification delivery failed',
        );
        throw error;
      }
    });
  }
}
