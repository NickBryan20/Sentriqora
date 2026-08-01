# Plan de verificación — Fase 3

1. Validar y generar Prisma; aplicar todas las migraciones sobre PostgreSQL 17 con pgvector.
2. Verificar contratos JSON/CSV, límites, profundidad y confusión de `Content-Type`.
3. Verificar política determinista de seudonimización y redacción de secretos, correo, IP y tokens.
4. Ejecutar flujo HTTP real con PostgreSQL/Redis: persistencia cifrada, idempotencia y recibo seguro.
5. Ejecutar dispatcher + BullMQ + worker reales: outbox publicado, normalización por lote y replay sin
   duplicados.
6. Cambiar el contexto RLS a otro tenant y confirmar que raw/normalized no son visibles.
7. Ejecutar formato, lint, typecheck, pruebas, builds, validación Prisma y `docker compose config`.
8. Reconstruir el stack, comprobar salud y ejecutar una ingesta de demostración.

El objetivo inicial de diseño es sostener al menos 100 eventos/s con lotes, ocho procesadores y cola
observable. Una prueba de carga sostenida y umbrales P95 se registrará antes de producción.
