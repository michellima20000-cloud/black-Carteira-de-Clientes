import { describe, expect, it } from 'vitest';
import {
  calculateGoalProgress,
  distributeGoalAmount,
  getMonthDateRange,
  parseGoalMonth,
} from '../../src/modules/goals/goal.calculator';

describe('goal calculator', () => {
  it('faz parse do mês YYYY-MM e calcula o intervalo do mês em UTC', () => {
    const monthDate = parseGoalMonth('2026-11');
    const range = getMonthDateRange(monthDate);

    expect(monthDate.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(range.start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('distribui igualmente mantendo a soma exata em centavos', () => {
    const distributed = distributeGoalAmount(
      100,
      [
        { id: 'c1', historicalAmount: 0 },
        { id: 'c2', historicalAmount: 0 },
        { id: 'c3', historicalAmount: 0 },
      ],
      'EQUAL',
    );

    expect(distributed).toEqual([
      { customerId: 'c1', amount: 33.34 },
      { customerId: 'c2', amount: 33.33 },
      { customerId: 'c3', amount: 33.33 },
    ]);
  });

  it('distribui proporcionalmente ao histórico com fechamento exato em centavos', () => {
    const distributed = distributeGoalAmount(
      1000,
      [
        { id: 'c1', historicalAmount: 300 },
        { id: 'c2', historicalAmount: 100 },
      ],
      'HISTORICAL',
    );

    expect(distributed).toEqual([
      { customerId: 'c1', amount: 750 },
      { customerId: 'c2', amount: 250 },
    ]);
  });

  it('faz fallback para distribuição igual quando histórico total é zero', () => {
    const distributed = distributeGoalAmount(
      200,
      [
        { id: 'c1', historicalAmount: 0 },
        { id: 'c2', historicalAmount: 0 },
      ],
      'HISTORICAL',
    );

    expect(distributed).toEqual([
      { customerId: 'c1', amount: 100 },
      { customerId: 'c2', amount: 100 },
    ]);
  });

  it('calcula progresso e valor restante corretamente', () => {
    expect(calculateGoalProgress(1000, 250)).toEqual({
      remainingAmount: 750,
      completionPercentage: 25,
    });
    expect(calculateGoalProgress(1000, 1250)).toEqual({
      remainingAmount: 0,
      completionPercentage: 125,
    });
  });
});
