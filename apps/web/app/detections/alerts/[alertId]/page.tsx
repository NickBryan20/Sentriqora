import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AlertGraph } from '../../../../src/components/alert-graph';

export default async function AlertGraphPage({
  params,
  searchParams,
}: {
  params: Promise<{ alertId: string }>;
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const [{ alertId }, { organizationId }] = await Promise.all([params, searchParams]);
  if (
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(alertId) ||
    organizationId === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(organizationId)
  )
    notFound();
  return (
    <main className="min-h-screen px-6 py-10 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <Link
          className="text-sm font-semibold text-cyan-300"
          href={`/detections?organizationId=${organizationId}`}
        >
          ← Volver a alertas
        </Link>
        <h1 className="mb-3 mt-6 text-4xl font-semibold text-white">Grafo de correlación</h1>
        <p className="mb-8 max-w-2xl text-slate-400">
          Las aristas explican qué señal enmascarada relacionó cada alerta. El grafo está limitado a
          200 relaciones para mantener consultas previsibles.
        </p>
        <AlertGraph alertId={alertId} organizationId={organizationId} />
      </div>
    </main>
  );
}
