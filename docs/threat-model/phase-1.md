# Modelo de amenazas STRIDE — Fase 1

## Activos y límites de confianza

Los activos protegidos son credenciales, secreto MFA, códigos de recuperación, cookies de sesión,
refresh tokens, membresías, roles y datos organizacionales. Los límites principales están entre el
navegador y Nginx, Nginx y la API, la capa de aplicación y Redis, y el adaptador Prisma y PostgreSQL.

| Amenaza      | Escenario                                         | Control implementado                                                                                   | Verificación                                |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Suplantación | Credential stuffing o enumeración de correo       | Respuesta genérica, Argon2id, límite por IP/identidad y bloqueo temporal                               | Pruebas de política y login                 |
| Suplantación | Robo o fijación de sesión                         | ID nuevo tras autenticación, cookies `HttpOnly`, `SameSite`, `Secure` en producción y huella de agente | E2E de cookies y sesión                     |
| Manipulación | JWT con `alg:none`, audiencia o emisor falsos     | Parser estricto de tres segmentos, HS256 fijo, comparación constante y validación completa de claims   | Pruebas unitarias de token                  |
| Manipulación | Reutilización o carrera del refresh token         | Hash HMAC, consumo condicional, rotación por familia y revocación completa al detectar replay          | Prueba de integración concurrente           |
| Repudio      | Cambio de rol, invitación o revocación sin rastro | `event_records` append-only con actor, acción, resultado y correlación                                 | Restricciones y pruebas SQL                 |
| Divulgación  | Lectura de otra organización                      | Guard de tenant, repositorio con contexto obligatorio, rol SQL restringido y RLS forzado               | Pruebas cruzadas con PostgreSQL real        |
| Divulgación  | Secreto TOTP, OTP o token en logs                 | AES-256-GCM en reposo, hash de códigos/tokens y redacción de cabeceras/cookies                         | Revisión automatizada de logs/configuración |
| Denegación   | Fuerza bruta o password spraying                  | Contadores Redis por IP e identidad y bloqueo en credencial                                            | Pruebas del adaptador de protección         |
| Elevación    | BFLA o rol de otro tenant                         | Permisos centralizados, coincidencia de tenant y claves compuestas de organización                     | E2E de autorización negativa                |
| Elevación    | Mass assignment                                   | DTOs cerrados, `forbidNonWhitelisted` y comandos explícitos                                            | E2E con propiedad desconocida               |
| Replay       | OTP reutilizado                                   | Contador TOTP monotónico persistido; recovery code con consumo atómico                                 | Pruebas de MFA                              |
| CSRF         | Rotar o revocar una sesión mediante cookies       | Doble envío de token CSRF para comandos autenticados                                                   | E2E de rechazo sin cabecera                 |

## Riesgo residual

El límite Redis es una defensa operativa y no sustituye protección en el perímetro. Antes de una
exposición pública se añadirá limitación coordinada en el proxy/WAF y alertas de spraying. HS256 es
adecuado para el monolito mientras la clave permanezca en el gestor de secretos; si verificadores
externos aparecen, se migrará a claves asimétricas con rotación y `kid`.
