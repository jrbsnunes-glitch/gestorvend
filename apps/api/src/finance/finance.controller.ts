import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { BillStatus, Recurrence } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

type RecurrenceInput = 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** Cria N datas de vencimento a partir da primeira, conforme a periodicidade. */
function buildRecurringDueDates(
  firstDue: Date,
  recurrence: RecurrenceInput,
  count: number,
): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(firstDue.getTime());
    if (recurrence === 'WEEKLY') d.setDate(d.getDate() + 7 * i);
    else if (recurrence === 'MONTHLY') d.setMonth(d.getMonth() + i);
    else if (recurrence === 'YEARLY') d.setFullYear(d.getFullYear() + i);
    out.push(d);
  }
  return out;
}

@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get('payables')
  @Roles('admin', 'manager', 'finance')
  async payables(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.accountPayable.findMany({
      orderBy: { dueDate: 'asc' },
      include: { supplier: true },
    });
  }

  @Post('payables')
  @Roles('admin', 'manager', 'finance')
  async createPayable(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      supplierId?: string | null;
      description: string;
      category?: string | null;
      amount: number;
      dueDate: string;
      recurrence?: RecurrenceInput;
      recurrenceCount?: number;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const description = String(body.description ?? '').trim();
    if (!description) {
      throw new BadRequestException('Descrição é obrigatória.');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Valor inválido.');
    }
    const firstDue = new Date(body.dueDate);
    if (Number.isNaN(firstDue.getTime())) {
      throw new BadRequestException('Vencimento inválido.');
    }
    const recurrence: RecurrenceInput = body.recurrence ?? 'NONE';
    const count = recurrence === 'NONE' ? 1 : Math.max(1, Number(body.recurrenceCount ?? 1) | 0);

    // Caso simples — uma parcela só, sem complicar.
    if (count === 1) {
      return db.accountPayable.create({
        data: {
          supplierId: body.supplierId ?? null,
          description,
          category: body.category ?? null,
          amount: amount.toFixed(2),
          dueDate: firstDue,
          status: BillStatus.OPEN,
          recurrence: Recurrence[recurrence],
        },
      });
    }

    // Recorrente: cria a parcela 1 como "âncora", e as demais apontando para ela.
    const dues = buildRecurringDueDates(firstDue, recurrence, count);
    return db.$transaction(async (tx) => {
      const parent = await tx.accountPayable.create({
        data: {
          supplierId: body.supplierId ?? null,
          description: `${description} (1/${count})`,
          category: body.category ?? null,
          amount: amount.toFixed(2),
          dueDate: dues[0],
          status: BillStatus.OPEN,
          recurrence: Recurrence[recurrence],
          recurrenceIndex: 1,
          recurrenceCount: count,
        },
      });
      for (let i = 1; i < dues.length; i++) {
        await tx.accountPayable.create({
          data: {
            supplierId: body.supplierId ?? null,
            description: `${description} (${i + 1}/${count})`,
            category: body.category ?? null,
            amount: amount.toFixed(2),
            dueDate: dues[i],
            status: BillStatus.OPEN,
            recurrence: Recurrence[recurrence],
            recurrenceIndex: i + 1,
            recurrenceCount: count,
            parentRecurringId: parent.id,
          },
        });
      }
      return parent;
    });
  }

  @Patch('payables/:id/pay')
  @Roles('admin', 'manager', 'finance')
  async payPayable(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.accountPayable.update({
      where: { id },
      data: { status: BillStatus.PAID, paidAt: new Date() },
    });
  }

  @Get('receivables')
  @Roles('admin', 'manager', 'finance')
  async receivables(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.accountReceivable.findMany({
      orderBy: { dueDate: 'asc' },
      include: { customer: true, sale: true },
    });
  }

  @Post('receivables')
  @Roles('admin', 'manager', 'finance')
  async createReceivable(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      customerId?: string | null;
      description: string;
      amount: number;
      dueDate: string;
      recurrence?: RecurrenceInput;
      recurrenceCount?: number;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const description = String(body.description ?? '').trim();
    if (!description) {
      throw new BadRequestException('Descrição é obrigatória.');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Valor inválido.');
    }
    const firstDue = new Date(body.dueDate);
    if (Number.isNaN(firstDue.getTime())) {
      throw new BadRequestException('Vencimento inválido.');
    }
    const recurrence: RecurrenceInput = body.recurrence ?? 'NONE';
    const count = recurrence === 'NONE' ? 1 : Math.max(1, Number(body.recurrenceCount ?? 1) | 0);

    if (count === 1) {
      return db.accountReceivable.create({
        data: {
          customerId: body.customerId ?? null,
          description,
          amount: amount.toFixed(2),
          dueDate: firstDue,
          status: BillStatus.OPEN,
          recurrence: Recurrence[recurrence],
        },
      });
    }

    const dues = buildRecurringDueDates(firstDue, recurrence, count);
    return db.$transaction(async (tx) => {
      const parent = await tx.accountReceivable.create({
        data: {
          customerId: body.customerId ?? null,
          description: `${description} (1/${count})`,
          amount: amount.toFixed(2),
          dueDate: dues[0],
          status: BillStatus.OPEN,
          recurrence: Recurrence[recurrence],
          recurrenceIndex: 1,
          recurrenceCount: count,
        },
      });
      for (let i = 1; i < dues.length; i++) {
        await tx.accountReceivable.create({
          data: {
            customerId: body.customerId ?? null,
            description: `${description} (${i + 1}/${count})`,
            amount: amount.toFixed(2),
            dueDate: dues[i],
            status: BillStatus.OPEN,
            recurrence: Recurrence[recurrence],
            recurrenceIndex: i + 1,
            recurrenceCount: count,
            parentRecurringId: parent.id,
          },
        });
      }
      return parent;
    });
  }

  @Patch('receivables/:id/receive')
  @Roles('admin', 'manager', 'finance')
  async receive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.accountReceivable.update({
      where: { id },
      data: { status: BillStatus.PAID, receivedAt: new Date() },
    });
  }
}
