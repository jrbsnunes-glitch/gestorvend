import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

/**
 * Converte erros frequentes do Prisma em mensagens acionáveis (evita 500 genérico
 * quando o problema é migração de tenant não aplicada).
 */
export class PrismaKnownRequestExceptionFilter implements ExceptionFilter<PrismaClientKnownRequestError> {
  private readonly log = new Logger(PrismaKnownRequestExceptionFilter.name);

  catch(exception: PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception.code === 'P2022') {
      const meta = exception.meta as { column?: { table?: string; column?: string } } | undefined;
      const col = meta?.column?.column ?? 'desconhecida';
      const table = meta?.column?.table ?? 'desconhecida';
      this.log.warn(`P2022 (${table}.${col}) — provável migração tenant pendente`);

      response.status(HttpStatus.FAILED_DEPENDENCY).json({
        statusCode: HttpStatus.FAILED_DEPENDENCY,
        error: 'Esquema do banco tenant desatualizado',
        message:
          'O banco PostgreSQL deste cliente (tenant) não tem colunas esperadas pela API. ' +
          'Aplique as migrations em **todos** os databases dos tenants registrados no banco central — ' +
          'ex.: na pasta apps/api rode `npm run tenant:migrate-all` com CENTRAL_DATABASE_URL e ' +
          'TENANT_DATABASE_URL configurados (o script troca apenas o último segmento do nome do database).',
        prismaCode: exception.code,
        prismaMeta: exception.meta ?? null,
      });
      return;
    }

    this.log.error(exception.message, exception.stack);

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Erro ao acessar o banco',
      message: exception.message,
      prismaCode: exception.code,
      prismaMeta: exception.meta ?? null,
    });
  }
}
