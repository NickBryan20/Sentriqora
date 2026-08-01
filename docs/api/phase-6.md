# API de fase 6 — conocimiento y recomendaciones seguras

Prefijo: `/api/v1`. Todas las rutas requieren sesión y tenant coincidente. Las mutaciones usan CSRF;
crear, versionar o eliminar documentos exige MFA.

## Base de conocimiento

- `GET /organizations/{organizationId}/knowledge-documents` — `knowledge.read`; lista estado,
  confianza, versión y número de chunks, nunca el objeto privado.
- `POST /organizations/{organizationId}/knowledge-documents` — `knowledge.manage`; recibe texto o
  Markdown entre 40 bytes y 256 KiB, título, origen y confianza.
- `POST /organizations/{organizationId}/knowledge-documents/{documentId}/versions` —
  `knowledge.manage`; almacena una versión nueva y publica indexación asíncrona.
- `DELETE /organizations/{organizationId}/knowledge-documents/{documentId}` — `knowledge.manage`;
  neutraliza el índice y elimina objetos privados.

Estados: `PENDING`, `INDEXING`, `INDEXED`, `REJECTED`, `DELETED`. Confianza de origen:
`UNTRUSTED`, `INTERNAL`, `VERIFIED`.

## Recomendaciones

- `POST /organizations/{organizationId}/ai-recommendations` — `ai-recommendation.request`; recibe
  `question` y un `incidentId` opcional.
- `GET /organizations/{organizationId}/ai-recommendations?incidentId={uuid}` — `knowledge.read`;
  devuelve historial con fuentes, confianza, proveedor y modelo.

El estado puede ser `GENERATED`, `ABSTAINED`, `PROVIDER_UNAVAILABLE` o `INVALID_OUTPUT`. Una
respuesta `GENERATED` siempre contiene una o más fuentes del mismo tenant. Los otros estados no
incluyen acciones propuestas. Ninguna ruta ejecuta acciones, comandos, SQL, shell, herramientas o
URLs sugeridas por el modelo.
