# Instalación local

## Requisitos

- Node.js 24 LTS
- pnpm 11
- Docker Engine con Docker Compose v2
- Git

## Un solo flujo

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up --build -d
```

Abra `http://localhost:8080`. La API directa usa el puerto `3001`, Grafana `3002`, MinIO `9001`
y Prometheus `9090`.

Las credenciales de `.env.example` son únicamente locales. Antes de cualquier despliegue use
`docker-compose.prod.yml`, un gestor de secretos y valores aleatorios.
