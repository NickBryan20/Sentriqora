# Plan de verificación — fase 5

1. Formatear, validar y generar Prisma; aplicar las seis migraciones desde cero sobre PostgreSQL 17
   con pgvector.
2. Probar política de creación automática, prioridad, transiciones, análisis obligatorio y SLA.
3. Probar API: tenant, MFA, metadatos de evidencia, cursor, idempotencia y conflictos de versión.
4. Ejecutar PostgreSQL y Redis reales: alerta crítica, outbox, cola, incidente, relaciones,
   notificación y replay idempotente.
5. Cambiar el contexto tenant y confirmar que incidente y relaciones quedan ocultos por RLS.
6. Validar bucket privado, URL firmada, hash/tamaño/MIME, cuarentena, contenido rechazado y descarga
   únicamente de evidencia disponible.
7. Verificar consola de lista/detalle, filtros, timeline, grafo, comentarios y flujo de evidencia.
8. Comprobar métricas de incidentes, incumplimientos SLA y notificaciones en Prometheus/Grafana.
9. Ejecutar formato, lint, TypeScript estricto, pruebas, builds y configuración Compose.
10. Reconstruir el stack y confirmar incidente crítico y notificación en menos de cinco segundos.
