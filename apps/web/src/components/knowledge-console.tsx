'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';

interface KnowledgeDocument {
  chunkCount: number;
  currentVersion: number;
  id: string;
  rejectionReason: string | null;
  sourceType: string;
  status: string;
  title: string;
  trustLevel: string;
  updatedAt: string;
}

interface Recommendation {
  answer: string;
  confidence: number;
  createdAt: string;
  id: string;
  model: string;
  provider: string;
  question: string;
  recommendedActions: string[];
  sources: {
    chunkId: string;
    quote: string;
    rank: number;
    similarity: number;
    title: string;
    trustLevel: string;
  }[];
  status: string;
}

export function KnowledgeConsole({ organizationId }: { organizationId: string | null }) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [trustLevel, setTrustLevel] = useState('INTERNAL');
  const [question, setQuestion] = useState('');

  const load = useCallback(async () => {
    if (organizationId === null) return;
    try {
      const [documentsResponse, recommendationsResponse] = await Promise.all([
        fetch(`/api/v1/organizations/${organizationId}/knowledge-documents`, {
          credentials: 'include',
        }),
        fetch(`/api/v1/organizations/${organizationId}/ai-recommendations`, {
          credentials: 'include',
        }),
      ]);
      if (!documentsResponse.ok || !recommendationsResponse.ok) throw new Error('unavailable');
      setDocuments((await documentsResponse.json()) as KnowledgeDocument[]);
      setRecommendations((await recommendationsResponse.json()) as Recommendation[]);
    } catch {
      setMessage('No fue posible cargar la base de conocimiento. Verifica sesión y permisos.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (organizationId === null || busy) return;
    setBusy(true);
    setMessage('Guardando e iniciando indexación segura…');
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/knowledge-documents`, {
        body: JSON.stringify({
          content,
          contentType: 'text/plain',
          sourceType: 'RUNBOOK',
          title,
          trustLevel,
        }),
        credentials: 'include',
        headers: mutationHeaders(),
        method: 'POST',
      });
      if (!response.ok) throw new Error('create failed');
      setContent('');
      setTitle('');
      setMessage('Documento recibido. El worker está generando sus vectores.');
      await load();
    } catch {
      setMessage('No se pudo crear el documento. Se requiere MFA, permiso y contenido válido.');
    } finally {
      setBusy(false);
    }
  }

  async function requestRecommendation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (organizationId === null || busy) return;
    setBusy(true);
    setMessage('Recuperando evidencia y validando la recomendación…');
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/ai-recommendations`, {
        body: JSON.stringify({ question }),
        credentials: 'include',
        headers: mutationHeaders(),
        method: 'POST',
      });
      if (!response.ok) throw new Error('recommendation failed');
      const recommendation = (await response.json()) as Recommendation;
      setRecommendations((current) => [recommendation, ...current]);
      setQuestion('');
      setMessage(
        recommendation.status === 'GENERATED'
          ? 'Recomendación validada con fuentes.'
          : 'El sistema se abstuvo de recomendar; revisa el motivo.',
      );
    } catch {
      setMessage('No fue posible consultar la recomendación. La gestión manual sigue disponible.');
    } finally {
      setBusy(false);
    }
  }

  if (organizationId === null) {
    return (
      <section className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.06] p-8">
        <h2 className="text-xl font-semibold text-amber-100">Selecciona una organización</h2>
        <p className="mt-3 text-sm leading-6 text-amber-50/70">
          Añade <code className="rounded bg-black/30 px-2 py-1">?organizationId=&lt;uuid&gt;</code>{' '}
          después de iniciar sesión. La recuperación siempre aplica RLS y permisos del tenant.
        </p>
      </section>
    );
  }

  return (
    <>
      <p aria-live="polite" className="mb-5 min-h-6 text-sm text-slate-300">
        {message}
      </p>
      <section className="grid gap-5 lg:grid-cols-2">
        <form
          className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"
          onSubmit={createDocument}
        >
          <h2 className="text-lg font-semibold text-white">Añadir procedimiento</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Se admiten textos acotados. Secretos e instrucciones incrustadas se neutralizan antes de
            indexar.
          </p>
          <label className="mt-4 block text-sm text-slate-300">
            Título
            <input
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white"
              maxLength={180}
              minLength={3}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </label>
          <label className="mt-3 block text-sm text-slate-300">
            Confianza
            <select
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white"
              onChange={(event) => setTrustLevel(event.target.value)}
              value={trustLevel}
            >
              <option value="UNTRUSTED">No confiable</option>
              <option value="INTERNAL">Interno</option>
              <option value="VERIFIED">Verificado</option>
            </select>
          </label>
          <label className="mt-3 block text-sm text-slate-300">
            Contenido
            <textarea
              className="mt-2 min-h-40 w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white"
              maxLength={262_144}
              minLength={40}
              onChange={(event) => setContent(event.target.value)}
              required
              value={content}
            />
          </label>
          <button
            className="mt-4 rounded-xl bg-cyan-300 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"
            disabled={busy}
          >
            Indexar documento
          </button>
        </form>

        <form
          className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.035] p-5"
          onSubmit={requestRecommendation}
        >
          <h2 className="text-lg font-semibold text-white">Consultar evidencia</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            La IA es asistiva: no ejecuta acciones, comandos ni URLs. Sin evidencia suficiente,
            responde con abstención.
          </p>
          <label className="mt-4 block text-sm text-slate-300">
            Pregunta defensiva
            <textarea
              className="mt-2 min-h-36 w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white"
              maxLength={2_000}
              minLength={8}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="¿Qué contención documentada corresponde ante credenciales expuestas?"
              required
              value={question}
            />
          </label>
          <button
            className="mt-4 rounded-xl bg-violet-300 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"
            disabled={busy}
          >
            Obtener recomendación
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-white">Documentos</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {documents.length === 0 ? (
            <Empty text="Todavía no hay documentos en este tenant." />
          ) : (
            documents.map((document) => (
              <article
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                key={document.id}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                  <span
                    className={
                      document.status === 'INDEXED' ? 'text-emerald-200' : 'text-amber-200'
                    }
                  >
                    {document.status}
                  </span>
                  <span className="text-slate-500">{document.trustLevel}</span>
                </div>
                <h3 className="mt-2 font-semibold text-white">{document.title}</h3>
                <p className="mt-2 text-sm text-slate-400">
                  v{document.currentVersion} · {document.chunkCount} fragmentos ·{' '}
                  {document.sourceType}
                </p>
                {document.rejectionReason === null ? null : (
                  <p className="mt-2 text-xs text-rose-200">{document.rejectionReason}</p>
                )}
              </article>
            ))
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-white">Recomendaciones trazables</h2>
        <div className="mt-4 grid gap-4">
          {recommendations.length === 0 ? (
            <Empty text="Aún no se han realizado consultas RAG." />
          ) : (
            recommendations.map((recommendation) => (
              <article
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                key={recommendation.id}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                  <span
                    className={
                      recommendation.status === 'GENERATED' ? 'text-emerald-200' : 'text-amber-200'
                    }
                  >
                    {recommendation.status}
                  </span>
                  <span className="text-slate-500">
                    confianza {Math.round(recommendation.confidence * 100)}% ·{' '}
                    {recommendation.provider}/{recommendation.model}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-slate-300">
                  {recommendation.question}
                </h3>
                <p className="mt-3 whitespace-pre-wrap leading-7 text-white">
                  {recommendation.answer}
                </p>
                {recommendation.recommendedActions.length === 0 ? null : (
                  <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-cyan-100">
                    {recommendation.recommendedActions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 grid gap-2">
                  {recommendation.sources.map((source) => (
                    <blockquote
                      className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-3 text-sm text-slate-300"
                      key={source.chunkId}
                    >
                      <p className="font-semibold text-cyan-200">
                        [{`src-${source.rank}`}] {source.title}
                      </p>
                      <p className="mt-1 line-clamp-3">{source.quote}</p>
                    </blockquote>
                  ))}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 p-7 text-sm text-slate-400">
      {text}
    </div>
  );
}

function mutationHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-csrf-token': readCookie('aegisflow_csrf') ?? '',
  };
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const value = document.cookie.split('; ').find((candidate) => candidate.startsWith(prefix));
  return value === undefined ? null : decodeURIComponent(value.slice(prefix.length));
}
