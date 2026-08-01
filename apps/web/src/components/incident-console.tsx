'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Incident {
  alertCount: number;
  assignedMembership: { displayName: string; id: string } | null;
  id: string;
  key: string;
  priority: string;
  resolutionDueAt: string;
  responseDueAt: string;
  riskScore: number;
  severity: string;
  sla: { resolutionBreached: boolean; responseBreached: boolean };
  status: string;
  title: string;
  updatedAt: string;
}

interface Notification {
  body: string;
  createdAt: string;
  id: string;
  readAt: string | null;
  title: string;
}

export function IncidentConsole({ organizationId }: { organizationId: string | null }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (organizationId === null) return;
    const query = new URLSearchParams({ limit: '50' });
    if (status !== '') query.set('status', status);
    if (severity !== '') query.set('severity', severity);
    if (search.trim() !== '') query.set('search', search.trim());
    try {
      const [incidentResponse, notificationResponse] = await Promise.all([
        fetch(`/api/v1/organizations/${organizationId}/incidents?${query}`, {
          credentials: 'include',
        }),
        fetch(`/api/v1/organizations/${organizationId}/notifications?limit=20`, {
          credentials: 'include',
        }),
      ]);
      if (!incidentResponse.ok) throw new Error('incidents unavailable');
      const page = (await incidentResponse.json()) as { data: Incident[] };
      setIncidents(page.data);
      if (notificationResponse.ok) {
        setNotifications((await notificationResponse.json()) as Notification[]);
      }
      setMessage('Incidentes actualizados.');
    } catch {
      setMessage('No fue posible cargar los incidentes. Verifica sesión, organización y permisos.');
    }
  }, [organizationId, search, severity, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (organizationId === null) return;
    const source = new EventSource(`/api/v1/organizations/${organizationId}/incidents/stream`, {
      withCredentials: true,
    });
    source.addEventListener('incidents.snapshot', (event) => {
      if (search !== '' || severity !== '' || status !== '') return;
      const page = JSON.parse((event as MessageEvent<string>).data) as { data: Incident[] };
      setIncidents(page.data);
    });
    source.onerror = () => setMessage('La conexión en tiempo real se reintentará automáticamente.');
    return () => source.close();
  }, [organizationId, search, severity, status]);

  const openCount = useMemo(
    () => incidents.filter((incident) => !['RESOLVED', 'CLOSED'].includes(incident.status)).length,
    [incidents],
  );
  const breachedCount = incidents.filter(
    (incident) => incident.sla.responseBreached || incident.sla.resolutionBreached,
  ).length;

  if (organizationId === null) {
    return (
      <section className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.06] p-8">
        <h2 className="text-xl font-semibold text-amber-100">Selecciona una organización</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-amber-50/70">
          Abre esta vista con{' '}
          <code className="rounded bg-black/30 px-2 py-1">?organizationId=&lt;uuid&gt;</code>{' '}
          después de iniciar sesión. La API vuelve a comprobar tenant y permisos en cada operación.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Resumen de incidentes">
        <Metric label="Incidentes activos" value={String(openCount)} />
        <Metric label="SLA incumplidos" value={String(breachedCount)} danger={breachedCount > 0} />
        <Metric
          label="Notificaciones sin leer"
          value={String(notifications.filter((item) => item.readAt === null).length)}
        />
      </section>

      <section className="mt-7 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_12rem_12rem_auto]">
          <label className="text-sm text-slate-300">
            Buscar
            <input
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Clave, título o descripción"
              value={search}
            />
          </label>
          <Filter label="Estado" onChange={setStatus} value={status} values={STATUSES} />
          <Filter label="Severidad" onChange={setSeverity} value={severity} values={SEVERITIES} />
          <button
            className="self-end rounded-xl bg-cyan-300 px-4 py-3 font-semibold text-slate-950"
            onClick={() => void load()}
          >
            Actualizar
          </button>
        </div>
      </section>
      <p aria-live="polite" className="my-4 min-h-6 text-sm text-slate-400">
        {message}
      </p>

      <section className="grid gap-3">
        {incidents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">
            No hay incidentes para los filtros actuales.
          </div>
        ) : (
          incidents.map((incident) => {
            const breached = incident.sla.responseBreached || incident.sla.resolutionBreached;
            return (
              <article
                className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5 lg:grid-cols-[1fr_auto_auto] lg:items-center"
                key={incident.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Priority value={incident.priority} />
                    <span className="text-xs font-semibold text-slate-400">{incident.key}</span>
                    <span className="text-xs uppercase tracking-wider text-slate-500">
                      {incident.status}
                    </span>
                  </div>
                  <h2 className="mt-2 font-semibold text-white">{incident.title}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {incident.alertCount} alertas · Riesgo {incident.riskScore} ·{' '}
                    {incident.assignedMembership?.displayName ?? 'Sin responsable'}
                  </p>
                </div>
                <div className={`text-sm ${breached ? 'text-rose-200' : 'text-slate-400'}`}>
                  <p className="text-xs uppercase tracking-wider">Resolución</p>
                  <p className="mt-1 font-semibold">
                    {breached ? 'SLA incumplido' : formatDeadline(incident.resolutionDueAt)}
                  </p>
                </div>
                <a
                  className="rounded-xl border border-cyan-300/30 px-4 py-2 text-center text-sm font-semibold text-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-300"
                  href={`/incidents/${incident.id}?organizationId=${organizationId}`}
                >
                  Abrir incidente
                </a>
              </article>
            );
          })
        )}
      </section>
    </>
  );
}

const STATUSES = ['OPEN', 'TRIAGED', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED'];
const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function Metric({
  danger = false,
  label,
  value,
}: {
  danger?: boolean;
  label: string;
  value: string;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${danger ? 'text-rose-200' : 'text-white'}`}>
        {value}
      </p>
    </article>
  );
}

function Filter({
  label,
  onChange,
  value,
  values,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
  values: string[];
}) {
  return (
    <label className="text-sm text-slate-300">
      {label}
      <select
        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">Todos</option>
        {values.map((candidate) => (
          <option key={candidate}>{candidate}</option>
        ))}
      </select>
    </label>
  );
}

function Priority({ value }: { value: string }) {
  const tone =
    value === 'P1'
      ? 'bg-rose-400/15 text-rose-200'
      : value === 'P2'
        ? 'bg-orange-300/15 text-orange-200'
        : 'bg-sky-300/15 text-sky-200';
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{value}</span>;
}

function formatDeadline(value: string): string {
  const milliseconds = new Date(value).getTime() - Date.now();
  if (milliseconds <= 0) return 'Vencido';
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} min restantes`;
  return `${Math.ceil(minutes / 60)} h restantes`;
}
