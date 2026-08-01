# AegisFlow

AegisFlow es una plataforma web multi-organización para recolectar eventos tecnológicos,
correlacionar señales, gestionar incidentes y asistir decisiones con evidencia. El proyecto se
implementa por fases; actualmente contiene las fases verificables **Fase 0 — Bootstrap**,
**Fase 1 — Identidad y multi-tenancy**, **Fase 2 — Activos y conectores**, **Fase 3 — Ingestión de
eventos**, **Fase 4 — Detección, alertas y correlación**, **Fase 5 — Incidentes** y **Fase 6 — RAG
e IA segura**. La fase de playbooks se incorporará en el orden documentado en `Prompt_Maestro.md`.

## Estado de Fase 0

- Monorepo pnpm + Turborepo con TypeScript estricto.
- Next.js web, NestJS API, worker BullMQ y simulador CLI.
- PostgreSQL + pgvector, Redis, MinIO, Nginx, Prometheus, Grafana y OpenTelemetry.
- Migración inicial reproducible y tabla Outbox fundacional.
- Health, readiness, métricas, OpenAPI, logs redactados y correlation ID.
- CI de calidad y migraciones con Actions fijadas por SHA.

## Estado de Fase 1

- Usuarios, organizaciones, membresías, invitaciones, roles y permisos RBAC+ABAC.
- Contraseñas Argon2id, MFA TOTP cifrado y recovery codes de un solo uso.
- Access cookie corta, refresh tokens rotativos con replay detection, CSRF y revocación global.
- PostgreSQL RLS forzado mediante un rol de aplicación sin privilegios.
- Pruebas Testcontainers de migración, flujo HTTP y fuga/modificación entre tenants.

## Estado de Fase 2

- Inventario de activos, criticidad, responsables, etiquetas y dependencias tipadas.
- Conectores webhook, REST, JSON/CSV, GitHub y simulador con configuración no secreta.
- Secretos webhook rotables y cifrados; API keys con scopes, expiración y revocación.
- Idempotencia PostgreSQL con replay seguro, auditoría y outbox transaccional.
- Entrada autenticada por HMAC/API key, límite Redis y aislamiento RLS forzado.

## Estado de Fase 3

- Recepción JSON/CSV estricta con límites de tamaño, profundidad y número de registros.
- `RawEvent` cifrado, deduplicación semántica, auditoría y outbox en una sola transacción.
- Dispatcher de privilegios mínimos, cola BullMQ y worker multi-tenant con reintentos idempotentes.
- `NormalizedEvent` con PII seudonimizada y secretos, tokens, correos e IP enmascarados.
- Consulta segura por cursor, recibos sin payload crudo, métricas y simulador de eventos.

## Estado de Fase 4

- Reglas determinísticas versionadas con umbrales, ventanas, severidad y activación explícita.
- Media móvil y z-score explicable; riesgo preciso con `numeric` y rango 0–100.
- Worker BullMQ idempotente, alertas deduplicadas y correlación por señal enmascarada.
- Estados, asignación, supresión temporal controlada, API cursor y snapshots SSE.
- Consola web accesible, grafo acotado, métricas Prometheus y dashboard Grafana.

## Estado de Fase 5

- Incidentes automáticos para alertas críticas o riesgo alto, idempotentes y multi-tenant.
- Estados y transiciones validadas, responsable, comentarios, causa raíz y lecciones aprendidas.
- SLA de respuesta/resolución, evaluación diferida y notificaciones internas/correo desacopladas.
- Evidencias privadas en MinIO con SHA-256, límites, cuarentena, inspección y URLs breves.
- Timeline auditable, concurrencia optimista, API cursor/SSE y grafo de alcance.
- Consola web de respuesta y métricas Prometheus con paneles Grafana.

## Estado de Fase 6

- Documentos privados y versionados en MinIO, sanitización, clasificación de confianza y outbox.
- Worker BullMQ idempotente, chunks acotados y embeddings de 768 dimensiones en pgvector/HNSW.
- Puertos intercambiables con adaptadores OpenAI, Ollama y proveedor determinista sin credenciales.
- Recuperación aislada por RLS, versión y modelo; confianza ponderada y abstención obligatoria.
- Salida Zod, citas permitidas, bloqueo de HTML/URLs/comandos, trazabilidad de tokens y latencia.
- Consola web de conocimiento y recomendaciones con fuentes renderizadas como texto seguro.

