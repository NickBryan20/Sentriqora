'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

interface Rule {
  enabled: boolean;
  id: string;
  key: string;
  name: string;
  severity: string;
  threshold: number;
  version: number;
  windowSeconds: number;
}

interface Alert {
  id: string;
  lastSeenAt: string;
  occurrenceCount: number;
  riskScore: number;
  severity: string;
  status: string;
  title: string;
  version: number;
}

export function DetectionConsole({ organizationId }: { organizationId: string | null }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'alerts' | 'rules'>('alerts');

  const load = useCallback(async () => {
    if (organizationId === null) return;
    try {
      const [rulesResponse, alertsResponse] = await Promise.all([
        fetch(`/api/v1/organizations/${organizationId}/detection-rules`, {
          credentials: 'include',
        }),
        fetch(`/api/v1/organizations/${organizationId}/alerts?limit=50`, {
          credentials: 'include',
        }),
      ]);
      if (!rulesResponse.ok || !alertsResponse.ok) throw new Error('unauthorized');
      setRules((await rulesResponse.json()) as Rule[]);
      const page = (await alertsResponse.json()) as { data: Alert[] };
      setAlerts(page.data);
      setMessage('Datos de detección actualizados.');
    } catch {
      setMessage('No fue posible cargar los datos. Inicia sesión y confirma la organización.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (organizationId === null) return;
    const source = new EventSource(`/api/v1/organizations/${organizationId}/alerts/stream`, {
      withCredentials: true,
    });
    source.addEventListener('alerts.snapshot', (event) => {
      const page = JSON.parse((event as MessageEvent<string>).data) as { data: Alert[] };
      setAlerts(page.data);
    });
    source.onerror = () => setMessage('La conexión en tiempo real se reintentará automáticamente.');
    return () => source.close();
  }, [organizationId]);

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (organizationId === null) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const eventType = String(values.get('eventType') ?? '');
    const response = await fetch(`/api/v1/organizations/${organizationId}/detection-rules`, {
      body: JSON.stringify({
        condition: { attributes: [], eventTypes: [eventType] },
        correlationDimensions: ['FINGERPRINT'],
        key: String(values.get('key') ?? ''),
        name: String(values.get('name') ?? ''),
        severity: String(values.get('severity') ?? 'MEDIUM'),
        threshold: Number(values.get('threshold')),
        windowSeconds: Number(values.get('windowSeconds')),
      }),
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'x-csrf-token': readCookie('aegisflow_csrf') ?? '',
      },
      method: 'POST',
    });
    setMessage(
      response.ok
        ? 'Regla creada desactivada para revisión segura.'
        : 'No fue posible crear la regla. Revisa permisos y valores.',
    );
    if (response.ok) {
      form.reset();
      await load();
    }
  }

  async function activate(rule: Rule) {
    if (organizationId === null) return;
    const response = await fetch(
      `/api/v1/organizations/${organizationId}/detection-rules/${rule.id}/activation`,
      {
        body: JSON.stringify({ enabled: !rule.enabled, version: rule.version }),
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': readCookie('aegisflow_csrf') ?? '',
        },
        method: 'POST',
      },
    );
    setMessage(
      response.ok
        ? `Regla ${rule.enabled ? 'desactivada' : 'activada'}.`
        : 'La regla cambió o no tienes permiso. Actualiza e intenta nuevamente.',
    );
    if (response.ok) await load();
  }

  if (organizationId === null) {
    return (
      <section className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.06] p-8">
        <h2 className="text-xl font-semibold text-amber-100">Selecciona una organización</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-amber-50/70">
          Abre esta vista con{' '}
          <code className="rounded bg-black/30 px-2 py-1">?organizationId=&lt;uuid&gt;</code>{' '}
          después de iniciar sesión. La API vuelve a validar la sesión, el tenant y los permisos.
        </p>
      </section>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3" aria-label="Resumen de detección">
        <Metric
          label="Alertas abiertas"
          value={String(alerts.filter((alert) => alert.status === 'OPEN').length)}
        />
        <Metric
          label="Reglas activas"
          value={`${rules.filter((rule) => rule.enabled).length}/${rules.length}`}
        />
        <Metric
          label="Riesgo máximo"
          value={alerts.length === 0 ? '0' : String(Math.max(...alerts.map((a) => a.riskScore)))}
        />
      </div>

      <div className="mt-7 flex gap-2" role="tablist" aria-label="Detección">
        {(['alerts', 'rules'] as const).map((value) => (
          <button
            aria-selected={tab === value}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === value ? 'bg-cyan-300 text-slate-950' : 'border border-white/10 text-slate-300'}`}
            key={value}
            onClick={() => setTab(value)}
            role="tab"
          >
            {value === 'alerts' ? 'Alertas' : 'Reglas'}
          </button>
        ))}
      </div>
      <p aria-live="polite" className="my-4 min-h-6 text-sm text-slate-400">
        {message}
      </p>

      {tab === 'alerts' ? (
        <section className="grid gap-3" role="tabpanel">
          {alerts.length === 0 ? (
            <Empty text="No hay alertas para los filtros actuales." />
          ) : (
            alerts.map((alert) => (
              <article
                className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-5 md:grid-cols-[1fr_auto_auto] md:items-center"
                key={alert.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Severity value={alert.severity} />
                    <span className="text-xs uppercase tracking-wider text-slate-500">
                      {alert.status}
                    </span>
                  </div>
                  <h2 className="mt-2 font-semibold text-white">{alert.title}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {new Date(alert.lastSeenAt).toLocaleString('es-EC')} · {alert.occurrenceCount}{' '}
                    ocurrencias
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500">Riesgo</span>
                  <p className="text-2xl font-semibold text-white">{alert.riskScore}</p>
                </div>
                <a
                  className="rounded-xl border border-cyan-300/30 px-3 py-2 text-center text-sm text-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-300"
                  href={`/detections/alerts/${alert.id}?organizationId=${organizationId}`}
                >
                  Ver grafo
                </a>
              </article>
            ))
          )}
        </section>
      ) : (
        <section className="grid gap-6 lg:grid-cols-[1fr_22rem]" role="tabpanel">
          <div className="grid content-start gap-3">
            {rules.length === 0 ? (
              <Empty text="Aún no existen reglas de detección." />
            ) : (
              rules.map((rule) => (
                <article
                  className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"
                  key={rule.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <Severity value={rule.severity} />
                      <h2 className="mt-2 font-semibold text-white">{rule.name}</h2>
                      <p className="mt-1 text-sm text-slate-400">
                        {rule.threshold} coincidencias / {rule.windowSeconds}s · v{rule.version}
                      </p>
                    </div>
                    <button
                      className="rounded-xl border border-white/15 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-300"
                      onClick={() => void activate(rule)}
                    >
                      {rule.enabled ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
          <form
            className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.04] p-5"
            onSubmit={(event) => void createRule(event)}
          >
            <h2 className="font-semibold text-white">Nueva regla segura</h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Se crea desactivada; revísala antes de activarla.
            </p>
            <Field label="Nombre" name="name" />
            <Field label="Clave" name="key" pattern="[a-z][a-z0-9._-]{2,79}" />
            <Field label="Tipo de evento" name="eventType" pattern="[a-z][a-z0-9._-]{1,119}" />
            <label className="mt-4 block text-sm text-slate-300">
              Severidad
              <select
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 p-3"
                name="severity"
              >
                {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Umbral" min="1" name="threshold" type="number" value="1" />
              <Field label="Ventana (s)" min="60" name="windowSeconds" type="number" value="300" />
            </div>
            <button
              className="mt-5 w-full rounded-xl bg-cyan-300 px-4 py-3 font-semibold text-slate-950 focus:outline-none focus:ring-2 focus:ring-white"
              type="submit"
            >
              Crear regla
            </button>
          </form>
        </section>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </article>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}

function Severity({ value }: { value: string }) {
  const tone =
    value === 'CRITICAL'
      ? 'bg-rose-400/15 text-rose-200'
      : value === 'HIGH'
        ? 'bg-orange-300/15 text-orange-200'
        : 'bg-sky-300/15 text-sky-200';
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{value}</span>;
}

function Field({
  label,
  name,
  ...input
}: {
  label: string;
  min?: string;
  name: string;
  pattern?: string;
  type?: string;
  value?: string;
}) {
  return (
    <label className="mt-4 block text-sm text-slate-300">
      {label}
      <input
        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-300"
        name={name}
        required
        {...input}
      />
    </label>
  );
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const value = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return value === undefined ? null : decodeURIComponent(value.slice(prefix.length));
}
