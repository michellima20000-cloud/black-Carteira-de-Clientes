import type { GoalDistributionMode } from '@prisma/client';

export interface CustomerHistoricalInput {
  id: string;
  historicalAmount: number;
}

export interface DistributedCustomerGoal {
  customerId: string;
  amount: number;
}

export interface GoalProgress {
  remainingAmount: number;
  completionPercentage: number;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseGoalMonth(month: string): Date {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month.trim());
  if (!match) {
    throw new Error('Mês inválido. Use o formato YYYY-MM.');
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return new Date(Date.UTC(year, monthIndex, 1));
}

export function formatGoalMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getMonthDateRange(monthDate: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
  const end = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1));
  return { start, end };
}

export function getCurrentGoalMonthString(now: Date = new Date()): string {
  return formatGoalMonth(now);
}

/**
 * Distributes `totalAmount` across `customers` using integer cents
 * so the sum of all customer goals equals `totalAmount` exactly.
 */
export function distributeGoalAmount(
  totalAmount: number,
  customers: readonly CustomerHistoricalInput[],
  mode: GoalDistributionMode,
): DistributedCustomerGoal[] {
  if (customers.length === 0) return [];

  const totalCents = Math.round(totalAmount * 100);

  if (mode === 'EQUAL') {
    return distributeEqually(totalCents, customers);
  }

  const historicalCents = customers.map((customer) =>
    Math.max(0, Math.round(customer.historicalAmount * 100)),
  );
  const sumHistoricalCents = historicalCents.reduce((sum, value) => sum + value, 0);

  if (sumHistoricalCents <= 0) {
    return distributeEqually(totalCents, customers);
  }

  const allocations = customers.map((customer, index) => {
    const exactNumerator = totalCents * historicalCents[index]!;
    const baseCents = Math.floor(exactNumerator / sumHistoricalCents);
    const remainderNumerator = exactNumerator % sumHistoricalCents;
    return {
      customerId: customer.id,
      index,
      cents: baseCents,
      remainderNumerator,
    };
  });

  const allocatedCents = allocations.reduce((sum, item) => sum + item.cents, 0);
  let remainingCents = totalCents - allocatedCents;

  const sortedForRemainder = [...allocations].sort((a, b) => {
    if (b.remainderNumerator !== a.remainderNumerator) {
      return b.remainderNumerator - a.remainderNumerator;
    }
    return a.index - b.index;
  });

  for (let i = 0; i < sortedForRemainder.length && remainingCents > 0; i += 1) {
    sortedForRemainder[i]!.cents += 1;
    remainingCents -= 1;
  }

  return allocations.map((item) => ({
    customerId: item.customerId,
    amount: item.cents / 100,
  }));
}

function distributeEqually(
  totalCents: number,
  customers: readonly CustomerHistoricalInput[],
): DistributedCustomerGoal[] {
  const count = customers.length;
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents % count;

  return customers.map((customer, index) => ({
    customerId: customer.id,
    amount: (baseCents + (index < remainder ? 1 : 0)) / 100,
  }));
}

export function calculateGoalProgress(targetAmount: number, realizedAmount: number): GoalProgress {
  const remainingAmount = Math.max(0, round2(targetAmount - realizedAmount));
  const completionPercentage = targetAmount > 0 ? round2((realizedAmount / targetAmount) * 100) : 0;
  return { remainingAmount, completionPercentage };
}
