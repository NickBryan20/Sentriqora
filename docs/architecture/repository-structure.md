# Estructura del repositorio

```text
apps/
  api/              API NestJS y adaptadores de presentación
  event-simulator/  CLI de eventos sintéticos
  web/              Interfaz Next.js App Router
  worker/           Consumidores BullMQ
packages/
  config-eslint/    Política de lint compartida
  config-typescript/Configuración TypeScript estricta
  contracts/        Esquemas Zod y tipos de transporte compartidos
  domain/           Dominio sin dependencias de infraestructura
  testing/          Utilidades de prueba deterministas
  ui/               Componentes React compartidos
infrastructure/     Docker, Nginx y observabilidad
prisma/             Esquema, migraciones y seed
docs/               Arquitectura, ADR, seguridad, pruebas y guías
```

Las reglas de dependencia están descritas en ADR 0001 y se aplicarán con lint y pruebas de
arquitectura conforme se incorporen los módulos funcionales.
