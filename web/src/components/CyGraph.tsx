import cytoscape, { type Core, type ElementDefinition, type LayoutOptions, type StylesheetJson } from "cytoscape";
// @ts-expect-error: cytoscape-fcose ships no type declarations
import fcose from "cytoscape-fcose";
import React, { useEffect, useRef } from "react";
import { prefersDark } from "../theme";

cytoscape.use(fcose);

export interface CyGraphProps {
  elements: ElementDefinition[];
  layout: LayoutOptions;
  selected?: string | null;
  onSelect?: (id: string, isEdge: boolean) => void;
  onActivate?: (id: string) => void; // double-click / double-tap on a node
  onBackground?: () => void;
  extraStyle?: StylesheetJson;
  className?: string;
  style?: React.CSSProperties;
  minZoom?: number;
  /** after layout, never zoom in further than this (keeps small graphs readable) */
  maxFitZoom?: number;
}

export function baseStyle(): StylesheetJson {
  const dark = prefersDark();
  const text = dark ? "#e2e8f0" : "#1e293b";
  const halo = dark ? "#0f172a" : "#ffffff";
  return [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        shape: "data(shape)" as any,
        label: "data(label)",
        color: text,
        "font-family": "Inter, system-ui, sans-serif",
        "font-size": 10,
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-wrap": "wrap",
        "text-max-width": "120px",
        "text-outline-color": halo,
        "text-outline-width": 2,
        width: "data(size)",
        height: "data(size)",
        "border-width": 0,
      },
    },
    { selector: "node[?focus]", style: { "border-width": 3, "border-color": text, "font-weight": 600, "font-size": 12 } },
    { selector: "node[?dim]", style: { opacity: 0.45 } },
    { selector: "node[?excluded]", style: { "border-width": 2, "border-style": "dashed", "border-color": "#dc2626" } },
    { selector: "node[?flagged]", style: { "border-width": 3, "border-color": "#f59e0b" } },
    {
      selector: "edge",
      style: {
        width: 1.6,
        "line-color": "data(color)",
        "target-arrow-color": "data(color)",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        "curve-style": "bezier",
        label: "data(label)",
        "font-size": 8,
        color: dark ? "#94a3b8" : "#64748b",
        "text-rotation": "autorotate",
        "text-outline-color": halo,
        "text-outline-width": 2,
      },
    },
    { selector: "edge[?dashed]", style: { "line-style": "dashed" } },
    { selector: "edge.hl", style: { width: 2.6, "z-index": 10 } },
    { selector: "node.hl", style: { "font-weight": 600 } },
    { selector: "edge[?strong]", style: { width: 2.6 } },
    {
      selector: ":selected",
      style: { "overlay-color": "#38bdf8", "overlay-opacity": 0.25, "overlay-padding": 6 } as any,
    },
  ];
}

export function CyGraph({
  elements, layout, selected, onSelect, onActivate, onBackground, extraStyle, className, style, minZoom = 0.2, maxFitZoom = 1.4,
}: CyGraphProps) {
  const host = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const handlers = useRef({ onSelect, onActivate, onBackground });
  handlers.current = { onSelect, onActivate, onBackground };

  useEffect(() => {
    if (!host.current) return;
    const inst = cytoscape({
      container: host.current,
      elements,
      style: [...baseStyle(), ...(extraStyle ?? [])],
      layout: { name: "preset" }, // keep element positions; the real layout runs below
      minZoom,
      maxZoom: 3,
      wheelSensitivity: 0.25,
    });
    inst.on("tap", "node, edge", (evt) => handlers.current.onSelect?.(evt.target.id(), evt.target.isEdge()));
    inst.on("dbltap", "node", (evt) => handlers.current.onActivate?.(evt.target.id()));
    inst.on("tap", (evt) => {
      if (evt.target === inst) handlers.current.onBackground?.();
    });
    inst.on("mouseover", "node", (evt) => evt.target.connectedEdges().addClass("hl").connectedNodes().addClass("hl"));
    inst.on("mouseout", "node", () => inst.elements(".hl").removeClass("hl"));
    // run the layout after the listener exists (non-animated layouts finish synchronously)
    const run = inst.layout(layout);
    run.one("layoutstop", () => {
      if (inst.zoom() > maxFitZoom) {
        inst.zoom(maxFitZoom);
        inst.center();
      }
    });
    run.run();
    cy.current = inst;
    return () => inst.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, layout]);

  useEffect(() => {
    const inst = cy.current;
    if (!inst) return;
    inst.$(":selected").unselect();
    if (selected) inst.getElementById(selected).select();
  }, [selected, elements]);

  return <div ref={host} className={className ?? "cy"} style={style} />;
}
