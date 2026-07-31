# API de Fase 0

Base local directa: `http://localhost:3001/api/v1`.
Base a través del proxy: `http://localhost:8080/api/v1`.

| Método | Ruta            | Propósito                           |
| ------ | --------------- | ----------------------------------- |
| GET    | `/health/live`  | Comprueba que el proceso responde   |
| GET    | `/health/ready` | Comprueba PostgreSQL, Redis y MinIO |
| GET    | `/metrics`      | Expone métricas para Prometheus     |

En desarrollo, OpenAPI está disponible en `/api/docs`. Las respuestas incluyen
`X-Correlation-Id`; los errores HTTP siguen `application/problem+json`.
