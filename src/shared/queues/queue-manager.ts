import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import type { AnyQueuePayload, DeadLetterJobData, QueuePayloadMap } from './job-contracts';
import {
  DOMAIN_QUEUE_NAMES,
  QUEUE_NAMES,
  type DomainQueueName,
  type QueueName,
} from './queue-names';

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2_000,
  },
  removeOnComplete: {
    count: 500,
    age: 86_400,
  },
  removeOnFail: {
    count: 1_000,
  },
};

export const DEAD_LETTER_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: false,
  removeOnFail: false,
};

export interface QueueMetric {
  queue: QueueName;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface DeadLetterEntry {
  id: string;
  name: string;
  data: DeadLetterJobData;
  timestamp: number;
}

export interface QueueAdapter {
  add(name: string, data: unknown, opts?: JobsOptions): Promise<{ id?: string | undefined }>;
  getJobCounts(
    ...types: Array<'waiting' | 'active' | 'completed' | 'failed' | 'delayed'>
  ): Promise<Record<string, number>>;
  getJobs(
    types: Array<'waiting' | 'active' | 'completed' | 'failed' | 'delayed'>,
    start?: number,
    end?: number,
  ): Promise<
    Array<{
      id?: string | undefined;
      name: string;
      data: unknown;
      timestamp: number;
      remove(): Promise<void>;
    }>
  >;
  getJob(jobId: string): Promise<{
    id?: string | undefined;
    name: string;
    data: unknown;
    timestamp: number;
    remove(): Promise<void>;
  } | null>;
  close(): Promise<void>;
}

export type QueueFactory = (name: QueueName) => QueueAdapter;

export class QueueManager {
  private readonly queues = new Map<QueueName, QueueAdapter>();

  constructor(
    private readonly connection: ConnectionOptions,
    private readonly queueFactory?: QueueFactory,
  ) {}

  getQueue(name: QueueName): QueueAdapter {
    const existing = this.queues.get(name);
    if (existing) return existing;

    const created: QueueAdapter = this.queueFactory
      ? this.queueFactory(name)
      : (new Queue(name, {
          connection: this.connection,
          defaultJobOptions:
            name === QUEUE_NAMES.deadLetter ? DEAD_LETTER_JOB_OPTIONS : DEFAULT_JOB_OPTIONS,
        }) as unknown as QueueAdapter);

    this.queues.set(name, created);
    return created;
  }

  async enqueue<K extends DomainQueueName>(
    queueName: K,
    jobName: string,
    data: AnyQueuePayload<K>,
    opts?: JobsOptions,
  ): Promise<{ jobId: string | undefined }> {
    const queue = this.getQueue(queueName);
    const job = await queue.add(jobName, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...opts,
    });
    return { jobId: job.id };
  }

  async moveToDeadLetter(data: DeadLetterJobData): Promise<{ jobId: string | undefined }> {
    const dlq = this.getQueue(QUEUE_NAMES.deadLetter);
    const job = await dlq.add(
      `dlq:${data.sourceQueue}:${data.jobName}`,
      data,
      DEAD_LETTER_JOB_OPTIONS,
    );
    return { jobId: job.id };
  }

  async getMetrics(): Promise<QueueMetric[]> {
    const allQueues: QueueName[] = [...DOMAIN_QUEUE_NAMES, QUEUE_NAMES.deadLetter];
    const metrics = await Promise.all(
      allQueues.map(async (queueName) => {
        const counts = await this.getQueue(queueName).getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
        );
        return {
          queue: queueName,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        };
      }),
    );
    return metrics;
  }

  async listDeadLetters(accountId: string, start = 0, end = 49): Promise<DeadLetterEntry[]> {
    const dlq = this.getQueue(QUEUE_NAMES.deadLetter);
    const jobs = await dlq.getJobs(['waiting', 'delayed', 'failed'], start, end);

    return jobs
      .map((job) => ({
        id: job.id ?? '',
        name: job.name,
        data: job.data as DeadLetterJobData,
        timestamp: job.timestamp,
      }))
      .filter((entry) => entry.data?.accountId === accountId);
  }

  async requeueDeadLetter(
    deadLetterJobId: string,
    accountId: string,
  ): Promise<{ requeuedJobId: string | undefined; sourceQueue: DomainQueueName } | null> {
    const dlq = this.getQueue(QUEUE_NAMES.deadLetter);
    const job = await dlq.getJob(deadLetterJobId);
    if (!job) return null;

    const data = job.data as DeadLetterJobData;
    if (data.accountId !== accountId) return null;

    const { jobId } = await this.enqueue(
      data.sourceQueue,
      data.jobName,
      data.payload as QueuePayloadMap[typeof data.sourceQueue],
    );
    await job.remove();

    return {
      requeuedJobId: jobId,
      sourceQueue: data.sourceQueue,
    };
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }
}
