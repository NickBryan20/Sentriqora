# API de Fase 1 — identidad y multi-tenancy

Base URL: `/api/v1`. Todos los errores usan `application/problem+json` e incluyen
`correlationId`; los errores de aplicación también incluyen un `code` estable.

## Autenticación

| Método   | Ruta                           | Autenticación           | Descripción                                           |
| -------- | ------------------------------ | ----------------------- | ----------------------------------------------------- |
| `POST`   | `/auth/register`               | Pública                 | Registra usuario, organización, membresía y rol owner |
| `POST`   | `/auth/login`                  | Pública                 | Valida contraseña; crea sesión o challenge MFA        |
| `POST`   | `/auth/mfa/verify`             | Challenge               | Consume TOTP/recovery code y crea sesión              |
| `GET`    | `/auth/me`                     | Access cookie           | Devuelve el principal activo                          |
| `POST`   | `/auth/mfa/enrollment`         | Access + CSRF           | Revela una vez el secreto TOTP pendiente              |
| `POST`   | `/auth/mfa/enrollment/confirm` | Access + CSRF           | Activa TOTP y revela diez recovery codes              |
| `POST`   | `/auth/refresh`                | Refresh cookie + CSRF   | Rota el refresh token                                 |
| `GET`    | `/auth/sessions`               | `session.read`          | Lista sesiones propias del tenant activo              |
| `DELETE` | `/auth/sessions/{id}`          | `session.revoke` + CSRF | Revoca una sesión propia                              |
| `POST`   | `/auth/logout`                 | `session.revoke` + CSRF | Revoca la sesión actual                               |
| `POST`   | `/auth/logout-all`             | `session.revoke` + CSRF | Revoca todas las sesiones propias del tenant          |

El login siempre requiere `organizationId`; no existe un selector de tenant confiado desde el
frontend. Si MFA está activo devuelve `mfaRequired`, `challengeId` y `expiresAt`, sin cookies de
sesión. El segundo paso crea una sesión únicamente después de consumir el factor.

## Cookies y CSRF

- `aegisflow_access`: JWT de diez minutos, `HttpOnly`, `SameSite=Strict`.
- `aegisflow_refresh`: token opaco rotativo, `HttpOnly`, limitado a la ruta de refresh.
- `aegisflow_organization`: contexto del refresh, `HttpOnly`; un valor alterado no encuentra el
  token debido a RLS y al hash.
- `aegisflow_csrf`: valor legible que debe repetirse en `X-CSRF-Token` para comandos autenticados.

Todas usan `Secure` en producción. Los tokens nunca se devuelven en JSON ni se guardan en
`localStorage`.

## Organizaciones, roles y permisos

| Método  | Ruta                                                           | Permiso                              |
| ------- | -------------------------------------------------------------- | ------------------------------------ |
| `GET`   | `/organizations`                                               | `organization.read`                  |
| `POST`  | `/organizations`                                               | `organization.manage` + MFA reciente |
| `GET`   | `/organizations/{organizationId}/members`                      | `member.read`                        |
| `POST`  | `/organizations/{organizationId}/invitations`                  | `member.invite` + MFA reciente       |
| `POST`  | `/organizations/invitations/accept`                            | Sesión autenticada + CSRF            |
| `GET`   | `/organizations/{organizationId}/roles`                        | `role.read`                          |
| `GET`   | `/organizations/{organizationId}/permissions`                  | `role.read`                          |
| `POST`  | `/organizations/{organizationId}/roles`                        | `role.manage` + MFA reciente         |
| `PATCH` | `/organizations/{organizationId}/members/{membershipId}/roles` | `member.manage` + MFA reciente       |

El guard ABAC exige que el `organizationId` de la ruta coincida con el principal. La aceptación de
invitación es la única excepción deliberada: el token opaco, el correo del usuario, la expiración y
la organización se validan atómicamente antes de crear la membresía.

La sesión considera MFA reciente durante quince minutos. Al vencer ese plazo, las operaciones
críticas exigen un nuevo login con MFA; las operaciones de lectura continúan disponibles.

## OpenAPI

Swagger está disponible en desarrollo en `/api/docs`. Cada operación documenta cookies, permisos,
DTOs cerrados y códigos HTTP. Propiedades adicionales son rechazadas por el `ValidationPipe`
global para evitar mass assignment.
