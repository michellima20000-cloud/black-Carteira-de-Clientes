export const QUEUE_NAMES = {
  incomingMessages: 'incoming-messages',
  outgoingMessages: 'outgoing-messages',
  imports: 'imports',
  goalRecalculation: 'goal-recalc',
  inactiveScan: 'inactive-scan',
  deadLetter: 'dead-letter',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const DOMAIN_QUEUE_NAMES = [
  QUEUE_NAMES.incomingMessages,
  QUEUE_NAMES.outgoingMessages,
  QUEUE_NAMES.imports,
  QUEUE_NAMES.goalRecalculation,
  QUEUE_NAMES.inactiveScan,
] as const;

export type DomainQueueName = (typeof DOMAIN_QUEUE_NAMES)[number];
