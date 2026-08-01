# Arquitectura de detección, alertas y correlación

```text
NormalizedEvent + outbox
          |
          v
 aegisflow-detection (BullMQ)
          |
          +--> AnomalyScore (media, desviación, z-score)
          +--> RuleExecution (único por versión/evento)
          +--> Alert + AlertEvent (deduplicación por ventana)
          +--> AlertCorrelationEdge (grafo explicable)
          +--> alert.created.v1 (outbox para fases posteriores)
```

El motor solo lee el evento canónico enmascarado. La `DetectionRuleFactory` crea reglas
determinísticas a partir de condiciones validadas: tipos, severidades, activos, texto acotado y
comparaciones de atributos. No ejecuta consultas provistas por usuarios.

El score de anomalía compara el volumen de la hora del evento contra 24 buckets horarios. El riesgo
combina severidad configurada, exceso sobre el umbral y z-score, siempre entre 0 y 100. Los valores
de negocio se persisten con `numeric`.

La clave de deduplicación incluye versión y bucket. Así, actualizar una regla no mezcla resultados
de definiciones distintas. Las aristas ordenan ambos UUID para evitar direcciones duplicadas y
guardan únicamente un hash del valor correlacionado.

La API separa consultas y comandos: listar/obtener, crear/versionar/activar, triage y supresión. Los
comandos usan CSRF, permisos específicos y concurrencia optimista. La consola web consume snapshots
SSE cada dos segundos y limita el grafo a 200 aristas.
