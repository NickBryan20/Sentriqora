'use client';

import { useMemo } from 'react';

export interface IncidentGraphValue {
  edges: { id: string; kind: string; source: string; target: string; weight: number }[];
  nodes: { id: string; kind: string; label: string }[];
}

export function IncidentGraph({ graph }: { graph: IncidentGraphValue }) {
  const points = useMemo(
    () =>
      new Map(
        graph.nodes.map((node, index) => {
          const angle = (index / Math.max(1, graph.nodes.length)) * Math.PI * 2 - Math.PI / 2;
          const radius = node.kind === 'INCIDENT' ? 0 : 175;
          return [
            node.id,
            { x: 260 + Math.cos(angle) * radius, y: 210 + Math.sin(angle) * radius },
          ];
        }),
      ),
    [graph.nodes],
  );
  if (graph.nodes.length === 0) {
    return <p className="p-8 text-center text-sm text-slate-400">No hay relaciones disponibles.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70 p-3">
      <svg
        aria-label="Grafo del incidente, sus alertas y activos"
        className="mx-auto min-w-[520px]"
        role="img"
        viewBox="0 0 520 420"
      >
        <g stroke="rgb(34 211 238 / .4)">
          {graph.edges.map((edge) => {
            const source = points.get(edge.source);
            const target = points.get(edge.target);
            return source === undefined || target === undefined ? null : (
              <line
                key={edge.id}
                strokeWidth={Math.min(5, 1 + edge.weight)}
                x1={source.x}
                x2={target.x}
                y1={source.y}
                y2={target.y}
              >
                <title>{edge.kind}</title>
              </line>
            );
          })}
        </g>
        {graph.nodes.map((node) => {
          const point = points.get(node.id);
          if (point === undefined) return null;
          const incident = node.kind === 'INCIDENT';
          const fill = incident ? '#22d3ee' : node.kind === 'ASSET' ? '#7c3aed' : '#172554';
          return (
            <g key={node.id} transform={`translate(${point.x} ${point.y})`}>
              <circle fill={fill} r={incident ? 43 : 32} stroke="#67e8f9" strokeWidth="2" />
              <text
                fill={incident ? '#020617' : '#e2e8f0'}
                fontSize="10"
                fontWeight="700"
                textAnchor="middle"
                y="4"
              >
                {node.kind}
              </text>
              <title>{node.label}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
