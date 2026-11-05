-- Pedidos no balcão aguardando cozinha passam a "aceito" (antes eram RECEIVED)

UPDATE "ServiceTab"
SET "deliveryStatus" = 'ACCEPTED'::"DeliveryOrderStatus"
WHERE "deliveryStatus" = 'RECEIVED'::"DeliveryOrderStatus"
  AND "deliveryPrintStatus" = 'PENDING_COUNTER'::"DeliveryPrintStatus"
  AND "fulfillment" IN ('DELIVERY', 'PICKUP');
