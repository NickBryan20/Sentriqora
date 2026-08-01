import { StatusBadge } from '@aegisflow/ui';
import Link from 'next/link';

const foundations = [
  ['Ingesta', 'Eventos validados, enmascarados y deduplicados'],
  ['Detección', 'Reglas versionadas, ventanas y z-score explicable'],
  ['Correlación', 'Alertas agrupadas por señal y grafo de relaciones'],
  ['Seguridad', 'RLS, permisos finos y auditoría append-only'],
] as const;

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-12 sm:px-10 lg:px-16">
      <div className="grid-glow" aria-hidden="true" />
      <section className="relative mx-auto flex min-h-[calc(100vh-6rem)] max-w-6xl flex-col justify-between rounded-[2rem] border border-white/10 bg-slate-950/75 p-7 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl sm:p-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 font-black text-cyan-200">
              A
            </span>
            <span className="text-sm font-semibold tracking-[0.22em] text-slate-300">
              AEGISFLOW
            </span>
          </div>
          <StatusBadge tone="healthy">Fase 4 · Detección activa</StatusBadge>
        </header>
        <div className="max-w-3xl py-20">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Seguridad operacional con trazabilidad
          </p>
          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-7xl">
            AegisFlow convierte señales dispersas en decisiones defendibles.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
            La plataforma recibe y normaliza eventos, ejecuta reglas determinísticas, calcula
            anomalías y correlaciona alertas con aislamiento estricto por organización.
          </p>
          <Link
            className="mt-8 inline-flex rounded-xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950 focus:outline-none focus:ring-2 focus:ring-white"
            href="/detections"
          >
            Abrir centro de detección
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {foundations.map(([title, description]) => (
            <article
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"
              key={title}
            >
              <h2 className="font-semibold text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
