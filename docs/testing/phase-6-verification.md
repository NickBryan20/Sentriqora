# Plan de verificación — fase 6

1. Formatear y generar Prisma; aplicar siete migraciones desde cero sobre PostgreSQL 17 + pgvector.
2. Verificar `vector(768)`, índice HNSW, cinco tablas con RLS forzado y 30 permisos.
3. Probar sanitización de secretos, controles e inyección indirecta antes de MinIO y chunking.
4. Probar proveedores determinista/OpenAI/Ollama como puertos y rechazar dimensiones incompatibles.
5. Indexar mediante outbox + BullMQ, comprobar integridad, replay idempotente y versión vigente.
6. Cambiar el tenant de PostgreSQL y demostrar que chunks y vectores ajenos no pueden leerse o
   modificarse.
7. Consultar evidencia suficiente y validar citas; consultar sin evidencia y verificar abstención
   sin invocar al LLM.
8. Simular salida con HTML, URL, comando o cita inventada y exigir `INVALID_OUTPUT` sin contenido
   peligroso.
9. Comprobar caída del proveedor y continuidad de gestión manual con `PROVIDER_UNAVAILABLE`.
10. Verificar UI accesible, fuentes como texto escapado, confianza y estados de abstención.
11. Validar métricas de consultas, tokens, latencia, indexaciones y chunks sin contenido sensible.
12. Ejecutar formato, lint, TypeScript, pruebas, builds, Compose y smoke RAG sobre el stack Docker.
