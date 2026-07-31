# AegisFlow

AegisFlow es una plataforma web multi-organización para recolectar eventos tecnológicos,
correlacionar señales, gestionar incidentes y asistir decisiones con evidencia. El proyecto se
implementa por fases; actualmente contiene la **Fase 0 — Bootstrap** verificable. Identidad,
ingesta, detección, incidentes, RAG y playbooks se incorporarán en el orden documentado en
`Prompt_Maestro.md`.

## Estado de Fase 0

- Monorepo pnpm + Turborepo con TypeScript estricto.
- Next.js web, NestJS API, worker BullMQ y simulador CLI.
- PostgreSQL + pgvector, Redis, MinIO, Nginx, Prometheus, Grafana y OpenTelemetry.
- Migración inicial reproducible y tabla Outbox fundacional.
- Health, readiness, métricas, OpenAPI, logs redactados y correlation ID.
- CI de calidad y migraciones con Actions fijadas por SHA.

## Inicio rápido

Requisitos: Node.js 24 LTS, pnpm 11, Git y Docker Compose v2.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up --build -d
```

Servicios principales:

- Aplicación: `http://localhost:8080`
- OpenAPI en desarrollo: `http://localhost:8080/api/docs`
- Readiness: `http://localhost:8080/api/v1/health/ready`
- Grafana: `http://localhost:3002`
- Consola MinIO: `http://localhost:9001`

La contraseña PostgreSQL `200520` y las demás credenciales del ejemplo son exclusivas para
desarrollo local. Producción exige valores aleatorios administrados como secretos.

## Desarrollo sin contenedores de aplicación

Levante las dependencias con Docker y ejecute las aplicaciones desde el host:

```bash
docker compose up -d postgres redis minio minio-init otel-collector prometheus grafana
pnpm install --frozen-lockfile
pnpm prisma:migrate:deploy
pnpm dev
```

Use `DATABASE_URL_LOCAL`, `REDIS_URL_LOCAL` y `MINIO_ENDPOINT_LOCAL` para procesos en el host.

## Calidad

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm prisma:validate
docker compose config --quiet
```

Arquitectura, ADR y verificación están en `docs/`. Consulte `SECURITY.md` antes de desplegar o
reportar una vulnerabilidad.

---

## English

AegisFlow is a multi-organization web platform for collecting technology events, correlating
signals, managing incidents, and assisting evidence-based decisions. Development follows explicit
phases; the repository currently contains the verifiable **Phase 0 — Bootstrap**. Identity,
ingestion, detection, incidents, RAG, and playbooks will be added in the order defined by
`Prompt_Maestro.md`.

### Phase 0 status

- pnpm + Turborepo monorepo with strict TypeScript.
- Next.js web, NestJS API, BullMQ worker, and simulator CLI.
- PostgreSQL + pgvector, Redis, MinIO, Nginx, Prometheus, Grafana, and OpenTelemetry.
- Reproducible initial migration and foundational Outbox table.
- Health, readiness, metrics, OpenAPI, redacted logs, and correlation IDs.
- Quality and migration CI with Actions pinned to full commit SHAs.

### Quick start

Requirements: Node.js 24 LTS, pnpm 11, Git, and Docker Compose v2.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up --build -d
```

Open `http://localhost:8080`. The PostgreSQL password `200520` and every example credential are
local-development values only. Production requires random values supplied by a secret manager.

### Verification

Run `pnpm verify` and `docker compose config --quiet`. See `docs/` for architecture, ADRs, setup,
and the recorded phase verification strategy.
