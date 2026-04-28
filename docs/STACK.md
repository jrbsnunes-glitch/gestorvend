# Stack definida — GestorVend

| Camada | Tecnologia |
|--------|------------|
| API | NestJS 10 + TypeScript |
| ORM | Prisma 5 + PostgreSQL 16 |
| Frontend | React 18 + Vite 5 + TanStack Query + React Router |
| UI | CSS modules + variáveis CSS (base limpa; evolui para shadcn/MUI) |
| Auth | JWT (@nestjs/jwt) + Passport + bcrypt |
| Cache / filas | Redis (Docker); BullMQ preparado para jobs |
| Multi-tenant | Banco `gestorvend_central` + um database por tenant (`tenant_<slug>`) |

Monorepo npm workspaces: `apps/api`, `apps/web`, `packages/shared-types`.
