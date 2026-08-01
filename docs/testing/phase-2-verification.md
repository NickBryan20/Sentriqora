# Plan de verificación — Fase 2

## Puerta automatizada

```bash
pnpm verify
docker compose config --quiet
```

La suite Testcontainers crea PostgreSQL pgvector y Redis vacíos, aplica todas las migraciones y
valida:

1. claves, configuraciones, dependencias y política de expiración/scopes;
2. migración completa desde cero y catálogo de siete permisos;
3. creación y replay de activos con una sola fila/efecto;
4. rechazo de la misma clave idempotente con otro request hash;
5. lectura y modificación cruzada bloqueadas por RLS aunque Prisma omita `organizationId`;
6. CRUD HTTP de activos y conectores con CSRF, MFA, permisos y versionado;
7. rotación de secreto webhook y entrega única;
8. API key con scope y recepción `202`, más replay con el mismo receipt ID;
9. auditoría append-only y outbox en la misma transacción.

## Comprobación SQL persistente

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN (
  'assets', 'asset_dependencies', 'connectors',
  'webhook_secrets', 'api_keys', 'idempotency_records'
)
ORDER BY relname;
SELECT key FROM permissions
WHERE key IN (
  'asset.read', 'asset.manage', 'connector.read', 'connector.manage',
  'connector.secret.rotate', 'api-key.read', 'api-key.manage'
)
ORDER BY key;
```

Se espera pgvector `0.8.1`, seis filas `true/true` y siete permisos.

## Smoke test

1. Autenticar owner con MFA y conservar cookies/CSRF.
2. Crear dos activos y una dependencia con claves idempotentes únicas.
3. Crear conector webhook y rotar secreto; confirmar que GET no lo expone.
4. Crear conector simulador, emitir API key `connector.ingest` y enviar un cuerpo menor de 1 MiB.
5. Repetir con igual `Idempotency-Key` y confirmar mismo `receiptId` y header replay.
6. Cambiar el cuerpo con esa clave y confirmar `409`.
