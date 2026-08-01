'use client';

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { IncidentGraph, type IncidentGraphValue } from './incident-graph';

interface TimelineEntry {
  actor: { displayName: string } | null;
  detail: string;
  fromStatus: string | null;
  id: string;
  occurredAt: string;
  title: string;
  toStatus: string | null;
  type: string;
}

interface Evidence {
  contentType: string;
  fileName: string;
  id: string;
  rejectionReason: string | null;
  sizeBytes: number;
  status: string;
  version: number;
}

interface IncidentDetail {
  alerts: { id: string; severity: string; title: string }[];
  comments: { author: { displayName: string }; body: string; createdAt: string; id: string }[];
  description: string;
  evidence: Evidence[];
  events: { eventType: string; id: string; message: string; occurredAt: string }[];
  id: string;
  key: string;
  lessonsLearned: string | null;
  priority: string;
  resolutionDueAt: string;
  responseDueAt: string;
  rootCause: string | null;
  severity: string;
  sla: { resolutionBreached: boolean; responseBreached: boolean };
  status: string;
  timeline: TimelineEntry[];
  title: string;
  version: number;
}

const TRANSITIONS: Record<string, string[]> = {
  CLOSED: ['INVESTIGATING'],
  CONTAINED: ['INVESTIGATING', 'RESOLVED'],
  INVESTIGATING: ['CONTAINED', 'RESOLVED'],
  OPEN: ['TRIAGED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'INVESTIGATING'],
  TRIAGED: ['INVESTIGATING', 'CLOSED'],
};

export function IncidentWorkspace({
  incidentId,
  organizationId,
}: {
  incidentId: string;
  organizationId: string;
}) {
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [graph, setGraph] = useState<IncidentGraphValue>({ edges: [], nodes: [] });
  const [message, setMessage] = useState('Cargando incidente…');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const base = `/api/v1/organizations/${organizationId}/incidents/${incidentId}`;
      const [detailResponse, graphResponse] = await Promise.all([
        fetch(base, { credentials: 'include' }),
        fetch(`${base}/graph`, { credentials: 'include' }),
      ]);
      if (!detailResponse.ok || !graphResponse.ok) throw new Error('unavailable');
      setIncident((await detailResponse.json()) as IncidentDetail);
      setGraph((await graphResponse.json()) as IncidentGraphValue);
      setMessage('Incidente actualizado.');
    } catch {
      setMessage('No fue posible cargar el incidente. Verifica sesión y permisos.');
    }
  }, [incidentId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (incident === null) return;
    const values = new FormData(event.currentTarget);
    const target = String(values.get('status'));
    const payload: Record<string, unknown> = {
      reason: String(values.get('reason')),
      status: target,
      version: incident.version,
    };
    const rootCause = String(values.get('rootCause') ?? '').trim();
    const lessonsLearned = String(values.get('lessonsLearned') ?? '').trim();
    if (rootCause !== '') payload['rootCause'] = rootCause;
    if (lessonsLearned !== '') payload['lessonsLearned'] = lessonsLearned;
    await command('transitions', payload, 'POST', 'Estado actualizado.');
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') ?? '');
    const succeeded = await command('comments', { body }, 'POST', 'Comentario agregado.', true);
    if (succeeded) form.reset();
  }

  async function updateAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (incident === null) return;
    const values = new FormData(event.currentTarget);
    await command(
      'analysis',
      {
        lessonsLearned: String(values.get('lessonsLearned') ?? '').trim() || null,
        rootCause: String(values.get('rootCause') ?? '').trim() || null,
        version: incident.version,
      },
      'PATCH',
      'Análisis guardado.',
    );
  }

  async function uploadEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (incident === null) return;
    const form = event.currentTarget;
    const fileValue = new FormData(form).get('evidence');
    if (!(fileValue instanceof File) || fileValue.size === 0) return;
    setBusy(true);
    setMessage('Validando y cargando evidencia en cuarentena…');
    try {
      const sha256 = await digest(fileValue);
      const base = `/api/v1/organizations/${organizationId}/incidents/${incidentId}/evidence`;
      const request = await fetch(`${base}/upload-requests`, {
        body: JSON.stringify({
          contentType: fileValue.type,
          fileName: fileValue.name,
          sha256,
          sizeBytes: fileValue.size,
        }),
        credentials: 'include',
        headers: mutationHeaders(true),
        method: 'POST',
      });
      if (!request.ok) throw new Error('request rejected');
      const authorization = (await request.json()) as {
        evidence: Evidence;
        upload: { headers: Record<string, string>; url: string };
      };
      const upload = await fetch(authorization.upload.url, {
        body: fileValue,
        headers: authorization.upload.headers,
        method: 'PUT',
      });
      if (!upload.ok) throw new Error('upload failed');
      const completion = await fetch(`${base}/${authorization.evidence.id}/completion`, {
        body: JSON.stringify({ version: authorization.evidence.version }),
        credentials: 'include',
        headers: mutationHeaders(),
        method: 'POST',
      });
      if (!completion.ok) throw new Error('inspection failed');
      const completed = (await completion.json()) as Evidence;
      setMessage(
        completed.status === 'AVAILABLE'
          ? 'Evidencia verificada y disponible.'
          : `Evidencia rechazada: ${completed.rejectionReason ?? 'contenido no permitido'}.`,
      );
      form.reset();
      await load();
    } catch {
      setMessage('La evidencia no pudo verificarse; permanece privada o en cuarentena.');
    } finally {
      setBusy(false);
    }
  }

  async function download(evidence: Evidence) {
    setMessage('Generando enlace privado de corta duración…');
    const response = await fetch(
      `/api/v1/organizations/${organizationId}/incidents/${incidentId}/evidence/${evidence.id}/download-url`,
      { credentials: 'include' },
    );
    if (!response.ok) {
      setMessage('No fue posible autorizar la descarga.');
      return;
    }
    const value = (await response.json()) as { url: string };
    window.open(value.url, '_blank', 'noopener,noreferrer');
    setMessage('Enlace privado generado.');
  }

  async function command(
    suffix: string,
    body: unknown,
    method: 'PATCH' | 'POST',
    success: string,
    idempotent = false,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/v1/organizations/${organizationId}/incidents/${incidentId}/${suffix}`,
        {
          body: JSON.stringify(body),
          credentials: 'include',
          headers: mutationHeaders(idempotent),
          method,
        },
      );
      if (!response.ok) throw new Error('command rejected');
      setMessage(success);
      await load();
      return true;
    } catch {
      setMessage('La operación fue rechazada. Actualiza la vista y revisa permisos o transición.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (incident === null) {
    return <p className="mt-8 rounded-2xl border border-white/10 p-8 text-slate-300">{message}</p>;
  }
  const transitions = TRANSITIONS[incident.status] ?? [];
  return (
    <>
      <header className="mt-6 flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-sm font-semibold text-cyan-300">
            {incident.key} · {incident.priority} · {incident.status}
          </p>
          <h1 className="mt-2 text-4xl font-semibold text-white">{incident.title}</h1>
          <p className="mt-3 max-w-3xl leading-7 text-slate-400">{incident.description}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm">
          <p className="text-slate-500">Versión {incident.version}</p>
          <p className="mt-1 font-semibold text-white">Severidad {incident.severity}</p>
        </div>
      </header>
      <p aria-live="polite" className="my-5 min-h-6 text-sm text-slate-400">
        {message}
      </p>

      <section className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-6">
          <Panel title="Cronología auditable">
            <ol className="relative grid gap-5 border-l border-cyan-300/20 pl-6">
              {incident.timeline.map((entry) => (
                <li className="relative" key={entry.id}>
                  <span className="absolute -left-[1.83rem] top-1 h-3 w-3 rounded-full bg-cyan-300" />
                  <p className="text-xs text-slate-500">
                    {new Date(entry.occurredAt).toLocaleString('es-EC')} ·{' '}
                    {entry.actor?.displayName ?? 'Sistema'}
                  </p>
                  <h3 className="mt-1 font-semibold text-white">{entry.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{entry.detail}</p>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Grafo de alcance">
            <IncidentGraph graph={graph} />
          </Panel>
          <Panel title="Evidencias privadas">
            <div className="grid gap-3">
              {incident.evidence.map((item) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-3"
                  key={item.id}
                >
                  <div>
                    <p className="font-semibold text-white">{item.fileName}</p>
                    <p className="text-xs text-slate-500">
                      {item.status} · {Math.ceil(item.sizeBytes / 1024)} KiB
                    </p>
                  </div>
                  {item.status === 'AVAILABLE' ? (
                    <button
                      className="text-sm font-semibold text-cyan-200"
                      onClick={() => void download(item)}
                    >
                      Descargar
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <form className="mt-4" onSubmit={(event) => void uploadEvidence(event)}>
              <input
                accept=".json,.pdf,.csv,.txt,.jpg,.jpeg,.png"
                className="block w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-sm"
                name="evidence"
                required
                type="file"
              />
              <button
                className="mt-3 rounded-xl bg-cyan-300 px-4 py-2 font-semibold text-slate-950"
                disabled={busy}
              >
                Cargar y verificar
              </button>
            </form>
          </Panel>
        </div>

        <aside className="grid content-start gap-5">
          <Panel title="Cambiar estado">
            {transitions.length === 0 ? (
              <p className="text-sm text-slate-400">No hay transiciones disponibles.</p>
            ) : (
              <form onSubmit={(event) => void transition(event)}>
                <Select name="status" values={transitions} />
                <TextArea label="Motivo" minLength={5} name="reason" required />
                <TextArea label="Causa raíz (resolver/cerrar)" minLength={10} name="rootCause" />
                <TextArea label="Lecciones (cerrar)" minLength={10} name="lessonsLearned" />
                <Action disabled={busy}>Aplicar transición</Action>
              </form>
            )}
          </Panel>
          <Panel title="Análisis">
            <form onSubmit={(event) => void updateAnalysis(event)}>
              <TextArea
                defaultValue={incident.rootCause ?? ''}
                label="Causa raíz"
                minLength={10}
                name="rootCause"
              />
              <TextArea
                defaultValue={incident.lessonsLearned ?? ''}
                label="Lecciones aprendidas"
                minLength={10}
                name="lessonsLearned"
              />
              <Action disabled={busy}>Guardar análisis</Action>
            </form>
          </Panel>
          <Panel title={`Comentarios (${incident.comments.length})`}>
            <ul className="grid max-h-72 gap-3 overflow-y-auto">
              {incident.comments.map((comment) => (
                <li className="rounded-xl border border-white/10 p-3 text-sm" key={comment.id}>
                  <p className="leading-6 text-slate-300">{comment.body}</p>
                  <p className="mt-2 text-xs text-slate-500">{comment.author.displayName}</p>
                </li>
              ))}
            </ul>
            <form className="mt-4" onSubmit={(event) => void addComment(event)}>
              <TextArea label="Nuevo comentario" name="body" required />
              <Action disabled={busy}>Agregar</Action>
            </form>
          </Panel>
        </aside>
      </section>
    </>
  );
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="mb-4 font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function TextArea({
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="mt-3 block text-sm text-slate-300">
      {label}
      <textarea
        className="mt-2 min-h-20 w-full rounded-xl border border-white/10 bg-slate-950 p-3"
        {...props}
      />
    </label>
  );
}

function Select({ name, values }: { name: string; values: string[] }) {
  return (
    <select className="w-full rounded-xl border border-white/10 bg-slate-950 p-3" name={name}>
      {values.map((value) => (
        <option key={value}>{value}</option>
      ))}
    </select>
  );
}

function Action({ children, disabled }: { children: ReactNode; disabled: boolean }) {
  return (
    <button
      className="mt-4 w-full rounded-xl bg-cyan-300 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function mutationHeaders(idempotent = false): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(idempotent ? { 'idempotency-key': crypto.randomUUID() } : {}),
    'x-csrf-token': readCookie('aegisflow_csrf') ?? '',
  };
}

async function digest(file: File): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const value = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return value === undefined ? null : decodeURIComponent(value.slice(prefix.length));
}
