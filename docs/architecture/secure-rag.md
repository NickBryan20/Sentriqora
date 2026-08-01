# Arquitectura de RAG e IA segura

```text
API document command
       |
       +--> sanitize + redact --> private MinIO object
       +--> Document + Version + audit + outbox
                                      |
                                      v
                           aegisflow-knowledge (BullMQ)
                                      |
                     integrity --> chunks --> embeddings
                                      |
                                      v
                               pgvector(768) + HNSW

API recommendation query
       |
       +--> query embedding
       +--> tenant RLS + current version + compatible model + top 6
       +--> trust-weighted threshold ---- insufficient ---> ABSTAINED
       |
       +--> untrusted context boundary --> LLMProvider
                                           |
                               Zod + citation allowlist + output guard
                                           |
                           recommendation + source snapshots + audit
```

## Límites de confianza

La entrada del navegador, los objetos MinIO, los chunks y la salida del proveedor son no confiables.
La API normaliza Unicode, elimina controles, redacta patrones de secretos y reemplaza instrucciones
indirectas conocidas. El worker repite la política antes de fragmentar y comprueba tamaño, hash y
metadato del objeto.

La búsqueda se ejecuta bajo `aegisflow_app` con `app.current_organization_id`. Además de RLS, el SQL
exige `organization_id`, documento `INDEXED`, versión actual y el mismo proveedor/modelo de
embedding. El recuperador devuelve como máximo seis fuentes. Confianza combina similitud coseno y
clasificación `UNTRUSTED`, `INTERNAL` o `VERIFIED`.

## Proveedores y degradación

- `deterministic`: embeddings hash normalizados y recomendación acotada; no requiere red ni clave.
- `ollama`: `/api/embed` y `/api/chat`, con esquema JSON y timeouts.
- `openai`: `/v1/embeddings` y `/v1/responses`, Structured Outputs, `store: false`, identificador de
  seguridad anonimizado y timeouts.

Si no hay evidencia, no se invoca el LLM. Si el proveedor falla, la consulta queda trazada como
`PROVIDER_UNAVAILABLE`; la gestión manual de incidentes y la base de conocimiento continúan
operativas.

## Persistencia y eliminación

`KnowledgeDocument` conserva clasificación, origen y estado. Cada `KnowledgeDocumentVersion`
registra objeto, hash y modelo de embedding. `KnowledgeChunk` contiene texto sanitizado y vector.
`AIRecommendationSource` relaciona la recomendación con sus chunks y guarda una cita inmutable.

El borrado marca el documento `DELETED`, neutraliza contenido y vector dentro de la transacción y
elimina todas sus versiones de MinIO. Los registros de auditoría y snapshots de fuentes permanecen
para trazabilidad, sin hacer recuperable el contenido original.
