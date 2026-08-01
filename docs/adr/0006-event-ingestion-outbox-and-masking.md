# ADR 0006: ingesta cifrada, outbox y normalización enmascarada

- Estado: aceptada
- Fecha: 2026-08-01

## Contexto

La Fase 3 debe aceptar JSON y CSV de conectores no confiables, tolerar reintentos, conservar una
fuente reprocesable durante un tiempo limitado y evitar que PII, credenciales o tokens alcancen las
consultas de producto. La cola no puede convertirse en el origen de verdad ni debilitar el aislamiento
por organización.

## Decisión

1. La API valida tipo, codificación, tamaño, profundidad, número de registros y forma antes de escribir.
2. El payload crudo se cifra con AES-256-GCM y se guarda en `raw_events` durante 30 días. Nunca se
   incluye en respuestas, outbox, auditoría ni logs.
3. `Idempotency-Key` protege el comando HTTP. Una clave semántica adicional, derivada de
   `sourceEventId` o del hash del payload, deduplica reintentos con otra clave HTTP.
4. La creación de `raw_events`, auditoría y `raw_event.received.v1` es una sola transacción.
5. Un dispatcher con el rol `aegisflow_outbox` sólo puede leer/actualizar el outbox. Publica en BullMQ
   usando el UUID de `raw_events` como `jobId`.
6. El procesador abre una transacción como `aegisflow_app`, fija el tenant para RLS, descifra,
   adapta el formato, enmascara y crea `normalized_events` de forma idempotente.
7. Las consultas públicas leen únicamente eventos normalizados y usan cursor `(occurred_at, id)`.

## Enmascaramiento

- Claves de secretos se sustituyen por `[REDACTED]`.
- Usuarios, correos e IP se seudonimizan con HMAC-SHA-256 y pepper independiente.
- Tokens Bearer/JWT, correos e IPv4 embebidos en mensajes se sustituyen antes de persistir.
- Profundidad, propiedades, longitud y claves peligrosas (`__proto__`, `constructor`, `prototype`) se
  rechazan tanto en la frontera como en la política de dominio.

## Particionamiento y retención

Los índices actuales soportan el volumen inicial. Antes de que una partición mensual supere el
presupuesto operativo, `normalized_events` evolucionará a particiones mensuales por `occurred_at` y
`raw_events` por `received_at`. La clave estable seguirá incluyendo el tiempo y el UUID; la migración
se hará con tabla sombra y doble escritura. Los registros crudos vencidos se eliminan por lotes; la
retención normalizada será configurable en una fase de administración posterior.

## Consecuencias

- La base de datos es la fuente durable; Redis/BullMQ puede reconstruirse desde outbox.
- La entrega es al menos una vez, pero `jobId` y la restricción `(raw_event_id, record_index)` hacen el
  resultado efectivo exactamente una vez.
- El descifrado queda confinado al worker. Rotar la clave exige un procedimiento de recifrado o esperar
  el vencimiento de la retención cruda.
