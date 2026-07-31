# PROMPT MAESTRO — DESARROLLO INTEGRAL DE AEGISFLOW

Actúa como un equipo senior compuesto por: arquitecto de software, líder técnico full stack, especialista DevSecOps, ingeniero de seguridad de aplicaciones, ingeniero de datos, especialista en PostgreSQL, diseñador UX/UI, ingeniero de QA y especialista en IA generativa/RAG.

Tu misión es diseñar e implementar **AegisFlow**, una plataforma web multi-organización para recolección de eventos tecnológicos, detección de anomalías, correlación de alertas, gestión de incidentes, recomendaciones RAG fundamentadas, simulación de acciones, aprobaciones humanas, playbooks y reportes. El resultado debe ser un sistema funcional, seguro, documentado, probado, desplegable con Docker y apto para publicarse en GitHub como proyecto profesional.

## 1. Reglas obligatorias de trabajo

1. No generes únicamente pseudocódigo, maquetas o archivos incompletos. Entrega código ejecutable y coherente.
2. Trabaja por fases pequeñas. Antes de continuar a la siguiente fase, ejecuta o describe de forma verificable: lint, compilación, migraciones y pruebas.
3. No dejes `TODO`, credenciales embebidas, rutas falsas ni funciones vacías en funcionalidades marcadas como terminadas.
4. Aplica TypeScript en modo estricto. Prohíbe `any` salvo una justificación excepcional documentada.
5. Ningún controlador puede acceder directamente a Prisma. Los controladores llaman casos de uso; los casos de uso dependen de interfaces; los adaptadores implementan esas interfaces.
6. La capa de dominio no puede depender de NestJS, Prisma, Redis, OpenAI, HTTP ni detalles de infraestructura.
7. Implementa SOLID, Clean Architecture, arquitectura hexagonal, separación de responsabilidades, inyección de dependencias y principios de diseño seguro.
8. Utiliza CRUD solo para recursos administrativos simples. Para incidentes, detección, aprobaciones y playbooks utiliza casos de uso explícitos y comandos de dominio.
9. Toda operación sensible debe quedar registrada con trazabilidad suficiente, sin almacenar secretos, contraseñas, tokens ni prompts privados completos.
10. Toda decisión técnica relevante debe documentarse mediante ADR en `docs/adr`.
11. Los secretos deben leerse desde variables de entorno. `.env` debe estar en `.gitignore`; `.env.example` solo contendrá valores de ejemplo seguros.
12. La contraseña PostgreSQL `200520` se usará exclusivamente en desarrollo local. Nunca debe presentarse como contraseña válida para producción.
13. No confíes en datos provenientes del navegador, documentos RAG, archivos, webhooks, proveedores externos o resultados del LLM.
14. Las recomendaciones de IA son asistivas. Ninguna acción de riesgo medio, alto o crítico se ejecuta sin aprobación humana conforme a la política definida.
15. El sistema debe seguir funcionando para gestión manual de incidentes cuando el proveedor de IA esté caído.

## 2. Stack tecnológico obligatorio

### Monorepo y calidad

- Node.js en versión activa LTS.
- pnpm workspaces.
- Turborepo.
- TypeScript estricto.
- ESLint con reglas estrictas y Prettier.
- Husky y lint-staged.
- Commitlint y Conventional Commits.

### Frontend

- Next.js con App Router y TypeScript.
- React.
- Tailwind CSS.
- shadcn/ui.
- TanStack Query para estado remoto.
- Zustand únicamente para estado local transversal necesario.
- React Hook Form y Zod.
- Recharts o Apache ECharts para analítica.
- Cytoscape.js para el grafo de incidentes.
- WebSocket o Server-Sent Events para alertas en tiempo real.
- Vitest, Testing Library y Playwright.

### Backend

- NestJS con TypeScript.
- REST API versionada en `/api/v1`.
- OpenAPI/Swagger.
- Prisma ORM.
- PostgreSQL.
- Extensión pgvector.
- Redis.
- BullMQ para trabajos asíncronos.
- WebSocket Gateway o SSE.
- Pino para logs JSON estructurados.
- OpenTelemetry.

