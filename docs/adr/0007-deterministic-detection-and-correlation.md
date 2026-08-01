# ADR 0007: detección determinística, explicable e idempotente

- Estado: aceptado
- Fecha: 2026-08-01

## Contexto

La ingesta de Fase 3 publica lotes de eventos normalizados y enmascarados. La detección necesita
umbrales temporales, puntuación de anomalía y correlación sin volver a exponer el payload crudo ni
crear alertas duplicadas cuando BullMQ reintenta un trabajo.

## Decisión

- El outbox despacha `normalized_event.batch_created.v1` a una cola BullMQ separada.
- Las reglas usan un contrato JSON limitado; no se acepta código, expresiones dinámicas ni `eval`.
- Cada cambio produce una versión inmutable. `RuleExecution` es único por versión y evento.
- La anomalía usa conteos horarios, media móvil y z-score explicable almacenado como `numeric`.
- Una alerta se deduplica por regla, versión, dimensiones de correlación y bucket temporal.
- La correlación persiste aristas por usuario/IP seudonimizados, activo, tipo o fingerprint.
- Todo acceso usa el rol `aegisflow_app`, transacciones con contexto de tenant y RLS forzado.
- Los incidentes y su conversión quedan explícitamente fuera de esta fase.

## Consecuencias

La ejecución es reproducible, auditable y resistente a reintentos. Las ventanas se evalúan en
memoria sobre un conjunto limitado a 10 001 eventos; el crecimiento sostenido requerirá
particionamiento y agregados temporales, sin cambiar el contrato de dominio.