## Inicio rápido

Requisitos: Node.js 24 LTS, pnpm 11, Git y Docker Compose v2.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm prisma:generate
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
Genere una identidad de prueba mediante `POST /api/v1/auth/register`; el repositorio no incluye
contraseñas demo fijas.

La configuración predeterminada `AI_PROVIDER=deterministic` funciona sin red ni clave. Para OpenAI,
configure `AI_PROVIDER=openai` y `OPENAI_API_KEY`; para Ollama use `AI_PROVIDER=ollama` y asegure que
los modelos declarados estén instalados. Nunca incluya la clave en Git ni la envíe al navegador.

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
phases; the repository currently contains the verifiable **Phase 0 — Bootstrap**, **Phase 1 —
Identity and multi-tenancy**, **Phase 2 — Assets and connectors**, **Phase 3 — Event ingestion**, and
**Phase 4 — Detection, alerts, and correlation**, **Phase 5 — Incidents**, and **Phase 6 — Secure
RAG and AI**. Playbooks will be added in the order defined by `Prompt_Maestro.md`.

### Phase 0 status

- pnpm + Turborepo monorepo with strict TypeScript.
- Next.js web, NestJS API, BullMQ worker, and simulator CLI.
- PostgreSQL + pgvector, Redis, MinIO, Nginx, Prometheus, Grafana, and OpenTelemetry.
- Reproducible initial migration and foundational Outbox table.
- Health, readiness, metrics, OpenAPI, redacted logs, and correlation IDs.
- Quality and migration CI with Actions pinned to full commit SHAs.

### Phase 1 status

- Users, organizations, memberships, invitations, roles, and RBAC+ABAC permissions.
- Argon2id passwords, encrypted TOTP MFA, and single-use recovery codes.
- Short-lived access cookies, rotating refresh tokens with replay detection, CSRF, and global logout.
- Forced PostgreSQL RLS under an unprivileged application role.
- Testcontainers coverage for migrations, HTTP flows, and cross-tenant reads/writes.

### Phase 2 status

- Asset inventory, ownership, criticality, tags, and typed dependency edges.
- Webhook, REST, JSON/CSV, GitHub, and simulator connector definitions.
- Rotatable encrypted webhook secrets and scoped, expiring, revocable API keys.
- PostgreSQL idempotency with safe replay, atomic audit records, and outbox events.
- HMAC/API-key ingress, Redis rate limits, and forced tenant RLS.

### Phase 3 status

- Strict JSON/CSV ingestion with payload, depth, and record-count limits.
- Encrypted raw events, semantic deduplication, audit, and outbox in one transaction.
- Least-privilege dispatcher, BullMQ queue, and idempotent tenant-scoped worker.
- Normalized events with pseudonymized PII and masked secrets, tokens, emails, and IPs.
- Cursor-based safe queries, raw-free receipts, metrics, and event simulator.

### Phase 4 status

- Versioned deterministic rules with thresholds, windows, severity, and explicit activation.
- Explainable moving average and z-score with precise, bounded risk values.
- Idempotent BullMQ worker, deduplicated alerts, and masked-signal correlation.
- Alert states, assignment, bounded suppression, cursor API, and SSE snapshots.
- Accessible web console, bounded graph, Prometheus metrics, and Grafana panels.

### Phase 5 status

- Idempotent, tenant-scoped incident creation from critical or high-risk alerts.
- Validated lifecycle transitions, ownership, comments, root cause, and lessons learned.
- Response/resolution SLAs, deferred evaluation, and decoupled internal/email notifications.
- Private MinIO evidence with SHA-256, bounds, quarantine, inspection, and short-lived URLs.
- Auditable timeline, optimistic concurrency, cursor/SSE API, and bounded scope graph.
- Incident-response web console plus Prometheus metrics and Grafana panels.

### Phase 6 status

- Private, versioned MinIO documents with sanitization, trust classification, audit, and outbox.
- Idempotent BullMQ indexing into bounded 768-dimensional pgvector/HNSW chunks.
- Interchangeable OpenAI, Ollama, and credential-free deterministic provider adapters.
- RLS-, version-, and model-scoped retrieval with weighted confidence and mandatory abstention.
- Zod output validation, citation allowlist, malicious-output blocking, token/latency traceability.
- Knowledge and recommendation console with safely rendered source evidence.

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
