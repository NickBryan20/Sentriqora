# ADR 0001: Monolito modular orientado a eventos

- Estado: Aceptado
- Fecha: 2026-07-31

## Contexto

AegisFlow necesita límites fuertes entre identidad, ingesta, detección, incidentes, IA y
automatización, pero el MVP no justifica el coste operativo ni la consistencia distribuida de
microservicios.

## Decisión

Se implementará un monolito modular con cuatro procesos desplegables: web, API, worker y simulador.
El dominio y los contratos se comparten mediante paquetes sin dependencias de framework. Los
eventos persistentes saldrán mediante Outbox y los trabajos asíncronos usarán BullMQ.

Cada módulo mantiene las capas `domain`, `application`, `infrastructure` y `presentation`. La API
traduce transporte a casos de uso; no accede directamente a Prisma.

## Consecuencias

- Las transacciones locales son simples y confiables.
- Los módulos podrán extraerse si volumen o aislamiento lo requieren.
- Se necesita disciplina automática de dependencias y pruebas de límites.
- API y worker comparten versión de despliegue durante el MVP.
