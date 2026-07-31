# Modelo de amenazas inicial — Fase 0

| STRIDE | Riesgo inicial                         | Control de Fase 0                                     |
| ------ | -------------------------------------- | ----------------------------------------------------- |
| S      | Suplantación de servicios internos     | Red Compose aislada; autenticación se añade en Fase 1 |
| T      | Manipulación de solicitudes o imágenes | Validación estricta; versiones exactas; CI inmutable  |
| R      | Negación de una acción                 | Correlation ID y logs JSON redactados                 |
| I      | Secretos en código o telemetría        | `.env` ignorado, redacción y ejemplos no productivos  |
| D      | Agotamiento de API o dependencias      | Límites Nginx, timeout de probes y health checks      |
| E      | Contenedores o procesos privilegiados  | Usuario no-root en apps y `no-new-privileges`         |

Riesgos aceptados temporalmente: TLS termina fuera de Compose, autenticación aún no existe y los
escáneres completos se incorporan en el hardening programado. Estos riesgos no habilitan exposición
pública de la Fase 0.
