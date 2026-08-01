# Modelo de amenazas STRIDE — Fase 4

| Riesgo                                | Control                                                                                         | Evidencia                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------- |
| Regla maliciosa o ejecución de código | DSL JSON cerrado, Zod estricto, operadores enumerados y SQL parametrizado                       | pruebas de contratos y política    |
| Manipular severidad o riesgo          | permisos separados, versiones inmutables, auditoría y score acotado 0–100                       | migración y pruebas unitarias      |
| Reintento crea alertas duplicadas     | ejecución única, dedup hash por bucket y `ON CONFLICT` transaccional                            | integración BullMQ/PostgreSQL      |
| Supresión maliciosa                   | `alert.triage`, CSRF, razón obligatoria, máximo 30 días y concurrencia optimista                | casos de uso API                   |
| Fuga entre organizaciones             | FKs compuestas, rol sin `BYPASSRLS` y RLS forzado en siete tablas                               | integración cambia contexto tenant |
| Reidentificación en el grafo          | IP/usuario ya son HMAC; la arista almacena hash adicional, no el valor                          | revisión de esquema y worker       |
| DoS por ventana o grafo               | ventanas ≤ 24 h, lectura ≤ 10 001 eventos, grafo ≤ 200 aristas y cola con concurrencia limitada | contratos y consultas acotadas     |
| Fuga por SSE/telemetría               | guardas en SSE; métricas sin IDs de tenant y logs con tenant hash corto                         | controlador y métricas worker      |

## Riesgos residuales

- El cálculo por ventana lee eventos recientes y es adecuado al MVP. Volúmenes altos necesitan
  agregados incrementales o particionamiento.
- La correlación por fingerprint depende de la calidad del conector y puede producir falsos
  positivos; el peso y dimensión se exponen para revisión humana.
- La supresión autorizada sigue siendo una acción sensible. Fases posteriores añadirán aprobación y
  notificación para políticas críticas.
