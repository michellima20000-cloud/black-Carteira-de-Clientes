import {
  Prisma,
  type AuditAction,
  type ConversationStatus,
  type CustomerStatus,
  type GoalDistributionMode,
  type SaleSource,
  type TemplateStatus,
  type UserRole,
} from '@prisma/client';
import {
  calculateGoalProgress,
  distributeGoalAmount,
  formatGoalMonth,
  getMonthDateRange,
  parseGoalMonth,
  round2,
} from '../../modules/goals/goal.calculator';
import {
  buildCustomerTemplateVariables,
  renderTemplate,
} from '../../modules/templates/template.interpolator';
import { AppError, ConflictError, NotFoundError } from '../http/app-error';
import type { DatabaseClient } from './prisma';

export interface TenantUserView {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

export interface TenantCustomerCreate {
  name: string;
  phone: string;
  city?: string | null | undefined;
  notes?: string | null | undefined;
  ownerId?: string | null | undefined;
  status?: CustomerStatus | undefined;
  nextContactAt?: Date | null | undefined;
}

export interface TenantCustomerUpdate {
  name?: string | undefined;
  phone?: string | undefined;
  city?: string | null | undefined;
  notes?: string | null | undefined;
  ownerId?: string | null | undefined;
  status?: CustomerStatus | undefined;
  nextContactAt?: Date | null | undefined;
}

export interface ListCustomersFilters {
  search?: string | undefined;
  status?: CustomerStatus | undefined;
  ownerId?: string | undefined;
  inactiveDays?: number | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface ListInactiveCustomersFilters {
  days: number;
  includeNeverPurchased: boolean;
  ownerId?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface TenantSaleCreate {
  customerId: string;
  soldAt: Date;
  amount: number;
  observation?: string | null | undefined;
  source?: SaleSource | undefined;
}

export interface TenantSaleUpdate {
  soldAt?: Date | undefined;
  amount?: number | undefined;
  observation?: string | null | undefined;
}

export interface ListSalesFilters {
  customerId?: string | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  source?: SaleSource | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface ImportCommitRow {
  name: string;
  phone: string;
  city?: string | null | undefined;
  notes?: string | null | undefined;
  soldAt?: Date | undefined;
  amount?: number | undefined;
  observation?: string | null | undefined;
}

export interface ImportCommitOptions {
  updateExistingCustomers: boolean;
}

export interface ImportCommitResult {
  customersCreated: number;
  customersUpdated: number;
  salesCreated: number;
}

export interface UpsertMonthlyGoalParams {
  month: string;
  totalAmount: number;
  distributionMode: GoalDistributionMode;
  customerIds?: string[] | undefined;
  historicalMonths: number;
}

export interface GoalCustomerDashboardItem {
  customerId: string;
  customer: {
    id: string;
    name: string;
    phone: string;
    status: CustomerStatus;
    owner: { id: string; name: string } | null;
  };
  targetAmount: number;
  realizedAmount: number;
  remainingAmount: number;
  completionPercentage: number;
  hitGoal: boolean;
}

export interface MonthlyGoalDashboard {
  month: string;
  goal: {
    id: string;
    totalAmount: number;
    distributionMode: GoalDistributionMode;
    realizedAmount: number;
    remainingAmount: number;
    completionPercentage: number;
  } | null;
  summary: {
    totalSalesCount: number;
    totalRealizedAmount: number;
    customersWithGoalCount: number;
    customersHitGoalCount: number;
  };
  customers: GoalCustomerDashboardItem[];
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const customerInclude = {
  owner: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CustomerInclude;

const saleInclude = {
  customer: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.SaleInclude;

export type CustomerWithOwner = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;
export type SaleWithRelations = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

export interface ListConversationsFilters {
  status?: ConversationStatus | undefined;
  assignedUserId?: string | undefined;
  customerId?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

const conversationInclude = {
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      city: true,
      status: true,
      owner: { select: { id: true, name: true, email: true } },
    },
  },
  assignedUser: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.ConversationInclude;

const messageInclude = {
  sender: { select: { id: true, name: true, email: true } },
} satisfies Prisma.MessageInclude;

export type ConversationWithRelations = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export type MessageWithSender = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;

/**
 * Única porta de acesso aos dados de negócio.
 * O accountId vem do token e nunca pode ser trocado pelo cliente.
 */
export class TenantStore {
  constructor(
    private readonly database: DatabaseClient,
    readonly accountId: string,
  ) {}

  async listUsers(): Promise<TenantUserView[]> {
    return this.database.user.findMany({
      where: { accountId: this.accountId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async listCustomers(
    filters: ListCustomersFilters = {},
  ): Promise<PaginatedResult<CustomerWithOwner>> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: Prisma.CustomerWhereInput = {
      accountId: this.accountId,
    };

    if (filters.status) where.status = filters.status;
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search } },
        { city: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.inactiveDays !== undefined) {
      const cutoff = new Date(Date.now() - filters.inactiveDays * 86_400_000);
      where.AND = [
        {
          OR: [{ lastPurchaseAt: { lt: cutoff } }, { lastPurchaseAt: null }],
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.database.customer.findMany({
        where,
        include: customerInclude,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.customer.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async listInactiveCustomers(
    filters: ListInactiveCustomersFilters,
  ): Promise<PaginatedResult<CustomerWithOwner>> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const cutoff = new Date(Date.now() - filters.days * 86_400_000);

    const where: Prisma.CustomerWhereInput = {
      accountId: this.accountId,
      status: 'ACTIVE',
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
      ...(filters.includeNeverPurchased
        ? { OR: [{ lastPurchaseAt: { lt: cutoff } }, { lastPurchaseAt: null }] }
        : { lastPurchaseAt: { lt: cutoff } }),
    };

    if (filters.search) {
      where.AND = [
        {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { phone: { contains: filters.search } },
            { city: { contains: filters.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.database.customer.findMany({
        where,
        include: customerInclude,
        orderBy: [{ lastPurchaseAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.customer.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findCustomer(id: string): Promise<CustomerWithOwner | null> {
    return this.database.customer.findFirst({
      where: { id, accountId: this.accountId },
      include: customerInclude,
    });
  }

  async findCustomersByPhones(phones: string[]): Promise<Map<string, { id: string; name: string }>> {
    if (phones.length === 0) return new Map();
    const rows = await this.database.customer.findMany({
      where: {
        accountId: this.accountId,
        phone: { in: phones },
      },
      select: { id: true, name: true, phone: true },
    });
    return new Map(rows.map((row) => [row.phone, { id: row.id, name: row.name }]));
  }

  async createCustomer(
    data: TenantCustomerCreate,
    actorUserId: string,
  ): Promise<CustomerWithOwner> {
    return this.database.$transaction(async (transaction) => {
      if (data.ownerId) {
        const owner = await transaction.user.findFirst({
          where: { id: data.ownerId, accountId: this.accountId },
          select: { id: true },
        });
        if (!owner) {
          throw new NotFoundError('Responsável não encontrado.');
        }
      }

      const existing = await transaction.customer.findFirst({
        where: { accountId: this.accountId, phone: data.phone },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError('Já existe um cliente com este telefone nesta conta.');
      }

      const created = await transaction.customer.create({
        data: {
          accountId: this.accountId,
          name: data.name,
          phone: data.phone,
          city: data.city ?? null,
          notes: data.notes ?? null,
          ownerId: data.ownerId ?? null,
          status: data.status ?? 'ACTIVE',
          nextContactAt: data.nextContactAt ?? null,
        },
        include: customerInclude,
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'CREATE',
          entityType: 'Customer',
          entityId: created.id,
        },
      });

      return created;
    });
  }

  async updateCustomer(
    id: string,
    data: TenantCustomerUpdate,
    actorUserId: string,
  ): Promise<CustomerWithOwner | null> {
    return this.database.$transaction(async (transaction) => {
      const customer = await transaction.customer.findFirst({
        where: { id, accountId: this.accountId },
        select: { id: true, phone: true },
      });
      if (!customer) return null;

      if (data.ownerId) {
        const owner = await transaction.user.findFirst({
          where: { id: data.ownerId, accountId: this.accountId },
          select: { id: true },
        });
        if (!owner) return null;
      }

      if (data.phone && data.phone !== customer.phone) {
        const conflict = await transaction.customer.findFirst({
          where: { accountId: this.accountId, phone: data.phone, id: { not: customer.id } },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictError('Já existe um cliente com este telefone nesta conta.');
        }
      }

      const updateData: Prisma.CustomerUncheckedUpdateInput = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.phone !== undefined) updateData.phone = data.phone;
      if (data.city !== undefined) updateData.city = data.city;
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.ownerId !== undefined) updateData.ownerId = data.ownerId;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.nextContactAt !== undefined) updateData.nextContactAt = data.nextContactAt;

      const updated = await transaction.customer.update({
        where: { id: customer.id },
        data: updateData,
        include: customerInclude,
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'UPDATE',
          entityType: 'Customer',
          entityId: updated.id,
          metadata: { fields: Object.keys(data) },
        },
      });

      return updated;
    });
  }

  async deleteCustomer(id: string, actorUserId: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const deleted = await transaction.customer.deleteMany({
        where: { id, accountId: this.accountId },
      });
      if (deleted.count === 0) return false;

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'DELETE',
          entityType: 'Customer',
          entityId: id,
        },
      });
      return true;
    });
  }

  async listSales(filters: ListSalesFilters = {}): Promise<PaginatedResult<SaleWithRelations>> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: Prisma.SaleWhereInput = {
      accountId: this.accountId,
    };

    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.source) where.source = filters.source;
    if (filters.startDate || filters.endDate) {
      where.soldAt = {
        ...(filters.startDate ? { gte: filters.startDate } : {}),
        ...(filters.endDate ? { lte: filters.endDate } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.database.sale.findMany({
        where,
        include: saleInclude,
        orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.sale.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findSale(id: string): Promise<SaleWithRelations | null> {
    return this.database.sale.findFirst({
      where: { id, accountId: this.accountId },
      include: saleInclude,
    });
  }

  async createSale(data: TenantSaleCreate, actorUserId: string): Promise<SaleWithRelations> {
    return this.database.$transaction(async (transaction) => {
      const customer = await transaction.customer.findFirst({
        where: { id: data.customerId, accountId: this.accountId },
        select: { id: true, lastPurchaseAt: true },
      });
      if (!customer) {
        throw new NotFoundError('Cliente não encontrado.');
      }

      const created = await transaction.sale.create({
        data: {
          accountId: this.accountId,
          customerId: customer.id,
          createdById: actorUserId,
          soldAt: data.soldAt,
          amount: new Prisma.Decimal(data.amount.toFixed(2)),
          observation: data.observation ?? null,
          source: data.source ?? 'MANUAL',
        },
        include: saleInclude,
      });

      if (!customer.lastPurchaseAt || data.soldAt > customer.lastPurchaseAt) {
        await transaction.customer.update({
          where: { id: customer.id },
          data: { lastPurchaseAt: data.soldAt },
        });
      }

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'CREATE',
          entityType: 'Sale',
          entityId: created.id,
        },
      });

      return created;
    });
  }

  async updateSale(
    id: string,
    data: TenantSaleUpdate,
    actorUserId: string,
  ): Promise<SaleWithRelations | null> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.sale.findFirst({
        where: { id, accountId: this.accountId },
        select: { id: true, customerId: true },
      });
      if (!existing) return null;

      const updateData: Prisma.SaleUncheckedUpdateInput = {};
      if (data.soldAt !== undefined) updateData.soldAt = data.soldAt;
      if (data.amount !== undefined) updateData.amount = new Prisma.Decimal(data.amount.toFixed(2));
      if (data.observation !== undefined) updateData.observation = data.observation;

      const updated = await transaction.sale.update({
        where: { id: existing.id },
        data: updateData,
        include: saleInclude,
      });

      if (data.soldAt !== undefined) {
        await this.syncCustomerLastPurchaseAt(transaction, existing.customerId);
      }

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'UPDATE',
          entityType: 'Sale',
          entityId: updated.id,
          metadata: { fields: Object.keys(data) },
        },
      });

      return updated;
    });
  }

  async deleteSale(id: string, actorUserId: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.sale.findFirst({
        where: { id, accountId: this.accountId },
        select: { id: true, customerId: true },
      });
      if (!existing) return false;

      await transaction.sale.deleteMany({
        where: { id: existing.id, accountId: this.accountId },
      });

      await this.syncCustomerLastPurchaseAt(transaction, existing.customerId);

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'DELETE',
          entityType: 'Sale',
          entityId: existing.id,
        },
      });

      return true;
    });
  }

  async commitImport(
    rows: ImportCommitRow[],
    options: ImportCommitOptions,
    actorUserId: string,
  ): Promise<ImportCommitResult> {
    return this.database.$transaction(
      async (transaction) => {
        const uniquePhones = [...new Set(rows.map((row) => row.phone))];
        const existingCustomers = await transaction.customer.findMany({
          where: { accountId: this.accountId, phone: { in: uniquePhones } },
          select: { id: true, phone: true, city: true, notes: true, lastPurchaseAt: true },
        });
        const customerByPhone = new Map(existingCustomers.map((customer) => [customer.phone, customer]));

        let customersCreated = 0;
        let customersUpdated = 0;
        let salesCreated = 0;
        const touchedCustomerIds = new Set<string>();

        for (const row of rows) {
          let customer = customerByPhone.get(row.phone);

          if (!customer) {
            const created = await transaction.customer.create({
              data: {
                accountId: this.accountId,
                name: row.name,
                phone: row.phone,
                city: row.city ?? null,
                notes: row.notes ?? null,
                lastPurchaseAt: row.soldAt ?? null,
              },
              select: { id: true, phone: true, city: true, notes: true, lastPurchaseAt: true },
            });
            customer = created;
            customerByPhone.set(row.phone, created);
            customersCreated += 1;
          } else if (options.updateExistingCustomers) {
            await transaction.customer.update({
              where: { id: customer.id },
              data: {
                name: row.name,
                ...(row.city !== undefined ? { city: row.city } : {}),
                ...(row.notes !== undefined ? { notes: row.notes } : {}),
              },
            });
            customersUpdated += 1;
          }

          if (row.soldAt && row.amount !== undefined) {
            await transaction.sale.create({
              data: {
                accountId: this.accountId,
                customerId: customer.id,
                createdById: actorUserId,
                soldAt: row.soldAt,
                amount: new Prisma.Decimal(row.amount.toFixed(2)),
                observation: row.observation ?? null,
                source: 'IMPORT',
              },
            });
            salesCreated += 1;
            touchedCustomerIds.add(customer.id);
          }
        }

        for (const customerId of touchedCustomerIds) {
          await this.syncCustomerLastPurchaseAt(transaction, customerId);
        }

        await transaction.auditLog.create({
          data: {
            accountId: this.accountId,
            actorUserId,
            action: 'CREATE',
            entityType: 'Import',
            metadata: {
              customersCreated,
              customersUpdated,
              salesCreated,
            },
          },
        });

        return { customersCreated, customersUpdated, salesCreated };
      },
      { timeout: 30_000 },
    );
  }

  async listMonthlyGoals(): Promise<
    Array<{
      id: string;
      month: string;
      totalAmount: string;
      distributionMode: GoalDistributionMode;
      customersCount: number;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const goals = await this.database.monthlyGoal.findMany({
      where: { accountId: this.accountId },
      include: { _count: { select: { customers: true } } },
      orderBy: { month: 'desc' },
    });

    return goals.map((goal) => ({
      id: goal.id,
      month: formatGoalMonth(goal.month),
      totalAmount: goal.totalAmount.toString(),
      distributionMode: goal.distributionMode,
      customersCount: goal._count.customers,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    }));
  }

  async upsertMonthlyGoal(
    input: UpsertMonthlyGoalParams,
    actorUserId: string,
  ): Promise<MonthlyGoalDashboard> {
    const monthDate = parseGoalMonth(input.month);

    await this.database.$transaction(async (transaction) => {
      const uniqueCustomerIds = input.customerIds ? [...new Set(input.customerIds)] : undefined;
      const customers = await transaction.customer.findMany({
        where: {
          accountId: this.accountId,
          status: 'ACTIVE',
          ...(uniqueCustomerIds ? { id: { in: uniqueCustomerIds } } : {}),
        },
        select: { id: true },
        orderBy: { name: 'asc' },
      });

      if (uniqueCustomerIds && customers.length !== uniqueCustomerIds.length) {
        throw new NotFoundError('Um ou mais clientes não foram encontrados nesta conta.');
      }

      if (customers.length === 0) {
        throw new AppError(
          400,
          'NO_ACTIVE_CUSTOMERS',
          'Nenhum cliente ativo encontrado para distribuir a meta.',
        );
      }

      const historicalByCustomer = new Map<string, number>();
      if (input.distributionMode === 'HISTORICAL') {
        const historyStart = new Date(
          Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() - input.historicalMonths, 1),
        );
        const salesHistory = await transaction.sale.groupBy({
          by: ['customerId'],
          where: {
            accountId: this.accountId,
            customerId: { in: customers.map((customer) => customer.id) },
            soldAt: { gte: historyStart, lt: monthDate },
          },
          _sum: { amount: true },
        });
        for (const entry of salesHistory) {
          historicalByCustomer.set(entry.customerId, Number(entry._sum.amount ?? 0));
        }
      }

      const distributed = distributeGoalAmount(
        input.totalAmount,
        customers.map((customer) => ({
          id: customer.id,
          historicalAmount: historicalByCustomer.get(customer.id) ?? 0,
        })),
        input.distributionMode,
      );

      const existing = await transaction.monthlyGoal.findUnique({
        where: {
          accountId_month: {
            accountId: this.accountId,
            month: monthDate,
          },
        },
        select: { id: true },
      });

      const goal = existing
        ? await transaction.monthlyGoal.update({
            where: { id: existing.id },
            data: {
              totalAmount: new Prisma.Decimal(input.totalAmount.toFixed(2)),
              distributionMode: input.distributionMode,
            },
            select: { id: true },
          })
        : await transaction.monthlyGoal.create({
            data: {
              accountId: this.accountId,
              month: monthDate,
              totalAmount: new Prisma.Decimal(input.totalAmount.toFixed(2)),
              distributionMode: input.distributionMode,
            },
            select: { id: true },
          });

      await transaction.customerGoal.deleteMany({
        where: { goalId: goal.id, accountId: this.accountId },
      });

      await transaction.customerGoal.createMany({
        data: distributed.map((item) => ({
          accountId: this.accountId,
          goalId: goal.id,
          customerId: item.customerId,
          amount: new Prisma.Decimal(item.amount.toFixed(2)),
        })),
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'MonthlyGoal',
          entityId: goal.id,
          metadata: {
            month: input.month,
            totalAmount: input.totalAmount,
            distributionMode: input.distributionMode,
            customersCount: distributed.length,
          },
        },
      });
    });

    return this.getMonthlyGoalDashboard(input.month);
  }

  async getMonthlyGoalDashboard(month: string): Promise<MonthlyGoalDashboard> {
    const monthDate = parseGoalMonth(month);
    const { start, end } = getMonthDateRange(monthDate);

    const [monthlyGoal, salesAggregate, salesByCustomer] = await Promise.all([
      this.database.monthlyGoal.findUnique({
        where: {
          accountId_month: {
            accountId: this.accountId,
            month: monthDate,
          },
        },
        include: {
          customers: {
            include: {
              customer: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  status: true,
                  owner: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
      this.database.sale.aggregate({
        where: {
          accountId: this.accountId,
          soldAt: { gte: start, lt: end },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.database.sale.groupBy({
        by: ['customerId'],
        where: {
          accountId: this.accountId,
          soldAt: { gte: start, lt: end },
        },
        _sum: { amount: true },
      }),
    ]);

    const totalRealizedAmount = round2(Number(salesAggregate._sum.amount ?? 0));
    const realizedByCustomer = new Map<string, number>();
    for (const row of salesByCustomer) {
      realizedByCustomer.set(row.customerId, round2(Number(row._sum.amount ?? 0)));
    }

    if (!monthlyGoal) {
      return {
        month,
        goal: null,
        summary: {
          totalSalesCount: salesAggregate._count._all,
          totalRealizedAmount,
          customersWithGoalCount: 0,
          customersHitGoalCount: 0,
        },
        customers: [],
      };
    }

    const totalTarget = round2(Number(monthlyGoal.totalAmount));
    const goalProgress = calculateGoalProgress(totalTarget, totalRealizedAmount);

    const customers: GoalCustomerDashboardItem[] = monthlyGoal.customers
      .map((item) => {
        const targetAmount = round2(Number(item.amount));
        const realizedAmount = realizedByCustomer.get(item.customerId) ?? 0;
        const progress = calculateGoalProgress(targetAmount, realizedAmount);
        return {
          customerId: item.customerId,
          customer: item.customer,
          targetAmount,
          realizedAmount,
          remainingAmount: progress.remainingAmount,
          completionPercentage: progress.completionPercentage,
          hitGoal: targetAmount > 0 && realizedAmount >= targetAmount,
        };
      })
      .sort((a, b) => {
        if (b.completionPercentage !== a.completionPercentage) {
          return b.completionPercentage - a.completionPercentage;
        }
        return b.targetAmount - a.targetAmount;
      });

    return {
      month,
      goal: {
        id: monthlyGoal.id,
        totalAmount: totalTarget,
        distributionMode: monthlyGoal.distributionMode,
        realizedAmount: totalRealizedAmount,
        remainingAmount: goalProgress.remainingAmount,
        completionPercentage: goalProgress.completionPercentage,
      },
      summary: {
        totalSalesCount: salesAggregate._count._all,
        totalRealizedAmount,
        customersWithGoalCount: customers.length,
        customersHitGoalCount: customers.filter((item) => item.hitGoal).length,
      },
      customers,
    };
  }

  async updateCustomerGoal(
    goalId: string,
    customerId: string,
    amount: number,
    actorUserId: string,
  ): Promise<{ customerGoalId: string; amount: number; monthlyGoalTotalAmount: number } | null> {
    return this.database.$transaction(async (transaction) => {
      const [goal, customer] = await Promise.all([
        transaction.monthlyGoal.findFirst({
          where: { id: goalId, accountId: this.accountId },
          select: { id: true },
        }),
        transaction.customer.findFirst({
          where: { id: customerId, accountId: this.accountId },
          select: { id: true },
        }),
      ]);

      if (!goal || !customer) return null;

      const updatedCustomerGoal = await transaction.customerGoal.upsert({
        where: {
          goalId_customerId: {
            goalId: goal.id,
            customerId: customer.id,
          },
        },
        update: {
          amount: new Prisma.Decimal(amount.toFixed(2)),
        },
        create: {
          accountId: this.accountId,
          goalId: goal.id,
          customerId: customer.id,
          amount: new Prisma.Decimal(amount.toFixed(2)),
        },
        select: { id: true, amount: true },
      });

      const sumAggregate = await transaction.customerGoal.aggregate({
        where: { goalId: goal.id, accountId: this.accountId },
        _sum: { amount: true },
      });
      const monthlyGoalTotalAmount = round2(Number(sumAggregate._sum.amount ?? 0));

      await transaction.monthlyGoal.update({
        where: { id: goal.id },
        data: { totalAmount: new Prisma.Decimal(monthlyGoalTotalAmount.toFixed(2)) },
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'UPDATE',
          entityType: 'CustomerGoal',
          entityId: updatedCustomerGoal.id,
          metadata: { goalId: goal.id, customerId: customer.id, amount },
        },
      });

      return {
        customerGoalId: updatedCustomerGoal.id,
        amount: round2(Number(updatedCustomerGoal.amount)),
        monthlyGoalTotalAmount,
      };
    });
  }

  async deleteMonthlyGoal(goalId: string, actorUserId: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const deleted = await transaction.monthlyGoal.deleteMany({
        where: { id: goalId, accountId: this.accountId },
      });
      if (deleted.count === 0) return false;

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'DELETE',
          entityType: 'MonthlyGoal',
          entityId: goalId,
        },
      });
      return true;
    });
  }

  private async syncCustomerLastPurchaseAt(
    transaction: Prisma.TransactionClient,
    customerId: string,
  ): Promise<void> {
    const aggregate = await transaction.sale.aggregate({
      where: { accountId: this.accountId, customerId },
      _max: { soldAt: true },
    });

    await transaction.customer.updateMany({
      where: { id: customerId, accountId: this.accountId },
      data: { lastPurchaseAt: aggregate._max.soldAt ?? null },
    });
  }

  async listConversations(
    filters: ListConversationsFilters = {},
  ): Promise<PaginatedResult<ConversationWithRelations>> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: Prisma.ConversationWhereInput = {
      accountId: this.accountId,
    };

    if (filters.status) where.status = filters.status;
    if (filters.assignedUserId) where.assignedUserId = filters.assignedUserId;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.search) {
      where.customer = {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { phone: { contains: filters.search } },
        ],
      };
    }

    const [items, total] = await Promise.all([
      this.database.conversation.findMany({
        where,
        include: conversationInclude,
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.conversation.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findConversation(id: string): Promise<ConversationWithRelations | null> {
    return this.database.conversation.findFirst({
      where: { id, accountId: this.accountId },
      include: conversationInclude,
    });
  }

  async listMessages(
    conversationId: string,
    page = 1,
    pageSize = 50,
  ): Promise<PaginatedResult<MessageWithSender>> {
    const conversation = await this.database.conversation.findFirst({
      where: { id: conversationId, accountId: this.accountId },
      select: { id: true },
    });
    if (!conversation) {
      throw new NotFoundError('Conversa não encontrada.');
    }

    const where: Prisma.MessageWhereInput = {
      conversationId,
      accountId: this.accountId,
    };

    const [items, total] = await Promise.all([
      this.database.message.findMany({
        where,
        include: messageInclude,
        orderBy: { sentAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.message.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async sendConversationMessage(
    conversationId: string,
    body: string,
    actorUserId: string,
  ): Promise<{ message: MessageWithSender; conversation: ConversationWithRelations }> {
    return this.database.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.findFirst({
        where: { id: conversationId, accountId: this.accountId },
        select: { id: true, status: true, assignedUserId: true },
      });
      if (!conversation) {
        throw new NotFoundError('Conversa não encontrada.');
      }

      const now = new Date();
      const message = await transaction.message.create({
        data: {
          accountId: this.accountId,
          conversationId,
          senderId: actorUserId,
          direction: 'OUTBOUND',
          status: 'QUEUED',
          body,
          sentAt: now,
        },
        include: messageInclude,
      });

      const nextStatus =
        conversation.status === 'AGUARDANDO_HUMANO' ? 'EM_ATENDIMENTO' : conversation.status;
      const nextAssignedUserId = conversation.assignedUserId ?? actorUserId;

      const updatedConversation = await transaction.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: now,
          lastMessagePreview: body.slice(0, 240),
          status: nextStatus,
          assignedUserId: nextAssignedUserId,
        },
        include: conversationInclude,
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'CREATE',
          entityType: 'Message',
          entityId: message.id,
          metadata: { conversationId, bodyPreview: body.slice(0, 80) },
        },
      });

      return { message, conversation: updatedConversation };
    });
  }

  async updateConversationStatus(
    id: string,
    status: ConversationStatus,
    assignedUserId: string | null | undefined,
    actorUserId: string,
  ): Promise<ConversationWithRelations | null> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.conversation.findFirst({
        where: { id, accountId: this.accountId },
        select: { id: true },
      });
      if (!existing) return null;

      if (assignedUserId) {
        const user = await transaction.user.findFirst({
          where: { id: assignedUserId, accountId: this.accountId },
          select: { id: true },
        });
        if (!user) throw new NotFoundError('Atendente não encontrado.');
      }

      const updated = await transaction.conversation.update({
        where: { id },
        data: {
          status,
          ...(assignedUserId !== undefined ? { assignedUserId } : {}),
        },
        include: conversationInclude,
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'UPDATE',
          entityType: 'Conversation',
          entityId: id,
          metadata: { status, assignedUserId },
        },
      });

      return updated;
    });
  }

  async assignConversation(
    id: string,
    assignedUserId: string | null,
    actorUserId: string,
  ): Promise<ConversationWithRelations | null> {
    return this.database.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.findFirst({
        where: { id, accountId: this.accountId },
        select: { id: true, status: true },
      });
      if (!conversation) return null;

      if (assignedUserId) {
        const user = await transaction.user.findFirst({
          where: { id: assignedUserId, accountId: this.accountId },
          select: { id: true },
        });
        if (!user) throw new NotFoundError('Atendente não encontrado.');
      }

      const nextStatus =
        assignedUserId && (conversation.status === 'BOT' || conversation.status === 'AGUARDANDO_HUMANO')
          ? 'EM_ATENDIMENTO'
          : conversation.status;

      const updated = await transaction.conversation.update({
        where: { id },
        data: {
          assignedUserId,
          status: nextStatus,
        },
        include: conversationInclude,
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'UPDATE',
          entityType: 'Conversation',
          entityId: id,
          metadata: { action: 'ASSIGN', assignedUserId },
        },
      });

      return updated;
    });
  }

