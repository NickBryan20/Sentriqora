# Resultados de verificación — Fase 3

Fecha: 2026-08-01

## Resultado

La Fase 3 quedó aprobada para continuar a Fase 4. La validación se ejecutó con Node.js 24.18.0,
pnpm 11.9.0, PostgreSQL 17 + pgvector 0.8.1, Redis 8.2.1 y Docker Compose v2.

| Control                    | Resultado                                                                      |
| -------------------------- | ------------------------------------------------------------------------------ |
| Prisma generate/validate   | esquema válido y cliente generado                                              |
| Migraciones Testcontainers | cuatro migraciones aplicadas desde cero sobre pgvector                         |
| Integración API            | 4 pruebas reales: RLS, HTTP, cifrado, replay/deduplicación y recibos           |
| Integración worker         | PostgreSQL → outbox → Redis/BullMQ → máscara → normalized, aprobada            |
| Pruebas totales            | 37 casos distribuidos por configuración de API, worker, web y librerías        |
| TypeScript                 | ocho proyectos con modo estricto aprobados                                     |
| Lint/formato               | ESLint sin warnings y Prettier aprobado                                        |
| Builds                     | siete builds TypeScript y build optimizado Next.js aprobados                   |
| Docker                     | lockfile congelado (1.306 entradas) y cinco imágenes de aplicación construidas |
| Runtime local              | migración `20260801010000_phase_3_event_ingestion`, API/worker/web sanos       |
| pgvector                   | extensión 0.8.1 verificada en la base persistente                              |
| Simulador                  | imagen ejecutada contra API; modo `health-probe` reportó `up`                  |

## Evidencia de seguridad

- `aegisflow_app` conserva `BYPASSRLS=false`; `aegisflow_outbox` usa `BYPASSRLS=true` pero sólo tiene
  grants de lectura/actualización sobre el outbox.
- El payload de integración no aparece en el sobre cifrado, la respuesta ni los logs. En el evento
  normalizado, secretos son `[REDACTED]` y usuarios/IP son HMAC.
- Un contexto del tenant B obtuvo cero filas del evento creado para tenant A.
- Reprocesar el mismo raw event conservó una única fila por `(raw_event_id, record_index)`.

## Observaciones

- Vitest debe ejecutarse con la configuración de cada aplicación; una ejecución única desde la raíz
  no hereda `jsdom` ni los timeouts de Testcontainers. Los resultados de la tabla usan las
  configuraciones de proyecto correctas.
- El objetivo de al menos 100 eventos/s está respaldado por inserción por lotes y concurrencia 8, pero
  una prueba de carga sostenida con percentiles y presupuesto de infraestructura sigue siendo requisito
  antes de producción.
