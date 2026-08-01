# Resultados de verificación — Fase 2

Fecha de cierre: 31 de julio de 2026 (America/Guayaquil).

## Puerta de calidad

La puerta equivalente a `pnpm verify` terminó con código 0 usando los binarios bloqueados del
repositorio y Node.js 24.18.0:

- Prisma Client 7.9.1 generado y esquema válido;
- formato Prettier y ESLint sin advertencias;
- nueve typechecks aprobados (raíz, cuatro aplicaciones y cuatro paquetes);
- ocho builds aprobados, incluido Next.js 16 y NestJS 11;
- 26 pruebas aprobadas: API 12, dominio 10, worker 2, web 1 y simulador 1;
- configuración Docker Compose válida.

El wrapper pnpm disponible en la terminal intentó cambiar el almacén virtual y se detuvo antes de
ejecutar scripts para no purgar `node_modules`; por eso la misma secuencia se ejecutó directamente
con los binarios versionados. No se alteraron dependencias.

## Integración y aislamiento

La suite API creó PostgreSQL pgvector y Redis efímeros, aplicó las tres migraciones desde una base
vacía y aprobó cuatro escenarios integrales:

- RLS impide lectura y modificación cruzada entre organizaciones;
- `event_records` continúa append-only para el rol de aplicación;
- idempotencia crea un único activo, reproduce la respuesta y rechaza otro payload con `409`;
- HTTP completo: registro, MFA, CSRF, activo, conectores, rotación webhook, firma HMAC, API key con
  scope, receipt de ingesta y replay del mismo receipt ID.

## PostgreSQL persistente

La migración `20260731230000_phase_2_assets_connectors` fue aplicada. La comprobación directa
confirmó:

```text
vector:0.8.1
phase_2_migration:true
phase_2_permissions:7
assets_rls:true/true
asset_dependencies_rls:true/true
connectors_rls:true/true
webhook_secrets_rls:true/true
api_keys_rls:true/true
idempotency_records_rls:true/true
```

El primer intento de la migración fue revertido automáticamente por una restricción existente del
formato de permisos. Los identificadores se corrigieron de guion bajo a guion medio, Prisma marcó
el intento como rolled back y el segundo intento se aplicó de forma atómica sin pérdida de datos.

## Imagen y operación

- Imagen API final: `sha256:3b9ee36f1887c21caf44e7e403e01c36f79edb60244cc77d4f94233b62d4407a`.
- Migrador: exit code 0, sin migraciones pendientes.
- Readiness: `up` para PostgreSQL, Redis y MinIO.
- Swagger: HTTP 200 y rutas de assets e ingress presentes en OpenAPI.
- pgvector: imagen `pgvector/pgvector:0.8.1-pg17-bookworm`, puerto local 5433.

## Observación no bloqueante

La suite conserva la advertencia de deprecación de `pg` 8.22.0 ya registrada en Fase 1 sobre
`client.query()` concurrente. No falla pruebas ni runtime; debe resolverse antes de adoptar pg 9.
