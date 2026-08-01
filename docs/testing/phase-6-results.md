# Resultados de verificación — fase 6

Fecha: 2026-08-01

## Resultado

La fase 6 quedó aprobada para continuar. La validación se ejecutó con Node.js 24.18.0,
PostgreSQL 17, pgvector 0.8.1, Redis 8.2.1, MinIO, Docker Compose y la API de OpenAI.

| Control          | Resultado                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Prisma           | esquema válido; siete migraciones aplicadas y semilla de fase 6 verificada                     |
| pgvector         | extensión 0.8.1 activa; embeddings `vector(768)` e índice HNSW                                 |
| RLS/permisos     | cinco tablas nuevas con RLS forzado y 30 permisos totales                                      |
| Pruebas totales  | 77 en 30 archivos: API 30, worker 4, web 5, paquetes y simulador 38                            |
| Integración      | Testcontainers aprobó cinco casos de PostgreSQL/RLS y cuatro casos del worker                  |
| TypeScript       | diez proyectos en modo estricto aprobados                                                      |
| Lint/formato     | ESLint sin warnings y Prettier aprobado                                                        |
| Builds           | imágenes de producción API, migración, worker y web construidas; `/knowledge` incluido         |
| Docker           | configuraciones base y overlay de producción válidas; servicios requeridos activos             |
| OpenAI           | embedding e indexación aprobados; recomendación estructurada con una cita y confianza `0.7829` |
| Abstención       | consulta no relacionada terminó `ABSTAINED`, sin acciones ni fuentes                           |
| Observabilidad   | salud `up`, cuatro muestras RAG y paneles/métricas de consultas, tokens, latencia e indexación |
| Smoke desplegado | documento `INDEXED`; recomendación `GENERATED`; página `/knowledge` respondió HTTP 200         |

## Evidencia funcional

- El worker consumió `knowledge.document_ready.v1`, verificó integridad y generó un chunk vectorial.
- La consulta respaldada devolvió una recomendación de OpenAI con una única fuente persistida.
- La consulta sin evidencia suficiente se abstuvo antes de invocar el LLM y no expuso fuentes.
- El stack respondió en `http://127.0.0.1:8080`; API y PostgreSQL reportaron estado saludable.
- Las configuraciones Compose de desarrollo y del overlay de producción se interpolaron sin errores.

## Evidencia de seguridad

- El chunk persistido tenía 768 dimensiones, contenía `[REDACTED]` y
  `[UNTRUSTED_INSTRUCTION_REMOVED]`, y no contenía el valor secreto de prueba.
- Testcontainers confirmó que un tenant no puede leer ni modificar chunks o vectores de otro tenant.
- La persistencia real de recomendaciones con citas quedó cubierta por una prueba de regresión.
- Las salidas con URL, comandos, HTML o citas inventadas terminan `INVALID_OUTPUT` sin contenido
  peligroso.
- La indisponibilidad del proveedor termina `PROVIDER_UNAVAILABLE` y mantiene operativa la gestión
  manual.
- La clave de OpenAI se leyó temporalmente desde el proyecto externo indicado por el usuario; no se
  copió a este repositorio, no se imprimió y no forma parte de las imágenes.

## Proveedores

- OpenAI: validado de extremo a extremo con Responses, salida JSON estructurada y embeddings.
- Ollama: adaptador local disponible para chat y embeddings configurables.
- Determinista: adaptador sin costo para pruebas reproducibles y entornos sin conectividad.

## Observaciones

- Una interrupción de internet afectó una descarga de metadatos durante la primera construcción. La
  reconstrucción continuó usando las capas verificadas y terminó correctamente al volver la red.
- Para que OpenAI persista tras recrear los contenedores, `AI_PROVIDER=openai` y `OPENAI_API_KEY`
  deben configurarse localmente o mediante un gestor de secretos; `.env` permanece ignorado por Git.