### Almacenamiento e IA

- MinIO compatible con S3 para evidencias y documentos.
- Abstracción `LLMProvider` con adaptadores OpenAI y Ollama.
- Embeddings mediante un adaptador intercambiable.
- RAG implementado con PostgreSQL + pgvector.
- Respuestas estructuradas validadas con Zod.
- No permitas que el LLM genere o ejecute comandos del sistema operativo.

### Infraestructura y seguridad

- Docker y Docker Compose.
- Nginx o Traefik como reverse proxy.
- Prometheus y Grafana.
- OpenTelemetry Collector.
- GitHub Actions.
- Trivy, CodeQL, Semgrep, Gitleaks, npm/pnpm audit y OWASP ZAP.
- SBOM CycloneDX.

## 3. Configuración local de PostgreSQL

Usa estos valores solo para desarrollo local:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=200520
POSTGRES_DB=aegisflow_db
POSTGRES_PORT=5432
DATABASE_URL=postgresql://postgres:200520@postgres:5432/aegisflow_db
DATABASE_URL_LOCAL=postgresql://postgres:200520@localhost:5432/aegisflow_db
```

Crea la base de datos `aegisflow_db`, habilita `vector` y, si está disponible, `pgcrypto`. En producción exige una contraseña aleatoria administrada por un gestor de secretos.

## 4. Arquitectura obligatoria

Implementa un **monolito modular orientado a eventos**. No uses microservicios en el MVP. El monolito debe poder separarse posteriormente sin reescribir el dominio.

### Capas por módulo

```text
domain/
  entities/
  value-objects/
  domain-events/
  services/
  errors/
application/
  commands/
  queries/
  use-cases/
  ports/
  dto/
infrastructure/
  persistence/prisma/
  messaging/bullmq/
  storage/minio/
  ai/
  telemetry/
presentation/
  http/
  websocket/
  guards/
```

### Reglas de dependencia

- `domain` no importa ninguna capa externa.
- `application` depende del dominio y de puertos/interfaces.
- `infrastructure` implementa puertos.
- `presentation` transforma transporte HTTP/WebSocket a casos de uso.
- Los DTO HTTP no son entidades de dominio.
- Prisma models no se exponen fuera del adaptador de persistencia.

### Patrones requeridos

- Repository y Unit of Work donde la consistencia lo requiera.
- Dependency Injection.
- Strategy para detectores, proveedores de IA y canales de notificación.
- Factory para reglas y pasos de playbook.
- Specification para filtros de negocio complejos.
- Outbox Pattern para publicar eventos de dominio de forma confiable.
- Idempotency Key para webhooks y comandos repetibles.
- Optimistic Concurrency mediante campo `version` en incidentes y aprobaciones.
- CQRS selectivo: comandos y consultas separados en flujos de incidentes, detección y playbooks.
- Result/Either o excepciones de dominio tipadas; nunca errores genéricos sin contexto.

## 5. Estructura del monorepo

```text
aegisflow/
  apps/
    web/
    api/
    worker/
    event-simulator/
  packages/
    domain/
    contracts/
    ui/
    config-eslint/
    config-typescript/
    testing/
  infrastructure/
    docker/
    nginx/
    prometheus/
    grafana/
    otel/
  prisma/
    schema.prisma
    migrations/
    seed.ts
  docs/
    architecture/
    adr/
    api/
    threat-model/
    testing/
    user-guide/
  scripts/
  .github/workflows/
  docker-compose.yml
  docker-compose.prod.yml
  .env.example
  SECURITY.md
  CONTRIBUTING.md
  CODE_OF_CONDUCT.md
  LICENSE
  README.md
