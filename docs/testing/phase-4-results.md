# Resultados de verificación — Fase 4

Fecha: 2026-08-01

## Resultado

La Fase 4 quedó aprobada para continuar a Fase 5. La validación se ejecutó con Node.js 24.18.0,
pnpm 11.9.0, PostgreSQL 17 + pgvector 0.8.1, Redis 8.2.1 y Docker Compose v2.

| Control                    | Resultado                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Prisma                     | esquema válido; cinco migraciones aplicadas desde cero en Testcontainers                   |
| Motor de detección         | reglas versionadas, ventanas, umbrales y evaluación determinística aprobados               |
| Anomalías                  | baseline horario, media móvil, z-score y riesgo acotado persistidos                        |
| Alertas                    | deduplicación, prioridad, asignación, triage, supresión y estados aprobados                |
| Correlación                | claves por usuario, IP, activo, tipo e indicador; aristas de grafo persistidas             |
| API y tiempo real          | CRUD/activación, cursor, detalle, grafo, triage, supresión y SSE protegidos por permisos   |
| Pruebas totales            | 46 casos: API 18, worker 3, web 2, simulador 3, contratos 5 y dominio 15                   |
| TypeScript                 | ocho proyectos en modo estricto aprobados                                                  |
| Lint/formato               | ESLint sin warnings en ocho proyectos y Prettier aprobado                                  |
| Builds                     | ocho builds aprobados, incluido el build optimizado de Next.js                             |
| Docker                     | configuración válida; API sana, worker/web activos y dependencias saludables               |
| Observabilidad             | métricas de detección expuestas; target `aegisflow-worker` en estado `up` en Prometheus    |
| Smoke test desplegado      | alerta `CRITICAL` abierta, score 100, outbox publicado y latencia de 156.135 ms            |
| pgvector y aislamiento RLS | pgvector 0.8.1; siete tablas nuevas con RLS forzado y pruebas cruzadas de tenant aprobadas |

## Evidencia funcional

- El outbox publicó `normalized_event.batch_created.v1` y BullMQ entregó el lote a la cola de
  detección.
- El worker creó una ejecución de regla coincidente con conteo observado 1, un score de anomalía y
  una alerta crítica con riesgo 100.
- La alerta se generó en 156.135 ms desde el evento del outbox, por debajo del objetivo de cinco
  segundos.
- La consola `/detections` respondió HTTP 200 y el build produjo las rutas de lista y detalle de
  alertas.
- La readiness de API reportó PostgreSQL, Redis y MinIO en estado `up`.

## Evidencia de seguridad y resiliencia

- Permisos independientes protegen lectura/gestión de reglas y lectura/triage de alertas.
- Las mutaciones exigen CSRF y control de concurrencia optimista atómico; la creación repetible de
  reglas exige además una clave de idempotencia persistente.
- Las siete entidades de Fase 4 usan claves compuestas por organización y RLS forzado.
- La supresión está limitada a 30 días; los filtros, tamaños de página, condiciones y dimensiones de
  correlación están acotados.
- Una regresión fuerza precisión de microsegundos en PostgreSQL y confirma que el evento límite no se
  pierde al convertirse a `Date`; el límite temporal se obtiene directamente de la base de datos.
- El reprocesamiento conserva una sola ejecución por versión de regla y evento normalizado.

## Observaciones

- Las suites se ejecutaron con la configuración de cada proyecto para respetar `jsdom` y los timeouts
  de Testcontainers.
- La conversión de alertas en incidentes pertenece expresamente a la Fase 5 y no se adelantó en esta
  entrega.
