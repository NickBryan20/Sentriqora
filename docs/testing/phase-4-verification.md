# Plan de verificación — Fase 4

1. Formatear, validar y generar Prisma; aplicar todas las migraciones sobre PostgreSQL 17 + pgvector.
2. Probar contratos de reglas vacías, operadores, límites y supresión.
3. Probar coincidencia determinística, claves de ventana, z-score, media móvil y riesgo acotado.
4. Probar comandos API: tenant, idempotencia, concurrencia y máximo de supresión.
5. Ejecutar PostgreSQL y Redis reales: outbox, cola de detección, anomalía, ejecución, alerta y replay.
6. Cambiar el tenant RLS y confirmar que reglas, ejecuciones, scores, alertas y grafo quedan ocultos.
7. Verificar SSE, consola responsive, navegación por teclado, foco visible y reducción de movimiento.
8. Verificar métricas del worker, paneles Grafana y logs sin contenido sensible.
9. Ejecutar formato, lint, typecheck, pruebas, builds, Prisma y configuración Compose.
10. Reconstruir el stack, aplicar migración, crear una regla y confirmar alerta crítica en menos de
    cinco segundos desde la recepción en el entorno local.
