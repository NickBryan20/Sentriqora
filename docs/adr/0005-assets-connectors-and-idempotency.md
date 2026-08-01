# ADR 0005: Activos, conectores e idempotencia persistente

- Estado: Aceptado
- Fecha: 2026-07-31

## Contexto

La Fase 2 necesita un inventario de activos y conectores multi-organización antes de recibir y
normalizar eventos en la Fase 3. Sus comandos pueden repetirse por reintentos de red y las
credenciales de ingesta son secretos de alto impacto. Una duplicación podría crear dependencias,
claves o rotaciones inconsistentes.

## Decisión

- `resources` es un módulo NestJS con dominio, casos de uso, puertos y adaptadores independientes
  de HTTP y Prisma.
- Activos, dependencias, conectores, secretos webhook, API keys e idempotencia incluyen
  `organization_id`; claves foráneas compuestas impiden relaciones entre tenants.
- Las seis tablas organizacionales nuevas ejecutan con `aegisflow_app` y RLS habilitado y forzado.
- Crear activos, dependencias, conectores, credenciales y recibos exige `Idempotency-Key`.
  PostgreSQL toma un advisory lock transaccional por organización, ámbito y hash de clave; compara
  el hash estable de la solicitud y persiste la respuesta durante 24 horas.
- Un replay con la misma solicitud devuelve la respuesta original y marca
  `Idempotency-Replayed: true`; reutilizar la clave con otro contenido produce `409`.
- Los secretos webhook y tokens API se generan aleatoriamente, se muestran una sola vez y nunca
  aparecen en listados. Webhooks se cifran con AES-256-GCM y API keys se conservan como HMAC.
  La copia necesaria para un replay idempotente también queda cifrada.
- Webhooks usan HMAC-SHA-256 sobre `timestamp.rawBody`, comparación constante y ventana de cinco
  minutos. Los demás conectores usan API keys con scopes.
- Redis limita por endpoint/conector y por credencial+IP. Si la protección no está disponible, la
  entrada pública falla cerrada.
- La entrada de Fase 2 autentica y crea solo un recibo mínimo con outbox. No persiste ni normaliza
  el payload: ese límite pertenece a la Fase 3.
- Las configuraciones son objetos planos permitidos; no aceptan secretos ni URLs salientes. GitHub
  conserva únicamente el identificador `owner/repository`.

## Consecuencias

- Las operaciones sensibles requieren MFA reciente, permiso específico y CSRF cuando usan cookie.
- PATCH usa `version` para concurrencia optimista. DELETE archiva activos y deshabilita conectores;
  al deshabilitar un conector se revocan sus credenciales.
- El payload crudo deberá enviarse a un almacenamiento seguro en la Fase 3; el outbox actual contiene
  solo receipt ID, hashes y metadatos no sensibles.
- La limpieza programada de registros idempotentes vencidos se incorporará al trabajo operacional
  de la Fase 3 sin alterar el contrato de replay de 24 horas.
