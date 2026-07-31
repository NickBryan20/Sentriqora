# Resultados de verificación — Fase 1

Fecha de cierre: 31 de julio de 2026.

## Puerta de calidad

`pnpm verify` terminó con código 0 e incluyó:

- política de runtime Node.js 24.18.0;
- generación y validación del cliente/esquema Prisma 7.9.1;
- formato, lint y typecheck de todo el monorepo;
- 11 tareas de prueba y 8 tareas de build completadas;
- 21 pruebas aprobadas: API 11, dominio 6, worker 2, web 1 y simulador 1.

La integración de API creó PostgreSQL pgvector y Redis efímeros, aplicó las migraciones desde una
base vacía y aprobó tres escenarios: aislamiento RLS entre organizaciones, bitácora append-only y
flujo HTTP de registro, MFA, CSRF, autorización por tenant, sesiones y revocación.

`docker compose config --quiet` también terminó con código 0.

## Persistencia y migraciones

El stack persistente confirmó:

```text
pgcrypto:1.3
vector:0.8.1
permissions:10
forced_rls:11
20260731120000_phase_0_bootstrap:true
20260731170000_phase_1_identity_tenancy:true
```

El job `migrate` terminó con código 0 y reportó que no existen migraciones pendientes.

## Imagen y operación

- Imagen final de API: `sha256:a9606a853b4e6fd715f577846b37785d870c3465f06d8f7f4f5eb90bc245fddd`.
- API, PostgreSQL, Redis y MinIO: saludables.
- Logs de arranque de API: cero advertencias y cero errores.
- Swagger: HTTP 200 en `/api/docs`.
- Readiness: `up` en `/api/v1/health/ready`.

El smoke test contra Nginx y los contenedores persistentes produjo:

```json
{
  "registered": true,
  "loginMfaRequired": false,
  "principalMatches": true,
  "sessionCount": 1,
  "revokedSessions": 1,
  "readiness": "up",
  "swagger": 200,
  "csrfLoggedRedacted": true
}
```

## Observación no bloqueante

La suite de integración emite una advertencia de deprecación de `pg` 8.22.0 sobre llamadas
concurrentes a `client.query()` a través del adaptador Prisma. No afecta las pruebas ni el runtime
actual; debe revisarse antes de adoptar `pg` 9.
