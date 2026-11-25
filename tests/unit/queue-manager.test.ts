import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_JOB_OPTIONS,
  QueueManager,
  type QueueAdapter,
} from '../../src/shared/queues/queue-manager';
import { QUEUE_NAMES, type QueueName } from '../../src/shared/queues/queue-names';
import { shouldMoveToDeadLetter } from '../../src/worker/runtime';

function createMemoryQueueAdapter(): { adapter: QueueAdapter; addMock: ReturnType<typeof vi.fn> } {
  const jobs = new Map<
    string,
    { id: string; name: string; data: unknown; timestamp: number; remove: () => Promise<void> }
  >();
  let seq = 0;

  const addMock = vi.fn((name: string, data: unknown) => {
    seq += 1;
    const id = String(seq);
    jobs.set(id, {
      id,
      name,
      data,
      timestamp: Date.now(),
      remove: () => {
        jobs.delete(id);
        return Promise.resolve();
      },
    });
    return Promise.resolve({ id });
  });

  const adapter: QueueAdapter = {
    add: addMock,
    getJobCounts: vi.fn(() =>
      Promise.resolve({
        waiting: jobs.size,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      }),
    ),
    getJobs: vi.fn(() => Promise.resolve([...jobs.values()])),
    getJob: vi.fn((jobId: string) => Promise.resolve(jobs.get(jobId) ?? null)),
    close: vi.fn(() => Promise.resolve()),
  };

  return { adapter, addMock };
}

describe('QueueManager e políticas de retry/DLQ', () => {
  it('enfileira job com política padrão de retries exponenciais', async () => {
    const { adapter, addMock } = createMemoryQueueAdapter();
    const manager = new QueueManager({}, () => adapter);

    const result = await manager.enqueue(QUEUE_NAMES.inactiveScan, 'scan', {
      accountId: 'acc-1',
      days: 30,
    });

    expect(result.jobId).toBe('1');
    expect(addMock).toHaveBeenCalledWith(
      'scan',
      { accountId: 'acc-1', days: 30 },
      DEFAULT_JOB_OPTIONS,
    );
  });

  it('isola listagem e reprocessamento da dead-letter por accountId', async () => {
    const adapters = new Map<QueueName, QueueAdapter>();
    const manager = new QueueManager({}, (name) => {
      const existing = adapters.get(name);
      if (existing) return existing;
      const { adapter } = createMemoryQueueAdapter();
      adapters.set(name, adapter);
      return adapter;
    });

    await manager.moveToDeadLetter({
      sourceQueue: QUEUE_NAMES.goalRecalculation,
      jobId: 'job-a',
      jobName: 'recalc',
      accountId: 'acc-a',
      payload: { accountId: 'acc-a', month: '2026-11', reason: 'sale-change' },
      failedReason: 'Erro transitório',
      attemptsMade: 5,
      failedAt: new Date().toISOString(),
    });

    await manager.moveToDeadLetter({
      sourceQueue: QUEUE_NAMES.goalRecalculation,
      jobId: 'job-b',
      jobName: 'recalc',
      accountId: 'acc-b',
      payload: { accountId: 'acc-b', month: '2026-11', reason: 'sale-change' },
      failedReason: 'Erro B',
      attemptsMade: 5,
      failedAt: new Date().toISOString(),
    });

    const listA = await manager.listDeadLetters('acc-a');
    expect(listA).toHaveLength(1);
    const entryA = listA[0];
    expect(entryA?.data.jobId).toBe('job-a');

    const crossRequeue = await manager.requeueDeadLetter(entryA!.id, 'acc-b');
    expect(crossRequeue).toBeNull();

    const requeuedA = await manager.requeueDeadLetter(entryA!.id, 'acc-a');
    expect(requeuedA).toEqual({
      requeuedJobId: '1',
      sourceQueue: QUEUE_NAMES.goalRecalculation,
    });
    expect(await manager.listDeadLetters('acc-a')).toHaveLength(0);
  });

  it('move para dead-letter apenas ao esgotar as tentativas', () => {
    expect(shouldMoveToDeadLetter(1, 5)).toBe(false);
    expect(shouldMoveToDeadLetter(4, 5)).toBe(false);
    expect(shouldMoveToDeadLetter(5, 5)).toBe(true);
    expect(shouldMoveToDeadLetter(1, undefined)).toBe(true);
  });
});