  async listQuickReplies(): Promise<Prisma.QuickReplyGetPayload<Record<string, never>>[]> {
    return this.database.quickReply.findMany({
      where: { accountId: this.accountId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async createQuickReply(
    data: {
      name: string;
      trigger?: string | null | undefined;
      text: string;
      active?: boolean | undefined;
    },
    actorUserId: string,
  ): Promise<Prisma.QuickReplyGetPayload<Record<string, never>>> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.quickReply.findFirst({
        where: { accountId: this.accountId, name: data.name },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError('Já existe uma resposta rápida com este nome.');
      }

      const created = await transaction.quickReply.create({
        data: {
          accountId: this.accountId,
          name: data.name,
          trigger: data.trigger ?? null,
          text: data.text,
          active: data.active ?? true,
        },
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'CREATE',
          entityType: 'QuickReply',
          entityId: created.id,
        },
      });

      return created;
    });
  }

  async updateQuickReply(
    id: string,
    data: {
      name?: string | undefined;
      trigger?: string | null | undefined;
      text?: string | undefined;
      active?: boolean | undefined;
    },
    actorUserId: string,
  ): Promise<Prisma.QuickReplyGetPayload<Record<string, never>> | null> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.quickReply.findFirst({
        where: { id, accountId: this.accountId },
        select: { id: true },
      });
      if (!existing) return null;

      if (data.name) {
        const conflict = await transaction.quickReply.findFirst({
          where: { accountId: this.accountId, name: data.name, id: { not: id } },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictError('Já existe uma resposta rápida com este nome.');
        }
      }

      const updated = await transaction.quickReply.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.trigger !== undefined ? { trigger: data.trigger } : {}),
          ...(data.text !== undefined ? { text: data.text } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'UPDATE',
          entityType: 'QuickReply',
          entityId: id,
          metadata: { fields: Object.keys(data) },
        },
      });

      return updated;
    });
  }

  async deleteQuickReply(id: string, actorUserId: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const deleted = await transaction.quickReply.deleteMany({
        where: { id, accountId: this.accountId },
      });
      if (deleted.count === 0) return false;

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'DELETE',
          entityType: 'QuickReply',
          entityId: id,
        },
      });

      return true;
    });
  }

  async listBlocklist(): Promise<Prisma.BlocklistEntryGetPayload<Record<string, never>>[]> {
    return this.database.blocklistEntry.findMany({
      where: { accountId: this.accountId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async isPhoneBlocked(phone: string): Promise<boolean> {
    const entry = await this.database.blocklistEntry.findFirst({
      where: { accountId: this.accountId, phone },
      select: { id: true },
    });
    return entry !== null;
  }

  async addBlocklistEntry(
    phone: string,
    reason: string | null | undefined,
    actorUserId: string,
  ): Promise<Prisma.BlocklistEntryGetPayload<Record<string, never>>> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.blocklistEntry.findFirst({
        where: { accountId: this.accountId, phone },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError('Este telefone já está na blocklist.');
      }

      const created = await transaction.blocklistEntry.create({
        data: {
          accountId: this.accountId,
          phone,
          reason: reason ?? null,
        },
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'CREATE',
          entityType: 'BlocklistEntry',
          entityId: created.id,
          metadata: { phone },
        },
      });

      return created;
    });
  }

  async removeBlocklistEntry(id: string, actorUserId: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const deleted = await transaction.blocklistEntry.deleteMany({
        where: { id, accountId: this.accountId },
      });
      if (deleted.count === 0) return false;

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'DELETE',
          entityType: 'BlocklistEntry',
          entityId: id,
        },
      });

      return true;
    });
  }

  async receiveInboundMessage(params: {
    fromPhone: string;
    body: string;
    externalId?: string | undefined;
    provider?: string | undefined;
  }): Promise<
    | { ignored: true; reason: 'BLOCKED' | 'DUPLICATE' }
    | {
        ignored: false;
        customer: CustomerWithOwner;
        conversation: ConversationWithRelations;
        message: MessageWithSender;
      }
  > {
    if (await this.isPhoneBlocked(params.fromPhone)) {
      return { ignored: true, reason: 'BLOCKED' };
    }

    if (params.externalId) {
      const existingMessage = await this.database.message.findFirst({
        where: { externalId: params.externalId, accountId: this.accountId },
        select: { id: true },
      });
      if (existingMessage) {
        return { ignored: true, reason: 'DUPLICATE' };
      }
    }

    return this.database.$transaction(async (transaction) => {
      let customer = await transaction.customer.findFirst({
        where: { accountId: this.accountId, phone: params.fromPhone },
        include: customerInclude,
      });

      if (!customer) {
        customer = await transaction.customer.create({
          data: {
            accountId: this.accountId,
            name: `Cliente ${params.fromPhone.slice(-4)}`,
            phone: params.fromPhone,
          },
          include: customerInclude,
        });
      }

      let conversation = await transaction.conversation.findFirst({
        where: {
          accountId: this.accountId,
          customerId: customer.id,
          status: { not: 'FINALIZADA' },
        },
        include: conversationInclude,
      });

      const now = new Date();

      if (!conversation) {
        conversation = await transaction.conversation.create({
          data: {
            accountId: this.accountId,
            customerId: customer.id,
            status: 'BOT',
            lastMessageAt: now,
            lastMessagePreview: params.body.slice(0, 240),
          },
          include: conversationInclude,
        });
      } else {
        conversation = await transaction.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: now,
            lastMessagePreview: params.body.slice(0, 240),
          },
          include: conversationInclude,
        });
      }

      const message = await transaction.message.create({
        data: {
          accountId: this.accountId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          status: 'RECEIVED',
          provider: params.provider ?? 'META',
          externalId: params.externalId ?? null,
          body: params.body,
          sentAt: now,
        },
        include: messageInclude,
      });

      return {
        ignored: false,
        customer,
        conversation,
        message,
      };
    });
  }

  async listMessageTemplates(
    filters: {
      status?: TemplateStatus | undefined;
      category?: string | undefined;
      search?: string | undefined;
      page?: number | undefined;
      pageSize?: number | undefined;
    } = {},
  ): Promise<PaginatedResult<Prisma.MessageTemplateGetPayload<Record<string, never>>>> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: Prisma.MessageTemplateWhereInput = {
      accountId: this.accountId,
    };

    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { content: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.database.messageTemplate.findMany({
        where,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.messageTemplate.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findMessageTemplate(
    id: string,
  ): Promise<Prisma.MessageTemplateGetPayload<Record<string, never>> | null> {
    return this.database.messageTemplate.findFirst({
      where: { id, accountId: this.accountId },
    });
  }

  async createMessageTemplate(
    data: {
      name: string;
      content: string;
      category?: string | null | undefined;
      status?: TemplateStatus | undefined;
    },
    actorUserId: string,
  ): Promise<Prisma.MessageTemplateGetPayload<Record<string, never>>> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.messageTemplate.findFirst({
        where: { accountId: this.accountId, name: data.name },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError('Já existe um template de mensagem com este nome.');
      }

      const created = await transaction.messageTemplate.create({
        data: {
          accountId: this.accountId,
          name: data.name,
          content: data.content,
          category: data.category ?? null,
          status: data.status ?? 'DRAFT',
        },
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'CREATE',
          entityType: 'MessageTemplate',
          entityId: created.id,
          metadata: { name: created.name, status: created.status },
        },
      });

      return created;
    });
  }

  async updateMessageTemplate(
    id: string,
    data: {
      name?: string | undefined;
      content?: string | undefined;
      category?: string | null | undefined;
      status?: TemplateStatus | undefined;
    },
    actorUserId: string,
  ): Promise<Prisma.MessageTemplateGetPayload<Record<string, never>> | null> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.messageTemplate.findFirst({
        where: { id, accountId: this.accountId },
        select: { id: true },
      });
      if (!existing) return null;

      if (data.name) {
        const conflict = await transaction.messageTemplate.findFirst({
          where: { accountId: this.accountId, name: data.name, id: { not: id } },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictError('Já existe um template de mensagem com este nome.');
        }
      }

      const updated = await transaction.messageTemplate.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.content !== undefined ? { content: data.content } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        },
      });

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'UPDATE',
          entityType: 'MessageTemplate',
          entityId: id,
          metadata: { fields: Object.keys(data) },
        },
      });

      return updated;
    });
  }

  async deleteMessageTemplate(id: string, actorUserId: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const deleted = await transaction.messageTemplate.deleteMany({
        where: { id, accountId: this.accountId },
      });
      if (deleted.count === 0) return false;

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'DELETE',
          entityType: 'MessageTemplate',
          entityId: id,
        },
      });

      return true;
    });
  }

  async previewReactivation(options: {
    templateId: string;
    inactiveDays: number;
    includeNeverPurchased: boolean;
    customerIds?: string[] | undefined;
    ownerId?: string | undefined;
  }): Promise<{
    template: { id: string; name: string; status: TemplateStatus };
    summary: { totalEligible: number; totalBlocked: number };
    recipients: Array<{
      customerId: string;
      customerName: string;
      phone: string;
      status: 'ELIGIBLE' | 'BLOCKED';
      renderedMessage: string;
    }>;
  }> {
    const template = await this.findMessageTemplate(options.templateId);
    if (!template) {
      throw new NotFoundError('Template de mensagem não encontrado.');
    }

    const cutoff = new Date(Date.now() - options.inactiveDays * 86_400_000);
    const where: Prisma.CustomerWhereInput = {
      accountId: this.accountId,
      status: 'ACTIVE',
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      ...(options.customerIds ? { id: { in: options.customerIds } } : {}),
      ...(options.includeNeverPurchased
        ? { OR: [{ lastPurchaseAt: { lt: cutoff } }, { lastPurchaseAt: null }] }
        : { lastPurchaseAt: { lt: cutoff } }),
    };

    const [customers, blockedEntries] = await Promise.all([
      this.database.customer.findMany({
        where,
        include: customerInclude,
        orderBy: [{ lastPurchaseAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
        take: 500,
      }),
      this.database.blocklistEntry.findMany({
        where: { accountId: this.accountId },
        select: { phone: true },
      }),
    ]);

    const blockedPhones = new Set(blockedEntries.map((b) => b.phone));
    let totalEligible = 0;
    let totalBlocked = 0;

    const recipients = customers.map((customer) => {
      const isBlocked = blockedPhones.has(customer.phone);
      if (isBlocked) {
        totalBlocked += 1;
      } else {
        totalEligible += 1;
      }

      const vars = buildCustomerTemplateVariables(customer);
      const renderedMessage = renderTemplate(template.content, vars);

      return {
        customerId: customer.id,
        customerName: customer.name,
        phone: customer.phone,
        status: isBlocked ? ('BLOCKED' as const) : ('ELIGIBLE' as const),
        renderedMessage,
      };
    });

    return {
      template: { id: template.id, name: template.name, status: template.status },
      summary: { totalEligible, totalBlocked },
      recipients,
    };
  }

  async dispatchReactivation(
    options: {
      templateId: string;
      inactiveDays: number;
      includeNeverPurchased: boolean;
      customerIds?: string[] | undefined;
      ownerId?: string | undefined;
    },
    actorUserId: string,
  ): Promise<{
    templateId: string;
    dispatchedCount: number;
    skippedBlocklistCount: number;
    messages: Array<{
      conversationId: string;
      messageId: string;
      customerId: string;
      toPhone: string;
      body: string;
    }>;
  }> {
    const template = await this.findMessageTemplate(options.templateId);
    if (!template) {
      throw new NotFoundError('Template de mensagem não encontrado.');
    }

    if (template.status !== 'APPROVED') {
      throw new AppError(
        400,
        'TEMPLATE_NOT_APPROVED',
        'Apenas templates aprovados podem ser usados em disparos de reativação.',
      );
    }

    const cutoff = new Date(Date.now() - options.inactiveDays * 86_400_000);
    const where: Prisma.CustomerWhereInput = {
      accountId: this.accountId,
      status: 'ACTIVE',
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      ...(options.customerIds ? { id: { in: options.customerIds } } : {}),
      ...(options.includeNeverPurchased
        ? { OR: [{ lastPurchaseAt: { lt: cutoff } }, { lastPurchaseAt: null }] }
        : { lastPurchaseAt: { lt: cutoff } }),
    };

    return this.database.$transaction(
      async (transaction) => {
        const [customers, blockedEntries] = await Promise.all([
          transaction.customer.findMany({
            where,
            include: customerInclude,
            orderBy: [{ lastPurchaseAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
            take: 500,
          }),
          transaction.blocklistEntry.findMany({
            where: { accountId: this.accountId },
            select: { phone: true },
          }),
        ]);

        const blockedPhones = new Set(blockedEntries.map((b) => b.phone));
        const dispatchedMessages: Array<{
          conversationId: string;
          messageId: string;
          customerId: string;
          toPhone: string;
          body: string;
        }> = [];
        let skippedBlocklistCount = 0;
        const now = new Date();

        for (const customer of customers) {
          if (blockedPhones.has(customer.phone)) {
            skippedBlocklistCount += 1;
            continue;
          }

          const vars = buildCustomerTemplateVariables(customer, now);
          const body = renderTemplate(template.content, vars);

          let conversation = await transaction.conversation.findFirst({
            where: {
              accountId: this.accountId,
              customerId: customer.id,
              status: { not: 'FINALIZADA' },
            },
            select: { id: true },
          });

          if (!conversation) {
            conversation = await transaction.conversation.create({
              data: {
                accountId: this.accountId,
                customerId: customer.id,
                status: 'BOT',
                lastMessageAt: now,
                lastMessagePreview: body.slice(0, 240),
              },
              select: { id: true },
            });
          } else {
            await transaction.conversation.update({
              where: { id: conversation.id },
              data: {
                lastMessageAt: now,
                lastMessagePreview: body.slice(0, 240),
              },
            });
          }

          const message = await transaction.message.create({
            data: {
              accountId: this.accountId,
              conversationId: conversation.id,
              senderId: actorUserId,
              direction: 'OUTBOUND',
              status: 'QUEUED',
              body,
              sentAt: now,
            },
            select: { id: true },
          });

          dispatchedMessages.push({
            conversationId: conversation.id,
            messageId: message.id,
            customerId: customer.id,
            toPhone: customer.phone,
            body,
          });
        }

        await transaction.auditLog.create({
          data: {
            accountId: this.accountId,
            actorUserId,
            action: 'CREATE',
            entityType: 'Reactivation',
            metadata: {
              templateId: template.id,
              dispatchedCount: dispatchedMessages.length,
              skippedBlocklistCount,
            },
          },
        });

        return {
          templateId: template.id,
          dispatchedCount: dispatchedMessages.length,
          skippedBlocklistCount,
          messages: dispatchedMessages,
        };
      },
      { timeout: 30_000 },
    );
  }

  async listAuditLogs(
    filters: {
      actorUserId?: string | undefined;
      action?: AuditAction | undefined;
      entityType?: string | undefined;
      startDate?: Date | undefined;
      endDate?: Date | undefined;
      page?: number | undefined;
      pageSize?: number | undefined;
    } = {},
  ): Promise<
    PaginatedResult<
      Prisma.AuditLogGetPayload<{
        include: { actor: { select: { id: true; name: true; email: true; role: true } } };
      }>
    >
  > {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where: Prisma.AuditLogWhereInput = {
      accountId: this.accountId,
    };

    if (filters.actorUserId) where.actorUserId = filters.actorUserId;
    if (filters.action) where.action = filters.action;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.startDate || filters.endDate) {
      where.createdAt = {
        ...(filters.startDate ? { gte: filters.startDate } : {}),
        ...(filters.endDate ? { lte: filters.endDate } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.database.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.auditLog.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async exportCustomerData(customerId: string): Promise<{
    customer: CustomerWithOwner;
    sales: Array<{ id: string; soldAt: Date; amount: number; observation: string | null; source: string }>;
    conversations: Array<{
      id: string;
      status: string;
      lastMessageAt: Date | null;
      messages: Array<{ id: string; direction: string; body: string; sentAt: Date }>;
    }>;
    exportedAt: string;
  }> {
    const customer = await this.findCustomer(customerId);
    if (!customer) {
      throw new NotFoundError('Cliente não encontrado.');
    }

    const [sales, conversations] = await Promise.all([
      this.database.sale.findMany({
        where: { accountId: this.accountId, customerId },
        orderBy: { soldAt: 'desc' },
        select: {
          id: true,
          soldAt: true,
          amount: true,
          observation: true,
          source: true,
        },
      }),
      this.database.conversation.findMany({
        where: { accountId: this.accountId, customerId },
        include: {
          messages: {
            orderBy: { sentAt: 'asc' },
            select: { id: true, direction: true, body: true, sentAt: true },
          },
        },
      }),
    ]);

    return {
      customer,
      sales: sales.map((sale) => ({
        id: sale.id,
        soldAt: sale.soldAt,
        amount: Number(sale.amount),
        observation: sale.observation,
        source: sale.source,
      })),
      conversations: conversations.map((conv) => ({
        id: conv.id,
        status: conv.status,
        lastMessageAt: conv.lastMessageAt,
        messages: conv.messages,
      })),
      exportedAt: new Date().toISOString(),
    };
  }

  async anonymizeCustomer(
    customerId: string,
    reason: string,
    actorUserId: string,
  ): Promise<{ id: string; name: string; phone: string; status: CustomerStatus }> {
    return this.database.$transaction(async (transaction) => {
      const customer = await transaction.customer.findFirst({
        where: { id: customerId, accountId: this.accountId },
        select: { id: true, phone: true },
      });
      if (!customer) {
        throw new NotFoundError('Cliente não encontrado.');
      }

      // Telefone com tamanho máximo de 24 chars garantindo unicidade no tenant
      const anonymizedPhone = `ANON-${customer.id.replace(/-/g, '').slice(0, 18)}`;
      const anonymizedName = `Titular Anonimizado ${customer.id.slice(0, 8)}`;

      const updated = await transaction.customer.update({
        where: { id: customer.id },
        data: {
          name: anonymizedName,
          phone: anonymizedPhone,
          city: null,
          notes: null,
          ownerId: null,
          nextContactAt: null,
        },
        select: { id: true, name: true, phone: true, status: true },
      });

      // Anonimiza o corpo das mensagens associadas às conversas do cliente
      const customerConversations = await transaction.conversation.findMany({
        where: { accountId: this.accountId, customerId: customer.id },
        select: { id: true },
      });

      if (customerConversations.length > 0) {
        const conversationIds = customerConversations.map((c) => c.id);
        await transaction.message.updateMany({
          where: { conversationId: { in: conversationIds }, accountId: this.accountId },
          data: {
            body: '[CONTEÚDO ANONIMIZADO CONFORME LGPD]',
          },
        });
        await transaction.conversation.updateMany({
          where: { id: { in: conversationIds } },
          data: {
            lastMessagePreview: '[CONTEÚDO ANONIMIZADO]',
          },
        });
      }

      await transaction.auditLog.create({
        data: {
          accountId: this.accountId,
          actorUserId,
          action: 'UPDATE',
          entityType: 'Customer',
          entityId: customer.id,
          metadata: {
            action: 'LGPD_ANONYMIZATION',
            reason,
          },
        },
      });

      return updated;
    });
  }
}
