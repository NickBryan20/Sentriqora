# Modelo de amenazas STRIDE — Fase 3

| Riesgo                        | Control                                                                                 | Evidencia verificable                            |
| ----------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Suplantación de conector      | API key con hash/scopes o HMAC con ventana temporal                                     | pruebas HTTP de autenticación de Fase 2/3        |
| Reenvío o duplicación         | `Idempotency-Key`, hash semántico, advisory lock, job UUID y clave única por registro   | replay y doble proceso en integración            |
| Manipulación de tenant        | FKs compuestas, rol sin privilegios y RLS forzado en raw/normalized                     | consulta cruzada devuelve cero                   |
| Exposición de PII/secretos    | AES-256-GCM en raw, HMAC en identificadores y redacción recursiva                       | integración inspecciona raw cifrado y normalized |
| Inyección/prototype pollution | DTO estricto, parser limitado, claves seguras y SQL parametrizado                       | pruebas de payload profundo/tipos/confusión MIME |
| Denegación de servicio        | 1 MiB, 500 registros, profundidad/propiedades, rate limit Redis, timeout y concurrencia | contratos y configuración del worker             |
| Elevación vía dispatcher      | rol `aegisflow_outbox` NOLOGIN con sólo SELECT/UPDATE al outbox                         | migración y prueba real de despacho              |
| Fuga por observabilidad       | logs estructurados con IDs, lista de redacción y métricas sin cardinalidad de tenant    | revisión estática y endpoint `/metrics`          |

## Riesgos residuales

- Una clave AES comprometida dentro de la ventana de 30 días permite descifrar raw events. Producción
  debe usar secreto externo, rotación y acceso de runtime auditado.
- La búsqueda `contains` es adecuada al volumen inicial; grandes volúmenes requieren índice dedicado
  o motor de búsqueda con la misma frontera multi-tenant.
- El borrado de retención por lotes y el particionamiento mensual están diseñados, pero se operativizan
  al introducir administración de retención.
