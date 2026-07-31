# ADR 0003: PostgreSQL, Outbox y fronteras de organización

- Estado: Aceptado
- Fecha: 2026-07-31

## Contexto

Las decisiones de seguridad e incidentes requieren consistencia, trazabilidad y posterior
publicación confiable de eventos.

## Decisión

PostgreSQL 17 con pgvector será la fuente de verdad. La migración inicial habilita `vector` y
`pgcrypto` y crea la infraestructura Outbox. `organizationId` viajará por contexto de solicitud y
se exigirá en repositorios de recursos organizacionales. La Fase 1 añadirá RLS y pruebas cruzadas
de tenant junto con las entidades de identidad.

## Consecuencias

- Los eventos se publican después de confirmar la transacción de negocio.
- El aislamiento se aplica en aplicación, persistencia y, donde sea viable, PostgreSQL.
- El dispatcher debe manejar reintentos sin guardar errores o payloads sensibles en logs.
