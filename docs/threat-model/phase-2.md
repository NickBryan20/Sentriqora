# Modelo de amenazas STRIDE — Fase 2

| Amenaza      | Escenario                                    | Control implementado                                                                 |
| ------------ | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Suplantación | Evento enviado como un conector legítimo     | HMAC sobre cuerpo crudo+timestamp o API key HMAC con scope y expiración              |
| Suplantación | Uso de credencial revocada                   | Filtro atómico por revocación/expiración y revocación total al deshabilitar conector |
| Manipulación | Cuerpo cambiado tras firmarlo                | HMAC-SHA-256 y comparación constante sobre bytes exactos                             |
| Manipulación | Dependencia hacia otro tenant                | Guard tenant, RLS forzado y FK compuesta con organización                            |
| Repudio      | Cambio de activo/credencial sin evidencia    | Evento append-only y outbox atómicos con actor, correlación y metadatos mínimos      |
| Divulgación  | Secreto en listado, log o configuración      | Entrega única, AES-GCM/HMAC, DTO sin secretos y redacción de cabeceras               |
| Divulgación  | Lectura de inventario de otra organización   | RBAC+ABAC, contexto SQL obligatorio y RLS forzado                                    |
| Denegación   | Flood sobre endpoint público                 | Máximo 1 MiB y límite Redis por conector y credencial+IP; fallo cerrado              |
| Elevación    | Analista rota claves o administra conectores | Permisos separados; operaciones sensibles requieren owner/admin, CSRF y MFA reciente |
| Replay       | Reenvío de webhook o comando                 | Timestamp de cinco minutos e idempotencia persistente con hash de solicitud          |
| Confusión    | Misma clave idempotente con otro payload     | Comparación de request hash dentro de advisory lock; rechazo `409`                   |
| SSRF         | URL arbitraria en configuración de conector  | Configuración plana sin URLs/credenciales; GitHub acepta solo `owner/repository`     |

## Riesgo residual

El receipt de Fase 2 no guarda el payload crudo, por lo que aún no ofrece recuperación/reproceso
del evento; se implementará con retención, cifrado y cuarentena en Fase 3. Redis complementa, pero
no sustituye, límites de Nginx/WAF. La rotación de secretos de producción necesitará integración
con un gestor de secretos y procedimiento operativo de emergencia.
