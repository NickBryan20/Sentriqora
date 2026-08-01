'use client';

import { useEffect, useMemo, useState } from 'react';

interface GraphNode {
  id: string;
  riskScore: number;
  severity: string;
  title: string;
}
interface GraphEdge {
  dimension: string;
  id: string;
  source: string;
  target: string;
  weight: number;
}

export function AlertGraph({
  alertId,
  organizationId,
}: {
  alertId: string;
  organizationId: string;
}) {
  const [graph, setGraph] = useState<{ edges: GraphEdge[]; nodes: GraphNode[] }>({
    edges: [],
    nodes: [],
  });
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch(`/api/v1/organizations/${organizationId}/alerts/${alertId}/graph`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        return response.json() as Promise<typeof graph>;
      })
      .then(setGraph)
      .catch(() => setError('No fue posible cargar el grafo. Verifica la sesión y los permisos.'));
  }, [alertId, organizationId]);
  const points = useMemo(
    () =>
      new Map(
        graph.nodes.map((node, index) => {
          const angle =
            graph.nodes.length <= 1 ? 0 : (index / graph.nodes.length) * Math.PI * 2 - Math.PI / 2;
          return [node.id, { x: 300 + Math.cos(angle) * 205, y: 245 + Math.sin(angle) * 170 }];
        }),
      ),
    [graph.nodes],
  );

  if (error !== '')
    return (
      <p className="rounded-2xl border border-rose-300/20 p-6 text-rose-200" role="alert">
        {error}
      </p>
    );
  if (graph.nodes.length === 0)
    return (
      <p className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">
        Esta alerta todavía no tiene correlaciones.
      </p>
    );
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-slate-950/70 p-4">
        <svg
          aria-label="Grafo de alertas correlacionadas"
          className="mx-auto min-w-[600px]"
          role="img"
          viewBox="0 0 600 490"
        >
          <g stroke="rgb(34 211 238 / .45)">
            {graph.edges.map((edge) => {
              const source = points.get(edge.source);
              const target = points.get(edge.target);
              return source === undefined || target === undefined ? null : (
                <line
                  key={edge.id}
                  strokeWidth={Math.min(6, 1 + edge.weight)}
                  x1={source.x}
                  x2={target.x}
                  y1={source.y}
                  y2={target.y}
                >
                  <title>
                    {edge.dimension}: peso {edge.weight}
                  </title>
                </line>
              );
            })}
          </g>
          {graph.nodes.map((node) => {
            const point = points.get(node.id);
            if (point === undefined) return null;
            const root = node.id === alertId;
            return (
              <g key={node.id} transform={`translate(${point.x} ${point.y})`}>
                <circle
                  fill={root ? '#22d3ee' : '#172554'}
                  r={root ? 42 : 34}
                  stroke="#67e8f9"
                  strokeWidth={root ? 4 : 2}
                />
                <text
                  fill={root ? '#020617' : '#e2e8f0'}
                  fontSize="12"
                  fontWeight="700"
                  textAnchor="middle"
                  y="4"
                >
                  {Math.round(node.riskScore)}
                </text>
                <title>{node.title}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <aside>
        <h2 className="font-semibold text-white">Relaciones</h2>
        <ul className="mt-4 grid gap-3">
          {graph.edges.map((edge) => (
            <li className="rounded-xl border border-white/10 p-3 text-sm" key={edge.id}>
              <span className="font-semibold text-cyan-200">{edge.dimension}</span>
              <span className="ml-2 text-slate-400">peso {edge.weight}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
