# ADR 0004: Identidad, sesiones y aislamiento por organización

- Estado: Aceptado
- Fecha: 2026-07-31

## Contexto

La Fase 1 debe incorporar identidad y acceso sin permitir que una consulta o un token válido de
una organización se reutilice contra otra. También debe soportar MFA TOTP, sesiones revocables y
refresh tokens rotativos sin exponer secretos al navegador o a los logs.

## Decisión

La identidad se implementa como dos módulos NestJS (`identity` y `organizations`) que comparten
casos de uso y puertos de aplicación. Los controladores solo transforman HTTP; el adaptador Prisma
es el único componente que conoce el modelo persistente.

- Las contraseñas se derivan con Argon2id y una política de longitud/rechazo de contraseñas comunes.
- El secreto TOTP se cifra con AES-256-GCM. Los códigos de recuperación se persisten únicamente
  como HMAC-SHA-256 y se consumen una sola vez.
- El access token es un JWT HS256 de diez minutos, validado con algoritmo, emisor, audiencia,
  expiración, `nbf` y `jti` fijos. Se entrega en cookie `HttpOnly`.
- El refresh token es opaco, aleatorio y solo se almacena como HMAC. Cada uso lo consume y crea el
  siguiente token de la familia; cualquier reutilización revoca la sesión completa.
- Las operaciones autenticadas por cookie que cambian estado requieren un token CSRF de doble
  envío. Ningún token se almacena en `localStorage`.
- Cada sesión queda ligada a usuario, organización y huella del agente de usuario. Se soporta
  revocación individual y global.
- RBAC se expresa mediante roles organizacionales y permisos estables. ABAC exige que el
  `organizationId` de la ruta coincida con el contexto autenticado, además del permiso.
- Los repositorios organizacionales ejecutan una transacción con `SET LOCAL ROLE aegisflow_app` y
  variables locales `app.current_organization_id`/`app.current_user_id`. PostgreSQL RLS aplica una
  segunda frontera incluso si se omite accidentalmente un filtro de Prisma.
- El rol `aegisflow_app` es `NOLOGIN`; la conexión de migración conserva privilegios administrativos
  y la aplicación reduce privilegios dentro de cada transacción.

## Consecuencias

- Cambiar de organización requiere una nueva autenticación para esa organización; el token no es
  un selector de tenant manipulable.
- Las claves de JWT, cifrado y HMAC son obligatorias y distintas. En producción se rechazan los
  valores de demostración.
- Las migraciones futuras que creen tablas organizacionales deberán habilitar RLS, agregar una
  política y conceder acceso al rol de aplicación.
- La rotación de refresh tokens requiere una actualización condicional dentro de una transacción
  para que dos solicitudes concurrentes no puedan aceptar el mismo token.
