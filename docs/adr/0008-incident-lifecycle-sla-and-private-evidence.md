# ADR 0008: ciclo de incidentes, SLA y evidencias privadas

- Estado: aceptado
- Fecha: 2026-08-01

## Contexto

Las alertas de la fase 4 requieren una respuesta coordinada y auditable. Los reintentos del outbox
no deben duplicar incidentes ni notificaciones; las evidencias no pueden publicarse antes de validar
su integridad y contenido, y toda modificación concurrente debe ser explícita.

## Decisión

- Una alerta `CRITICAL` o con riesgo mayor o igual a 90 crea un incidente automáticamente bajo un
  bloqueo transaccional e índice único por alerta.
- El ciclo de vida solo permite transiciones enumeradas. Resolver exige causa raíz y cerrar exige,
  además, lecciones aprendidas.
- `Incident.version` protege asignación, transición y análisis mediante concurrencia optimista.
- Los objetivos de respuesta y resolución se materializan al crear el incidente. Dos eventos outbox
  diferidos evalúan el SLA de forma idempotente.
- Comentarios y timeline son append-only; toda acción sensible también genera auditoría.
- Las evidencias se almacenan en un bucket MinIO privado. La API entrega URLs firmadas breves y el
  archivo permanece en cuarentena hasta comprobar tamaño, SHA-256, MIME, firma y contenido activo.
- Las notificaciones internas y de correo usan un puerto común. El adaptador local de correo solo
  registra metadatos no sensibles y puede reemplazarse por un proveedor transaccional.
- Las ocho tablas nuevas usan claves de tenant, relaciones compuestas y RLS forzado.

## Consecuencias

La respuesta es reproducible, aislada y resistente a reintentos. El análisis de evidencias del MVP
es síncrono y está limitado a 10 MiB; un despliegue de mayor volumen debe sustituirlo por un motor
antimalware asíncrono, conservando el mismo estado de cuarentena y el contrato del puerto.
