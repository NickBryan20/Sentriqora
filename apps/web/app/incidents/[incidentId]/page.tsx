import Link from 'next/link';
import { notFound } from 'next/navigation';

import { IncidentWorkspace } from '../../../src/components/incident-workspace';

export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ incidentId: string }>;
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const [{ incidentId }, { organizationId }] = await Promise.all([params, searchParams]);
  if (
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(incidentId) ||
    organizationId === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(organizationId)
  )
    notFound();
  return (
    <main className="min-h-screen px-6 py-10 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <Link
          className="text-sm font-semibold text-cyan-300"
          href={`/incidents?organizationId=${organizationId}`}
        >
          ← Volver a incidentes
        </Link>
        <IncidentWorkspace incidentId={incidentId} organizationId={organizationId} />
      </div>
    </main>
  );
}
