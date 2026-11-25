import type { DomainQueueName, QueueName } from './queue-names';

export interface IncomingMessageJobData {
  accountId: string;
  provider: string;
  externalMessageId: string;
  fromPhone: string;
  body: string;
  receivedAt: string;
}

export interface OutgoingMessageJobData {
  accountId: string;
  conversationId: string;
  messageId: string;
  toPhone: string;
  body: string;
}

export interface ImportJobData {
  accountId: string;
  actorUserId: string;
  filename: string;
  contentBase64: string;
  skipInvalid: boolean;
  updateExistingCustomers: boolean;
}

export interface GoalRecalculationJobData {
  accountId: string;
  month: string;
  reason: 'sale-change' | 'manual';
}

export interface InactiveScanJobData {
  accountId: string;
  days: number;
  actorUserId?: string | undefined;
}

export interface DeadLetterJobData {
  sourceQueue: DomainQueueName;
  jobId: string;
  jobName: string;
  accountId: string;
  payload: unknown;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

export interface QueuePayloadMap {
  'incoming-messages': IncomingMessageJobData;
  'outgoing-messages': OutgoingMessageJobData;
  imports: ImportJobData;
  'goal-recalc': GoalRecalculationJobData;
  'inactive-scan': InactiveScanJobData;
  'dead-letter': DeadLetterJobData;
}

export type AnyQueuePayload<K extends QueueName> = QueuePayloadMap[K];
