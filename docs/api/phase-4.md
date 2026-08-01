# API de Fase 4 — detección y alertas

Prefijo: `/api/v1`. Todas las rutas requieren sesión, tenant coincidente y los permisos indicados.
Los comandos mutables también requieren CSRF.

## Reglas

- `GET /organizations/{organizationId}/detection-rules` — `detection-rule.read`.
- `POST /organizations/{organizationId}/detection-rules` — `detection-rule.manage` e
  `Idempotency-Key`. Crea una definición versionada; por defecto queda desactivada.
- `PATCH /organizations/{organizationId}/detection-rules/{ruleId}` — crea una versión inmutable
  nueva y exige `version` para concurrencia optimista.
- `POST /organizations/{organizationId}/detection-rules/{ruleId}/activation` — comando explícito
  `{ "enabled": true, "version": 1 }`.

Las condiciones permiten filtros acotados de `eventTypes`, `severities`, `assetIds`,
`messageContains` y hasta diez comparaciones de atributos (`EQUALS`, `NOT_EQUALS`, `CONTAINS`,
`GTE`, `LTE`). No se aceptan scripts ni SQL.

## Alertas

- `GET /organizations/{organizationId}/alerts` — `alert.read`; filtros por estado, severidad,
  responsable y búsqueda, con `limit` 1–100 y cursor opaco.
- `GET /organizations/{organizationId}/alerts/{alertId}` — detalle y hasta 100 eventos enmascarados.
- `GET /organizations/{organizationId}/alerts/{alertId}/graph` — grafo limitado a 200 aristas.
- `GET /organizations/{organizationId}/alerts/stream` — snapshots SSE en tiempo real.
- `POST /organizations/{organizationId}/alerts/{alertId}/triage` — `alert.triage`, asigna y cambia a
  `ACKNOWLEDGED` o `CLOSED` con versión.
- `POST /organizations/{organizationId}/alerts/{alertId}/suppression` — exige razón, versión y fin
  futuro no mayor a 30 días.

Los errores usan Problem Details y cada respuesta conserva `X-Correlation-Id`. OpenAPI completo
está disponible en desarrollo en `/api/docs`.
