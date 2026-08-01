# Arquitectura de gestión de incidentes

```text
alert.created.v1
       |
       v
 aegisflow-incidents (BullMQ)
       |
       +--> Incident + Alert/Event links
       +--> Timeline + audit
       +--> incident.sla_due.v1 (diferido)
       +--> Notification + notification.requested.v1
                                  |
                                  v
                         aegisflow-notifications
```

El worker consulta la alerta autoritativa dentro de una transacción con contexto de organización.
Solo una alerta crítica o de riesgo al menos 90 genera automáticamente un incidente. El vínculo
único `IncidentAlert` y un advisory lock hacen idempotente el procesamiento.

Los estados válidos son `OPEN`, `TRIAGED`, `INVESTIGATING`, `CONTAINED`, `RESOLVED` y `CLOSED`.
Asignación, transición y análisis actualizan una versión atómica. Comentarios, evidencias, enlaces y
entradas de timeline conservan el tenant en su clave y FK.

Cada incidente recibe vencimientos de respuesta y resolución según `SlaPolicy`. El outbox no publica
el trabajo hasta `available_at`; el worker comprueba nuevamente el estado antes de marcar el
incumplimiento y notificar al responsable.

## Evidencias

1. El cliente calcula SHA-256 y solicita una autorización con nombre, MIME y tamaño acotados.
2. La API registra `PENDING_UPLOAD` y devuelve una URL PUT firmada por cinco minutos.
3. Al completar, la fila pasa a `QUARANTINED`; la API recupera el objeto por un endpoint interno.
4. Tamaño, metadatos, hash, magic bytes y patrones activos/maliciosos deben coincidir.
5. Solo `AVAILABLE` obtiene una URL GET firmada por 60 segundos. La clave interna nunca se expone.

La consola `/incidents` consume listas por cursor y snapshots SSE. El detalle presenta timeline,
comentarios, análisis, evidencias y un grafo acotado de incidente, alertas y activos.
