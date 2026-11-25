import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { ImportService } from '../modules/imports/import.service';
import type { DatabaseClient } from '../shared/db/prisma';
import { TenantStore } from '../shared/db/tenant-store';
import type {
  GoalRecalculationJobData,
  ImportJobData,
  InactiveScanJobData,
  IncomingMessageJobData,
  OutgoingMessageJobData,
} from '../shared/queues/job-contracts';
import { QueueManager } from '../shared/queues/queue-manager';
import { QUEUE_NAMES, type DomainQueueName } from '../shared/queues/queue-names';

export interface WorkerRuntimeOptions {
  connection: ConnectionOptions;
  database: DatabaseClient;
  concurrency?: number;
}

export interface WorkerRuntime {
  workers: Worker[];
  queueManager: QueueManager;
  close(): Promise<void>;
}

export function shouldMoveToDeadLetter(attemptsMade: number, configuredAttempts?: number): boolean {
  const maxAttempts = configuredAttempts ?? 1;
  return attemptsMade >= maxAttempts;
}

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const concurrency = options.concurrency ?? 5;
  const queueManager = new QueueManager(options.connection);
  const importService = new ImportService();

  const attachFailureHandler = <T extends { accountId: string }>(
    worker: Worker<T>,
    sourceQueue: DomainQueueName,
  ): Worker<T> => {
    worker.on('failed', (job: Job<T> | undefined, error: Error) => {
      if (!job) return;
      console.error(
        {
          queue: sourceQueue,
          jobId: job.id,
          accountId: job.data?.accountId,
          attemptsMade: job.attemptsMade,
          err: error.message,
        },
        'Falha ao processar job',
      );

      if (shouldMoveToDeadLetter(job.attemptsMade, job.opts.attempts)) {
        void queueManager
          .moveToDeadLetter({
            sourceQueue,
            jobId: job.id ?? 'unknown',
            jobName: job.name,
            accountId: job.data.accountId,
            payload: job.data,
            failedReason: error.message,
            attemptsMade: job.attemptsMade,
            failedAt: new Date().toISOString(),
          })
          .catch((dlqError: unknown) => {
            console.error({ err: dlqError, jobId: job.id }, 'Erro ao enviar job para dead-letter');
          });
      }
    });
    return worker;
  };

  const importsWorker = attachFailureHandler(
    new Worker<ImportJobData>(
      QUEUE_NAMES.imports,
      async (job) => {
        const store = new TenantStore(options.database, job.data.accountId);
        const buffer = Buffer.from(job.data.contentBase64, 'base64');
        return importService.commit(
          store,
          buffer,
          job.data.filename,
          {
            skipInvalid: job.data.skipInvalid,
            updateExistingCustomers: job.data.updateExistingCustomers,
          },
          job.data.actorUserId,
        );
      },
      { connection: options.connection, concurrency: 2 },
    ),
    QUEUE_NAMES.imports,
  );

  const goalRecalcWorker = attachFailureHandler(
    new Worker<GoalRecalculationJobData>(
      QUEUE_NAMES.goalRecalculation,
      async (job) => {
        const store = new TenantStore(options.database, job.data.accountId);
        const dashboard = await store.getMonthlyGoalDashboard(job.data.month);
        return {
          month: dashboard.month,
          totalRealizedAmount: dashboard.summary.totalRealizedAmount,
        };
      },
      { connection: options.connection, concurrency },
    ),
    QUEUE_NAMES.goalRecalculation,
  );

  const inactiveScanWorker = attachFailureHandler(
    new Worker<InactiveScanJobData>(
      QUEUE_NAMES.inactiveScan,
      async (job) => {
        const store = new TenantStore(options.database, job.data.accountId);
        const result = await store.listInactiveCustomers({
          days: job.data.days,
          includeNeverPurchased: true,
          page: 1,
          pageSize: 100,
        });
        return {
          accountId: job.data.accountId,
          days: job.data.days,
          inactiveCount: result.total,
        };
      },
      { connection: options.connection, concurrency },
    ),
    QUEUE_NAMES.inactiveScan,
  );

  const incomingMessagesWorker = attachFailureHandler(
    new Worker<IncomingMessageJobData>(
      QUEUE_NAMES.incomingMessages,
      (job) => {
        // Implementação completa de atendimento entra na Fase 5
        return Promise.resolve({
          accepted: true,
          accountId: job.data.accountId,
          externalMessageId: job.data.externalMessageId,
        });
      },
      { connection: options.connection, concurrency },
    ),
    QUEUE_NAMES.incomingMessages,
  );

  const outgoingMessagesWorker = attachFailureHandler(
    new Worker<OutgoingMessageJobData>(
      QUEUE_NAMES.outgoingMessages,
      (job) => {
        // Implementação completa de envio WhatsApp entra na Fase 5
        return Promise.resolve({
          accepted: true,
          accountId: job.data.accountId,
          messageId: job.data.messageId,
        });
      },
      { connection: options.connection, concurrency },
    ),
    QUEUE_NAMES.outgoingMessages,
  );

  const workers: Worker[] = [
    importsWorker,
    goalRecalcWorker,
    inactiveScanWorker,
    incomingMessagesWorker,
    outgoingMessagesWorker,
  ];

  return {
    workers,
    queueManager,
    async close(): Promise<void> {
      await Promise.all(workers.map((worker) => worker.close()));
      await queueManager.close();
    },
  };
}
