-- Fase "Pedido aceito" no fluxo delivery (só enum; UPDATE na migração seguinte — PG exige commit do novo valor).

ALTER TYPE "DeliveryOrderStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
