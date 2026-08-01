import Link from 'next/link';

import { KnowledgeConsole } from '../../src/components/knowledge-console';

export default async function KnowledgePage({
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
              Conocimiento y recomendaciones
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-slate-400">
              Indexa procedimientos confiables y consulta recomendaciones fundamentadas. Cada
              respuesta muestra evidencia o se abstiene de forma explícita.
            </p>
          </div>
          <span className="rounded-full border border-violet-300/20 bg-violet-300/[0.08] px-3 py-1.5 text-xs font-semibold text-violet-200">
            Fase 6 · RAG seguro
          </span>
        </header>
        <KnowledgeConsole organizationId={validOrganization} />
      </div>
    </main>
  );
}
