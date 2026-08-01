# Modelo de amenazas STRIDE — fase 5

| Riesgo                               | Control                                                                                  | Evidencia                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------- |
| Incidente duplicado por replay       | advisory lock, vínculo único por alerta y trabajos BullMQ estables                       | integración worker         |
| Transición o cierre fraudulento      | permisos, MFA, CSRF, máquina de estados, análisis obligatorio y auditoría                | dominio y API              |
| Escritura concurrente perdida        | `version` y actualización atómica por tenant                                             | casos de uso y repositorio |
| Fuga entre organizaciones            | FKs compuestas, rol sin `BYPASSRLS` y RLS forzado en ocho tablas                         | integración PostgreSQL     |
| Evidencia maliciosa o engañosa       | extensiones/MIME cerrados, 10 MiB, SHA-256, metadatos, magic bytes, cuarentena y escaneo | contratos y adaptador      |
| Acceso público a evidencia           | bucket privado, URL PUT/GET breve, MFA y descarga solo `AVAILABLE`                       | MinIO y API                |
| Exposición de ruta interna           | `objectKey` se elimina del detalle, carga y finalización                                 | pruebas API                |
| Notificación repetida o fuga en logs | clave idempotente; logs solo con hash de destinatario y longitudes                       | worker                     |
| Manipulación de SLA                  | permiso separado, MFA, límites, orden respuesta/resolución y versión                     | contrato y check SQL       |
| DoS por listas/grafo/timeline        | límites 100/200/500, cursor, archivos 10 MiB y timeouts de almacenamiento                | API y repositorio          |

## Riesgos residuales

- El escáner integrado detecta firmas y contenido activo, pero no sustituye un antivirus actualizado.
- El adaptador de correo local no entrega correo real. Producción debe conectarlo a un proveedor con
  credenciales administradas y telemetría sin contenido.
- La URL firmada puede copiarse durante su ventana corta; por eso exige MFA y expira en 60 segundos.
