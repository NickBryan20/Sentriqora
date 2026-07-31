# Resultados de verificación — Fase 0

Fecha: 2026-07-31

Entorno: Windows, Node.js 24.18.0 temporal, pnpm 11.9.0

## Resultados exitosos

| Comprobación               | Resultado                                                 |
| -------------------------- | --------------------------------------------------------- |
| Política de runtime        | Node.js 24.18.0 aceptado                                  |
| Instalación/lockfile       | Lockfile congelado y peers sin conflictos                 |
| Formato                    | Prettier sin diferencias                                  |
| Lint                       | 8 tareas de workspace y archivos raíz exitosos            |
| Typecheck                  | 8 tareas estrictas y `tsconfig` raíz exitosos             |
| Pruebas                    | 6 archivos, 9 pruebas aprobadas                           |
| Build                      | 8 tareas; artefactos API, worker, simulador y web creados |
| Prisma                     | Format, validate y generate exitosos                      |
| Compose desarrollo         | `config --quiet` exitoso con Compose 5.1.4 verificado     |
| Compose producción         | Válido; solo Nginx publica un puerto                      |
| Smoke test API compilada   | HTTP 200 en `/api/v1/health/live`                         |
| Smoke test web compilada   | HTTP 200 y contenido AegisFlow                            |
| Marcadores/`any` explícito | Ninguno encontrado en código terminado                    |

## PostgreSQL local

Se creó `aegisflow_db` y se habilitó `pgcrypto` 1.3 con las credenciales locales indicadas. La
instancia PostgreSQL 17 disponible en el host no ofrece la extensión `vector`.

## Verificación bloqueada por el entorno

No se levantó el stack porque Docker Engine no está instalado. Tampoco se aplicó la migración a la
base local: ejecutar `CREATE EXTENSION vector` fallaría y Prisma dejaría una migración fallida, por
lo que se preservó la base limpia. El workflow `quality.yml` ejecuta `prisma migrate deploy` y el
seed contra una instancia efímera `pgvector`, pero ese workflow aún requiere publicarse/ejecutarse
en GitHub.

Para completar esta evidencia en el equipo local:

```bash
docker compose up --build -d
docker compose ps
curl http://localhost:8080/api/v1/health/ready
docker compose --profile demo run --rm event-simulator
docker compose down
```

No debe comenzar la Fase 1 hasta comprobar migraciones y readiness con Docker/pgvector, conforme al
orden del prompt maestro.
