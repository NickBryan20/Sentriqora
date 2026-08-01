import Link from 'next/link';

import { DetectionConsole } from '../../src/components/detection-console';

export default async function DetectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const { organizationId } = await searchParams;
  const validOrganization =
    organizationId !== undefined && /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(organizationId)
      ? organizationId
      : null;
  return (
    <main className="min-h-screen px-6 py-10 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <Link className="text-sm font-semibold tracking-[0.2em] text-cyan-300" href="/">
              AEGISFLOW
            </Link>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Centro de detección
            </h1>
            <p className="mt-3 max-w-2xl leading-7 text-slate-400">
              Reglas determinísticas versionadas, anomalías explicables y alertas correlacionadas en
              tiempo real.
            </p>
          </div>
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-1.5 text-xs font-semibold text-emerald-200">
            Fase 4
          </span>
        </header>
        <DetectionConsole organizationId={validOrganization} />
      </div>
    </main>
  );
}
