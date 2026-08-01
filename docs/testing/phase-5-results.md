# Resultados de verificación — fase 5

Fecha: 2026-08-01

## Resultado

La fase 5 quedó aprobada para continuar. La validación se ejecutó con Node.js 24.18.0,
PostgreSQL 17 + pgvector 0.8.1, Redis 8.2.1, MinIO y Docker Compose v2.

| Control          | Resultado                                                                               |
| ---------------- | --------------------------------------------------------------------------------------- |
| Prisma           | esquema válido; seis migraciones aplicadas desde cero y sobre el stack existente        |
| Dominio          | creación automática, prioridad, transiciones, análisis y SLA aprobados                  |
| Incidentes       | relaciones alerta/evento, timeline y replay idempotente aprobados                       |
| API              | cursor/SSE, asignación, estados, comentarios, análisis, SLA y notificaciones compilados |
| Evidencias       | extensión/MIME/tamaño/hash, cuarentena, contenido activo y claves privadas aprobados    |
| Pruebas totales  | 61: API 25, dominio 19, contratos 8, worker 3, web 3 y simulador 3                      |
| TypeScript       | ocho proyectos en modo estricto aprobados                                               |
| Lint/formato     | ESLint sin warnings y Prettier aprobado                                                 |
| Builds           | ocho builds aprobados, incluido Next.js con lista y detalle de incidentes               |
| Docker           | desarrollo/producción válidos; migración aplicada y servicios activos                   |
| pgvector y RLS   | pgvector 0.8.1; ocho tablas nuevas con RLS forzado; rol sin `BYPASSRLS`                 |
| Permisos/SLA     | 27 permisos; cinco políticas SLA creadas por organización nueva                         |
| Observabilidad   | API y worker `up` en Prometheus; métricas y tres paneles de incidentes activos          |
| Smoke desplegado | alerta crítica → incidente P1 en 561 ms; outbox y notificación publicados               |

## Evidencia funcional

- El worker recibió `alert.created.v1`, creó un incidente `P1/CRITICAL`, lo vinculó a la alerta y
  conservó una única instancia ante replay.
- El incidente smoke generó tres entradas de timeline y una notificación interna entregada.
- Las colas `aegisflow-incidents` y `aegisflow-notifications` arrancaron y procesaron trabajos.
- La readiness reportó PostgreSQL, Redis y MinIO en estado `up`.
- `/incidents` y `/incidents/{id}` respondieron HTTP 200; la API sin sesión respondió 401.
- Nginx resolvió la nueva IP de API después de recrearla sin reiniciar el proxy.

## Evidencia de seguridad

- Testcontainers confirmó aislamiento cruzado de incidentes bajo el rol `aegisflow_app`.
- El bucket rechazó acceso anónimo con HTTP 403. Su preflight CORS aceptó únicamente el origen local
  configurado y los encabezados de metadatos firmados.
- Las URLs firmadas duran 300 segundos para carga y 60 para descarga; el secreto y `objectKey` no se
  exponen.
- El adaptador rechazó EICAR/contenido activo y verificó hash, tamaño, MIME y firma antes de liberar.
- Creación, asignación, transición, evidencia y configuración SLA requieren los permisos definidos;
  las acciones críticas exigen MFA, CSRF y auditoría.

## Observaciones

- La construcción inicial de imágenes agotó el límite del comando mientras BuildKit continuó en
  segundo plano. Se terminó la imagen web por separado y Compose se reconcilió sin eliminar
  volúmenes.
- El adaptador de correo local registra únicamente hash de destinatario y longitudes. Producción
  debe configurar un proveedor transaccional mediante el puerto documentado.
