# Verificación de Fase 0

## Automatizada

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm prisma:validate
docker compose config --quiet
```

## Integración local

```bash
docker compose up --build -d
docker compose ps
curl http://localhost:8080/api/v1/health/live
curl http://localhost:8080/api/v1/health/ready
docker compose --profile demo run --rm event-simulator
docker compose down
```

La prueba de migraciones se ejecuta en CI contra una base pgvector vacía. La Fase 1 añadirá
Testcontainers y pruebas de aislamiento de organizaciones cuando exista el modelo de tenancy.
