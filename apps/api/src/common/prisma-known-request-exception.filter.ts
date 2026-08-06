import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

type PrismaKnownError = {
  code: string;
  message: string;
  meta?: unknown;
  stack?: string;
};

/**
 * Reconhece erro conhecido do Prisma pela forma, não pela classe: os clientes
 * gerados em `src/generated/*` embutem o próprio runtime, então `instanceof`
 * vindo de `@prisma/client` não vale para todos eles.
 */
function asPrismaKnownError(exception: unknown): PrismaKnownError | null {
  if (!exception || typeof exception !== 'object') return null;
  const e = exception as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    meta?: unknown;
    stack?: unknown;
  };
  if (typeof e.code !== 'string' || typeof e.message !== 'string') return null;
  const looksPrisma = e.name === 'PrismaClientKnownRequestError' || /^P\d{4}$/.test(e.code);
  if (!looksPrisma) return null;
  return {
    code: e.code,
    message: e.message,
    meta: e.meta,
    stack: typeof e.stack === 'string' ? e.stack : undefined,
  };
}

/**
 * Converte erros frequentes do Prisma em mensagens acionáveis (evita 500 genérico
 * quando o problema é migração de tenant não aplicada).
 *
 * Como é filtro global sem `@Catch`, tudo passa por aqui — inclusive as exceções
 * HTTP do Nest. Elas precisam sair com o status original: o front renova a
 * sessão no 401 e trata licença no 403, e validação de formulário precisa de 400.
 */
export class PrismaKnownRequestExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(PrismaKnownRequestExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response
        .status(status)
        .json(
          typeof body === 'string' ? { statusCode: status, message: body } : body,
        );
      return;
    }

    const prisma = asPrismaKnownError(exception);

    if (prisma?.code === 'P2022') {
      const meta = prisma.meta as { column?: { table?: string; column?: string } } | undefined;
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
        prismaCode: prisma.code,
        prismaMeta: prisma.meta ?? null,
      });
      return;
    }

    if (prisma) {
      this.log.error(prisma.message, prisma.stack);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Erro ao acessar o banco',
        message: prisma.message,
        prismaCode: prisma.code,
        prismaMeta: prisma.meta ?? null,
      });
      return;
    }

    const err = exception instanceof Error ? exception : null;
    this.log.error(err?.message ?? String(exception), err?.stack);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Erro interno',
      message: err?.message ?? 'Falha inesperada no servidor.',
    });
  }
}
