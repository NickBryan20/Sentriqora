# API de Fase 3 — ingesta y eventos

Prefijo: `/api/v1`. Los errores conservan el envelope global y no reflejan payloads ni secretos.

## Recibir eventos

`POST /ingress/organizations/{organizationId}/connectors/{connectorId}` responde `202`.

Headers: `Content-Type`, `Idempotency-Key` y `X-API-Key`; webhook/GitHub usan además timestamp y firma
HMAC. JSON acepta un objeto o arreglo canónico. CSV requiere `eventType` y `occurredAt`. Respuesta:

```json
{
  "accepted": true,
  "duplicate": false,
  "receiptId": "uuid",
  "receivedAt": "2026-08-01T01:00:00.000Z",
  "status": "RECEIVED"
}
```

La misma clave y solicitud reproduce la respuesta con `Idempotency-Replayed: true`. Una clave HTTP
distinta con el mismo `sourceEventId` o payload devuelve el recibo original con `duplicate: true`.

## Consultar recibo

`GET /organizations/{organizationId}/event-ingestion/receipts/{receiptId}` requiere `event.read`.
Devuelve estado, conteos y tiempos, nunca el payload crudo.

## Consultar eventos normalizados

`GET /organizations/{organizationId}/events` requiere `event.read`.

Filtros opcionales: `assetId`, `connectorId`, `eventType`, `severity`, `from`, `to`, `search`, `limit`
(1–100) y `cursor`. La respuesta es `{ "data": [...], "nextCursor": "..." }`. `attributes`,
`message`, actor e IP ya están enmascarados; no existe endpoint público para leer `RawEvent`.

OpenAPI expone estos contratos en desarrollo en `/api/docs`.
