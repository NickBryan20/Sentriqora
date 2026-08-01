# API de Fase 2 — activos y conectores

Base URL: `/api/v1`. Los comandos autenticados por cookie requieren `X-CSRF-Token`; operaciones
de credenciales/deshabilitación requieren además MFA reciente. Errores siguen RFC 9457 mediante
`application/problem+json` con `code` y `correlationId`.

## Activos y dependencias

| Método   | Ruta                                                                 | Permiso        |
| -------- | -------------------------------------------------------------------- | -------------- |
| `GET`    | `/organizations/{organizationId}/assets`                             | `asset.read`   |
| `GET`    | `/organizations/{organizationId}/assets/{assetId}`                   | `asset.read`   |
| `POST`   | `/organizations/{organizationId}/assets`                             | `asset.manage` |
| `PATCH`  | `/organizations/{organizationId}/assets/{assetId}`                   | `asset.manage` |
| `DELETE` | `/organizations/{organizationId}/assets/{assetId}`                   | `asset.manage` |
| `POST`   | `/organizations/{organizationId}/assets/{assetId}/dependencies`      | `asset.manage` |
| `DELETE` | `/organizations/{organizationId}/assets/{assetId}/dependencies/{id}` | `asset.manage` |

POST exige `Idempotency-Key`. PATCH exige la versión leída; una escritura concurrente devuelve
`409`. DELETE archiva el activo y conserva historial/dependencias.

## Conectores y credenciales

| Método   | Ruta                                                                              | Permiso / requisito             |
| -------- | --------------------------------------------------------------------------------- | ------------------------------- |
| `GET`    | `/organizations/{organizationId}/connectors`                                      | `connector.read`                |
| `GET`    | `/organizations/{organizationId}/connectors/{connectorId}`                        | `connector.read`                |
| `POST`   | `/organizations/{organizationId}/connectors`                                      | `connector.manage`              |
| `PATCH`  | `/organizations/{organizationId}/connectors/{connectorId}`                        | `connector.manage`              |
| `DELETE` | `/organizations/{organizationId}/connectors/{connectorId}`                        | `connector.manage` + MFA        |
| `POST`   | `/organizations/{organizationId}/connectors/{connectorId}/webhook-secrets/rotate` | `connector.secret.rotate` + MFA |
| `GET`    | `/organizations/{organizationId}/connectors/{connectorId}/api-keys`               | `api-key.read`                  |
| `POST`   | `/organizations/{organizationId}/connectors/{connectorId}/api-keys`               | `api-key.manage` + MFA          |
| `DELETE` | `/organizations/{organizationId}/connectors/{connectorId}/api-keys/{apiKeyId}`    | `api-key.manage` + MFA          |

Crear y rotar exige `Idempotency-Key`. El secreto/token solo aparece en la respuesta de creación
o en su replay seguro con la misma clave durante 24 horas. Los listados muestran únicamente
prefijo, scopes, expiración, uso y revocación.

## Entrada autenticada

`POST /ingress/organizations/{organizationId}/connectors/{connectorId}` devuelve `202`.

Cabeceras comunes:

- `Idempotency-Key`: obligatoria, 8–128 caracteres seguros.
- Para REST/importadores/simulador: `X-API-Key` con scope `connector.ingest`.
- Para webhook/GitHub: `X-Webhook-Timestamp` en epoch seconds y
  `X-Webhook-Signature: sha256=<hex>`, calculada sobre `timestamp + "." + rawBody`.

La ventana de firma es cinco minutos y el tamaño máximo 1 MiB. La respuesta contiene
`accepted`, `receiptId` y `receivedAt`. `Idempotency-Replayed` indica si la respuesta fue
recuperada. La normalización y persistencia completa del evento comienzan en Fase 3.

Swagger se expone en desarrollo en `/api/docs`.