```

## 6. Módulos funcionales

Implementa los siguientes módulos con límites claros:

1. **Identity & Access**: usuarios, credenciales, TOTP, códigos de recuperación, sesiones, refresh tokens rotativos, bloqueo temporal, API keys, passkeys opcionales.
2. **Organizations & Tenancy**: organizaciones, membresías, invitaciones, roles, permisos, configuración y aislamiento de datos.
3. **Assets**: aplicaciones, servidores, APIs, bases de datos, repositorios, criticidad, propietarios y dependencias.
4. **Connectors**: webhooks, API REST, importación JSON/CSV, GitHub y simulador de eventos.
5. **Event Ingestion**: recepción, validación, normalización, deduplicación, enmascaramiento, persistencia y encolado.
6. **Detection Rules**: reglas determinísticas, umbrales, ventanas temporales, severidad y activación/desactivación.
7. **Anomaly Detection**: línea base, z-score, medias móviles e Isolation Forest opcional mediante servicio separado únicamente si se justifica.
8. **Correlation**: agrupación por usuario, IP, activo, indicador, tipo y ventana temporal; grafo de relaciones.
9. **Alerts**: estados, priorización, asignación, supresión, deduplicación y conversión a incidente.
10. **Incidents**: ciclo de vida, SLA, responsable, evidencias, comentarios, línea temporal, causa raíz y lecciones aprendidas.
11. **Knowledge Base**: documentos, versiones, clasificación de confianza, chunks, embeddings, indexación y eliminación segura.
12. **AI Recommendations**: recuperación RAG, fuentes, nivel de confianza, validación estructurada, abstención y trazabilidad.
13. **Playbooks**: definición de pasos, condiciones, tareas manuales, acciones simuladas, aprobaciones y resultados.
14. **Approvals**: aprobación por nivel de riesgo, doble aprobación para riesgo crítico y prevención de autoaprobación.
15. **Simulation**: cálculo del impacto previsto, activos afectados, reducción estimada del riesgo y reversibilidad.
16. **Notifications**: notificaciones internas y correo mediante adaptadores.
17. **Reports**: informe técnico, resumen ejecutivo, PDF, CSV y JSON.
18. **Dashboard & Analytics**: MTTD, MTTR, incidentes por severidad, activos más afectados, cumplimiento de SLA y volumen de eventos.
19. **Event Records**: registro append-only de acciones de seguridad y negocio, con encadenamiento hash opcional.
20. **Administration**: configuración, retención, catálogos, plantillas y estado de integraciones.

## 7. Modelo de datos mínimo

Incluye, como mínimo, las siguientes entidades Prisma con UUID, fechas UTC, índices y restricciones:

- Organization
- User
- Credential
- MfaMethod
- RecoveryCode
- Session
- RefreshToken
- Role
- Permission
- Membership
- ApiKey
- Asset
- AssetDependency
- Connector
- WebhookSecret
- RawEvent
- NormalizedEvent
- DetectionRule
- RuleExecution
- AnomalyScore
- Alert
- Incident
- IncidentAlert
- IncidentEvent
- IncidentEvidence
- IncidentComment
- IncidentTimelineEntry
- SlaPolicy
- KnowledgeDocument
- KnowledgeDocumentVersion
- KnowledgeChunk con vector
- AIRecommendation
- AIRecommendationSource
- Playbook
- PlaybookVersion
- PlaybookStep
- PlaybookExecution
- PlaybookStepExecution
- ApprovalRequest
- ApprovalDecision
- Simulation
- Notification
- EventRecord
- OutboxEvent
- IdempotencyRecord

### Reglas de datos

- Toda tabla perteneciente a una organización debe incluir `organizationId`.
- Implementa aislamiento en repositorios y PostgreSQL Row Level Security cuando sea viable.
- Crea pruebas de integración que demuestren que una organización no puede leer ni modificar datos de otra.
- Usa `JSONB` solo para metadatos variables, nunca como sustituto de un modelo relacional esencial.
- Usa `numeric` para puntuaciones o valores que necesiten precisión; evita `float` cuando pueda producir errores de negocio.
- Aplica `unique`, `check`, claves foráneas y eliminación restringida según corresponda.
- Usa soft delete únicamente en entidades que necesiten recuperación; no lo apliques indiscriminadamente.
- Para eventos de alto volumen, diseña una estrategia de particionamiento mensual como evolución documentada.

## 8. Autenticación y autorización

### Autenticación

- Hash de contraseñas con Argon2id.
- Política de contraseñas basada en longitud, lista de contraseñas comprometidas opcional y rechazo de contraseñas comunes.
- Login protegido contra fuerza bruta, credential stuffing y password spraying.
- MFA TOTP con secreto cifrado y códigos de recuperación de un solo uso almacenados como hash.
- Access token de corta duración.
- Refresh token rotativo, almacenado como hash, asociado a dispositivo/sesión y con detección de reutilización.
- Cookies `HttpOnly`, `Secure` y `SameSite` adecuadas. No almacenar tokens en `localStorage`.
- Protección CSRF para flujos autenticados basados en cookies.
- Cierre de sesión individual y global.
- Reautenticación para operaciones críticas.
- Respuestas de autenticación que no permitan enumerar usuarios.

### Autorización

- RBAC más ABAC.
- Verificación de organización, recurso, rol, permiso, propiedad y estado del recurso.
- Guards y políticas centralizadas; nunca confiar en ocultar botones del frontend.
- Prevención de BOLA/IDOR, BFLA, escalada horizontal/vertical y mass assignment.
- El usuario no puede aprobar una acción que él mismo solicitó cuando la política exija separación de funciones.

## 9. Seguridad integral y amenazas a evaluar

No existe una lista finita que garantice cubrir literalmente todos los ataques posibles. Implementa un proceso continuo de modelado de amenazas, pruebas y revisión. Como cobertura mínima, evalúa y documenta:

### Aplicación web

- Broken Access Control.
- Security Misconfiguration.
- Software Supply Chain Failures.
- Cryptographic Failures.
- Injection.
- Insecure Design.
- Authentication Failures.
- Software or Data Integrity Failures.
- Security Logging and Alerting Failures.
- Mishandling of Exceptional Conditions.
- XSS almacenado, reflejado y DOM.
- CSRF.
- Clickjacking.
- Open redirect.
- Prototype pollution.
- Regular Expression DoS.
- HTTP request smuggling y header injection cuando aplique al proxy.
- Cache poisoning y exposición de datos en caché.

### API

- BOLA/IDOR.
- Broken Authentication.
- Broken Object Property Level Authorization.
- Unrestricted Resource Consumption.
- Broken Function Level Authorization.
- Abuso de flujos sensibles.
- SSRF.
- Misconfiguration.
- Inventario/versiones obsoletas.
- Consumo inseguro de APIs externas.
- Mass assignment.
- Replay attacks.
- Falta de idempotencia.
- Enumeración por diferencias de respuesta.

### Inyección y entradas

- SQL injection.
- Command injection.
- Template injection.
- Path traversal.
- CRLF/log injection.
- Deserialización insegura.
- XXE si se acepta XML; preferiblemente no aceptar XML en el MVP.
- CSV formula injection en exportaciones.
- HTML/Markdown injection.
- Validación insuficiente de JSON y tipos.

### Archivos

- MIME spoofing.
- Extensiones dobles.
- Archivos polyglot.
- SVG con scripts.
- Zip bombs.
- Malware.
- Path traversal en nombres.
- Sobrescritura de objetos.
- Acceso público accidental.
- Descarga de archivo de otra organización.
- Metadatos sensibles.

### Sesión, tokens y criptografía

- Session fixation/hijacking.
- Robo o replay de refresh tokens.
- JWT `alg:none`, algorithm confusion, claves débiles y validación incorrecta de `iss`, `aud`, `exp`, `nbf` y `jti`.
- OTP replay y bypass de MFA.
- Cifrado con algoritmos inseguros.
- Nonces/IV reutilizados.
- Secretos en repositorio, logs, imágenes Docker o bundles frontend.
- Gestión insegura de claves.

### Datos y multi-tenancy

- Fuga entre organizaciones.
- Consultas sin filtro de tenant.
- Backups públicos o sin cifrar.
- Datos sensibles en logs.
- Exposición mediante reportes, exportaciones o URLs firmadas.
- Inferencia de datos por métricas agregadas.
- Retención excesiva.
- Borrado incompleto.

### Infraestructura y DevOps

- Puertos de administración expuestos.
- Contenedores privilegiados.
- Ejecución como root.
- Imágenes vulnerables o sin fijar digest.
- Docker socket expuesto.
- Configuración insegura de CORS/TLS/proxy.
- Dependencias vulnerables, typosquatting y dependency confusion.
- Pipeline comprometido.
- Actions sin versiones fijadas.
- Artefactos no firmados.
- SBOM ausente.
- Secretos en CI/CD.
- Entornos de desarrollo y producción mezclados.

### Lógica de negocio

- Bypass del ciclo de vida del incidente.
- Aprobación sin permisos.
- Autoaprobación indebida.
- Doble ejecución de playbooks.
- Race conditions.
- Manipulación de severidad, SLA o puntuación de riesgo.
- Reapertura/cierre sin transición válida.
- Reutilización de invitaciones o enlaces expirados.
- Supresión maliciosa de alertas.

### IA generativa y RAG

- Prompt injection directa e indirecta.
- Divulgación de información sensible.
- Supply chain del modelo, SDK, datasets o embeddings.
- Data/model poisoning y documentos RAG maliciosos.
- Improper output handling.
- Excessive agency.
- System prompt leakage.
- Vector and embedding weaknesses.
- Misinformation/hallucination.
- Unbounded consumption y agotamiento de cuota/costos.
- Recuperación de chunks de otra organización.
- Instrucciones maliciosas ocultas en PDF, HTML o Markdown.
- Exfiltración mediante URLs, Markdown, imágenes o herramientas.
- Tool misuse.
- Confusión de contexto y fuentes no confiables.

### Controles obligatorios para IA

- Clasifica documentos por nivel de confianza y origen.
- Separa instrucciones del sistema, datos recuperados y entrada del usuario.
- Trata todos los documentos recuperados como datos no confiables, no como instrucciones.
- Filtra secretos y datos personales antes de enviar contexto al proveedor.
- Limita cantidad de chunks, tokens, tiempo, concurrencia y presupuesto.
- Requiere citas y evidencia para recomendaciones.
- Implementa umbral de confianza y respuesta de abstención.
- Valida la salida mediante esquema Zod.
- No renderices HTML arbitrario del modelo.
- No ejecutes SQL, código, shell ni URLs propuestas por el modelo.
- Usa allowlist de herramientas y parámetros.
- Exige aprobación humana para acciones con impacto.
- Registra modelo, versión, prompt-template versionado, fuentes, latencia y costo sin guardar secretos.
- Implementa pruebas de red team con prompts directos e indirectos.

## 10. Controles técnicos obligatorios

- Helmet y cabeceras seguras.
- CSP estricta con nonces cuando sea necesario.
- HSTS en producción.
- CORS mediante allowlist.
- Rate limiting por IP, usuario, organización, API key y endpoint.
- Límites de payload, profundidad JSON, tiempo y concurrencia.
- DTOs con whitelist y rechazo de propiedades desconocidas.
- Zod en frontend y contratos compartidos cuando corresponda.
- Consultas parametrizadas mediante Prisma; uso de raw SQL solo con parámetros.
- Sanitización contextual de salida; no confiar únicamente en sanitizar la entrada.
- URLs externas validadas contra allowlist y bloqueo de rangos privados para mitigar SSRF.
- Uploads en cuarentena, validación MIME real, tamaño, extensión, hash y escaneo antivirus.
- Objetos MinIO privados por defecto y URLs firmadas de corta duración.
- Cifrado TLS en tránsito y cifrado de datos sensibles en reposo.
- Secretos mediante variables/secret manager; rotación y revocación.
- Logs sin credenciales, tokens, cookies, OTP, claves API ni contenido sensible completo.
- Manejo centralizado de excepciones con mensajes externos genéricos y detalle interno seguro.
- Circuit breaker, timeouts, retries con backoff y límites para proveedores externos.

## 11. Casos de uso críticos

Implementa y prueba al menos:

1. Registrar usuario e iniciar sesión con MFA.
2. Crear organización e invitar miembro.
3. Crear activo y dependencia.
4. Crear conector y rotar secreto de webhook.
5. Recibir evento con idempotency key.
6. Normalizar y enmascarar evento.
7. Ejecutar regla de detección.
8. Calcular puntuación de anomalía.
9. Correlacionar alertas.
10. Crear incidente automáticamente.
11. Asignar y cambiar estado del incidente respetando transiciones.
12. Adjuntar evidencia segura.
13. Consultar recomendación RAG con citas.
14. Abstenerse si no existe evidencia suficiente.
15. Simular una acción.
16. Solicitar aprobación.
17. Impedir autoaprobación cuando aplique.
18. Ejecutar playbook idempotente.
19. Generar reporte PDF/CSV/JSON.
20. Consultar dashboard filtrado por organización.
21. Revocar todas las sesiones.
22. Exportar registros de eventos sin datos secretos.

## 12. API

- Versiona la API en `/api/v1`.
- Usa nombres REST consistentes y recursos en plural.
- Implementa paginación cursor-based para eventos e incidentes.
- Implementa filtros, ordenamiento y búsqueda con límites.
- Usa códigos HTTP correctos y formato de error consistente compatible con Problem Details.
- Incluye `correlationId` en solicitudes y respuestas.
- Requiere `Idempotency-Key` en webhooks y comandos críticos repetibles.
- Documenta autenticación, permisos, ejemplos y errores en OpenAPI.
- Añade health checks: liveness, readiness y dependencias.

## 13. Interfaz

Crea una UI profesional, responsive y accesible con:

- Login, recuperación, MFA y gestión de sesiones.
- Dashboard ejecutivo y técnico.
- Lista y detalle de activos.
- Fuentes/conectores.
- Eventos en tiempo real.
- Reglas de detección.
- Alertas.
- Incidentes con timeline y grafo.
- Base de conocimiento.
- Recomendaciones de IA con fuentes y confianza.
- Editor de playbooks.
- Bandeja de aprobaciones.
- Reportes.
- Administración.

Cumple WCAG 2.2 AA como objetivo: navegación por teclado, foco visible, etiquetas, contraste, mensajes accesibles y reducción de movimiento.

## 14. Pruebas obligatorias

### Unitarias

- Entidades, value objects, políticas, transiciones, cálculo de severidad y reglas.

### Integración

- Repositorios con PostgreSQL real mediante Testcontainers.
- Redis/BullMQ.
- MinIO.
- RLS/aislamiento multi-tenant.
- Outbox e idempotencia.

### API/E2E

- Autenticación, autorización, CRUD permitido, flujos críticos y errores.
- Playwright para escenarios de usuario.

### Seguridad

- Casos de abuso para cada amenaza aplicable.
- ZAP contra ambiente de prueba.
- Semgrep/CodeQL/SAST.
- Trivy para imágenes y dependencias.
- Gitleaks para secretos.
- Tests de prompt injection, fuga de tenant y output malicioso.

### Rendimiento

- k6 para ingestión, consultas y dashboard.
- Objetivo MVP: 100 eventos/segundo sostenidos en entorno de referencia.
- p95 de operaciones CRUD comunes inferior a 500 ms sin contar proveedores externos.
- Creación de alerta crítica dentro de cinco segundos desde la recepción del evento.

## 15. Observabilidad

- Logs JSON estructurados con `correlationId`, `organizationId` anonimizado cuando corresponda, `userId`, módulo y resultado.
- Métricas Prometheus: solicitudes, errores, latencia, colas, ingestión, alertas, incidentes, consultas RAG, tokens y costo.
- Trazas OpenTelemetry entre API, worker, PostgreSQL, Redis, MinIO y proveedor LLM.
- Dashboards Grafana y alertas básicas.
- Nunca incluir secretos o contenido sensible completo en telemetría.

## 16. CI/CD y repositorio

Crea workflows para:

1. lint y typecheck;
2. pruebas unitarias;
3. pruebas de integración;
4. build;
5. migraciones en entorno efímero;
6. SAST y secret scanning;
7. dependency/container scanning;
8. generación SBOM;
9. E2E;
10. publicación de imágenes con tags inmutables.

Protege la rama principal, exige revisión y estados exitosos. Usa Renovate o Dependabot. Fija versiones de GitHub Actions por commit SHA cuando sea razonable.

## 17. Datos de demostración

Crea seed y simulador con escenarios:

- fuerza bruta;
- inicio de sesión administrativo desde IP desconocida;
- caída de API;
- latencia elevada de base de datos;
- error de despliegue;
- exposición simulada de credencial;
- incremento de errores 5xx;
- acceso no autorizado a un activo crítico.

Los datos deben ser sintéticos y no contener información real.

## 18. Entregables

Entrega:

- monorepo ejecutable;
- `docker-compose.yml`;
- esquema Prisma y migraciones;
- seed;
- API documentada;
- pruebas;
- scripts de desarrollo;
- documentación C4 y diagramas Mermaid;
- modelo de amenazas STRIDE;
- matriz de riesgos y controles;
- ADR;
- README español e inglés;
- SECURITY.md;
- guía de instalación;
- guía de demostración;
- credenciales demo generadas de forma segura y obligatoriamente modificables;
- informe de rendimiento y seguridad.

## 19. Orden de implementación

Desarrolla en este orden y detente al final de cada fase para presentar archivos creados, comandos y resultados de verificación:

### Fase 0 — Bootstrap

Monorepo, configuración TypeScript, lint, Docker, PostgreSQL, Redis, MinIO, observabilidad mínima y CI inicial.

### Fase 1 — Identidad y multi-tenancy

Usuarios, organizaciones, roles, permisos, MFA, sesiones y pruebas de aislamiento.

### Fase 2 — Activos y conectores

CRUD seguro, dependencias, webhooks, API keys e idempotencia.

### Fase 3 — Ingestión de eventos

RawEvent, NormalizedEvent, colas, validación, enmascaramiento y simulador.

### Fase 4 — Detección, alertas y correlación

Reglas, puntuación, ventanas, alertas y grafo.

### Fase 5 — Incidentes

Estados, timeline, evidencias, comentarios, SLA y notificaciones.

### Fase 6 — RAG e IA segura

Documentos, chunks, pgvector, recuperación, recomendaciones, citas, abstención y pruebas de seguridad.

### Fase 7 — Playbooks, simulación y aprobaciones

Motor de pasos, idempotencia, políticas de riesgo y doble aprobación.

### Fase 8 — Reportes y analítica

Dashboards, PDF/CSV/JSON, MTTD, MTTR y SLA.

### Fase 9 — Hardening y publicación

Threat model final, ZAP, load tests, SBOM, documentación, demo y release.

## 20. Criterios de aceptación globales

No consideres el proyecto terminado hasta que:

- compile sin errores;
- no existan errores TypeScript;
- lint sea exitoso;
- migraciones funcionen desde cero;
- pruebas críticas sean exitosas;
- el aislamiento de organizaciones esté probado;
- no se detecten secretos versionados;
- la documentación permita levantar el sistema con un solo flujo de comandos;
- el sistema funcione sin IA para operaciones manuales;
- las recomendaciones RAG muestren fuentes o se abstengan;
- las acciones sensibles requieran aprobación;
- GitHub Actions esté operativo;
- Docker Compose levante todos los servicios;
- exista una demostración reproducible.

Comienza por la **Fase 0**. Antes de escribir código, presenta: decisiones arquitectónicas, árbol del repositorio, variables de entorno, diagrama C4 en Mermaid y plan de verificación. Después genera los archivos completos de la fase y los comandos exactos para ejecutarlos.
