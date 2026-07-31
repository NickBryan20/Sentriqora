# ADR 0002: pnpm, Turborepo y TypeScript estricto

- Estado: Aceptado
- Fecha: 2026-07-31

## Contexto

El monorepo requiere instalaciones deterministas, caché de tareas y una política de tipos común.

## Decisión

Se utilizarán pnpm workspaces, Turborepo y Node.js 24 LTS. Las versiones son exactas y el lockfile
se valida en CI. TypeScript activa `strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `noImplicitOverride` y `useUnknownInCatchVariables`. `any` está
prohibido por ESLint.

## Consecuencias

- Los errores de integración se detectan antes de ejecutar.
- Las actualizaciones son explícitas y revisables.
- Algunas bibliotecas externas necesitarán adaptadores de tipos precisos.
