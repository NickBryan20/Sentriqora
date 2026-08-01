# Modelo de amenazas STRIDE — fase 6

| Riesgo                               | Control                                                                         | Evidencia               |
| ------------------------------------ | ------------------------------------------------------------------------------- | ----------------------- |
| Prompt injection directa o indirecta | separación system/datos/usuario, sanitización en API y worker, sin herramientas | dominio y red team      |
| Fuga de otro tenant                  | claves/FKs compuestas, filtro redundante y RLS forzado en cinco tablas          | PostgreSQL real         |
| Documento u objeto alterado          | bucket privado, SHA-256, tamaño, MIME y versión comprobados antes de indexar    | worker                  |
| Poisoning de conocimiento            | origen y confianza explícitos, ponderación, auditoría y versionado              | dominio y SQL           |
| Alucinación o cita inventada         | top-k cerrado, umbral, allowlist de citationId y abstención                     | casos de uso            |
| Improper output handling             | Zod estricto, React escapado, bloqueo de HTML/URL/código/comandos               | API y UI                |
| Excessive agency/tool misuse         | proveedor sin herramientas; no existe ruta de ejecución en fase 6               | adaptadores             |
| Exposición de prompt o secretos      | redacción previa, `store: false`, telemetría solo de metadatos                  | adaptador y auditoría   |
| Consumo sin límites                  | 256 KiB, 200 chunks, top 6, 1.200 tokens de salida, timeout y concurrencia 3/2  | contratos/API/worker    |
| Mezcla de espacios vectoriales       | dimensión 768 y recuperación por proveedor/modelo de la versión                 | migración y repositorio |
| Replay o carrera de versiones        | outbox, jobId estable, lock de documento, reemplazo idempotente por versión     | integración worker      |
| Borrado incompleto                   | estado `DELETED`, objeto eliminado y contenido/vector neutralizados             | repositorio             |

## Riesgos residuales

- Los detectores de prompt injection reducen patrones conocidos, pero no prueban que un documento
  sea verdadero; la confianza y la revisión humana siguen siendo obligatorias.
- El proveedor determinista sirve para reproducibilidad y degradación local, no sustituye la calidad
  semántica de un embedding entrenado.
- Ollama depende del modelo local instalado y de sus controles de supply chain. Producción debe fijar
  artefactos y verificar hashes.
- El costo se registra como cero mientras no exista una tabla de precios versionada y aprobada; se
  evita inferir precios dinámicos dentro del código.
