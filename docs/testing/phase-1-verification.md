# Plan de verificación — Fase 1

## Gate automatizado

```bash
pnpm verify
docker compose config --quiet
```

La suite de API usa Testcontainers y necesita acceso a Docker. Crea PostgreSQL pgvector y Redis
efímeros, aplica todas las migraciones desde cero y destruye ambos contenedores al finalizar.

Cobertura crítica:

1. Política de contraseña, normalización de email/slug y autorización RBAC+ABAC.
2. Argon2id, AES-256-GCM, vector TOTP, recovery codes y rechazo de JWT `alg:none`/firma alterada.
3. Registro HTTP con rechazo de propiedades desconocidas.
4. Login sin enumeración, cookies `HttpOnly`, CSRF obligatorio y enrolamiento MFA.
5. Login MFA, sesiones, revocación global y rechazo de una sesión revocada.
6. Lectura y actualización cruzada entre organizaciones, ejecutadas contra PostgreSQL real.
7. Bitácora de seguridad append-only.

## Migraciones desde cero

```bash
docker compose down -v
docker compose up --build -d
docker compose ps -a
docker compose logs migrate
```

El borrado de volúmenes es exclusivo del entorno de prueba y elimina sus datos locales. El servicio
`migrate` debe terminar con código 0 y readiness debe responder 200.

## Comprobación SQL

```sql
SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto') ORDER BY extname;
SELECT count(*) FROM permissions;
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN ('memberships', 'roles', 'sessions', 'refresh_tokens', 'event_records')
ORDER BY relname;
```

Se esperan ambas extensiones, diez permisos y `true/true` para RLS/force RLS.
