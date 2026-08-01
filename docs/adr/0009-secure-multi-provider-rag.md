# ADR 0009: RAG multi-proveedor con pgvector y abstención verificable

- Estado: aceptado
- Fecha: 2026-08-01

## Contexto

Las recomendaciones deben fundamentarse exclusivamente en documentos del tenant, continuar
funcionando en modo manual si la IA falla y resistir inyección indirecta, fuga de datos, salida
maliciosa y consumo sin límites. OpenAI y Ollama requieren contratos diferentes, pero el dominio no
puede depender de sus SDK ni de infraestructura.

## Decisión

- `EmbeddingProvider` y `LlmProvider` son puertos intercambiables. Los adaptadores usan HTTP acotado
  para OpenAI y Ollama; el proveedor determinista permite desarrollo, pruebas y demo sin credenciales.
- OpenAI usa Responses API con Structured Outputs y `store: false`; embeddings usa
  `text-embedding-3-small` reducido explícitamente a 768 dimensiones. El modelo generativo queda
  configurable y su valor inicial es `gpt-5.6-sol`.
- Todo proveedor de embeddings debe devolver exactamente 768 dimensiones. La versión almacena
  proveedor y modelo, y la recuperación solo compara vectores compatibles.
- El documento sanitizado se almacena en un bucket MinIO privado. Un evento outbox inicia indexación
  BullMQ; el worker vuelve a comprobar SHA-256, tamaño, versión y tenant.
- `KnowledgeChunk.embedding` usa `vector(768)` e índice HNSW de distancia coseno. La consulta aplica
  RLS, organización, versión vigente, proveedor, modelo, límite de chunks y umbral de confianza.
- Los documentos recuperados se serializan como datos no confiables, separados de la instrucción de
  sistema. Secretos y patrones de prompt injection se neutralizan antes de almacenamiento y contexto.
- La respuesta se valida mediante esquema Zod. Solo se aceptan citas entregadas por el recuperador;
  HTML, URLs, bloques de código y comandos provocan `INVALID_OUTPUT` y abstención.
- `AIRecommendation` registra resultado, modelo, versión de prompt, fuentes, tokens, latencia y costo
  estimado sin guardar el prompt privado completo ni secretos.
- El borrado elimina objetos MinIO y neutraliza texto/vector. Las citas históricas conservan su
  snapshot para auditoría, pero el documento eliminado deja de participar en recuperación.

## Consecuencias

El sistema ofrece una ruta local reproducible y dos proveedores externos sin acoplar el dominio. Los
vectores de distintos modelos no se mezclan; cambiar proveedor exige crear una nueva versión o
reindexar. El parser de fase 6 admite texto y Markdown acotados; PDF/HTML quedan fuera hasta disponer
de extracción aislada, antimalware y defensa contra contenido oculto equivalentes.

## Referencias

- [OpenAI: vector embeddings](https://developers.openai.com/api/docs/guides/embeddings)
- [OpenAI: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI: model guidance](https://developers.openai.com/api/docs/guides/latest-model)
