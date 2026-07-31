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
pnpm prisma:generate
docker compose up --build -d
```

Abra `http://localhost:8080`. La API directa usa el puerto `3001`, Grafana `3002`, MinIO `9001`
y Prometheus `9090`.

Las credenciales de `.env.example` son únicamente locales. Antes de cualquier despliegue use
`docker-compose.prod.yml`, un gestor de secretos y valores aleatorios.

Las tres variables `AUTH_JWT_SECRET`, `AUTH_TOKEN_PEPPER` y `AUTH_ENCRYPTION_KEY` deben ser
independientes. `AUTH_ENCRYPTION_KEY` contiene exactamente 32 bytes codificados en base64. El
arranque en producción rechaza los valores de desarrollo y exige cookies seguras.

No existe un usuario demo fijo: registre datos sintéticos desde Swagger (`/api/docs`) o mediante
`POST /api/v1/auth/register`. Conserve el `organizationId` devuelto porque forma parte del login.
