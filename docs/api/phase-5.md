# API de fase 5 — incidentes

Prefijo: `/api/v1`. Todas las rutas requieren sesión y tenant coincidente. Las mutaciones requieren
CSRF; creación, asignación, transición, SLA y evidencias requieren MFA.

## Incidentes

- `GET /organizations/{organizationId}/incidents` — `incident.read`, filtros y cursor opaco.
- `GET /organizations/{organizationId}/incidents/stream` — snapshots SSE acotados.
- `GET /organizations/{organizationId}/incidents/{incidentId}` — detalle, timeline y relaciones.
- `GET /organizations/{organizationId}/incidents/{incidentId}/graph` — grafo acotado.
- `POST /organizations/{organizationId}/incidents` — `incident.manage`, MFA e
  `Idempotency-Key`; vincula una o más alertas.
- `POST /organizations/{organizationId}/incidents/{incidentId}/assignment` — responsable y versión.
- `POST /organizations/{organizationId}/incidents/{incidentId}/transitions` — estado, motivo,
  análisis requerido y versión.
- `PATCH /organizations/{organizationId}/incidents/{incidentId}/analysis` — causa raíz y lecciones.
- `POST /organizations/{organizationId}/incidents/{incidentId}/comments` — comentario append-only e
  idempotente.

## Evidencias, SLA y notificaciones

- `POST .../evidence/upload-requests` — `incident.evidence`, MFA e `Idempotency-Key`; acepta JSON,
  PDF, CSV, texto, JPEG o PNG hasta 10 MiB.
- `POST .../evidence/{evidenceId}/completion` — pone en cuarentena, verifica y libera o rechaza.
- `GET .../evidence/{evidenceId}/download-url` — URL privada de 60 segundos, solo para `AVAILABLE`.
- `GET /organizations/{organizationId}/sla-policies` y
  `PATCH /organizations/{organizationId}/sla-policies/{policyId}`.
- `GET /organizations/{organizationId}/notifications` y
  `POST /organizations/{organizationId}/notifications/{notificationId}/read`.

Los conflictos de versión devuelven 409 y los errores usan Problem Details. Las claves de objeto,
payloads de correo y datos de otros tenants no forman parte de las respuestas.
