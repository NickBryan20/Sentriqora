import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { QueryProvider } from '../src/components/query-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'AegisFlow',
  description: 'Deteccion, correlacion y respuesta segura a incidentes tecnologicos.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
