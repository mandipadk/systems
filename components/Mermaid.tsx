"use client";

import { useEffect, useId, useState } from "react";

function cleanChart(chart: string) {
  return chart
    .replace(/^```(?:mermaid)?/i, "")
    .replace(/```$/i, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function removeLeakedMermaidErrors() {
  if (typeof document === "undefined") return;
  Array.from(document.body.children).forEach((node) => {
    const text = node.textContent ?? "";
    if (text.includes("Syntax error in text") && text.includes("mermaid version")) {
      node.remove();
    }
  });
}

export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        removeLeakedMermaidErrors();
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: "base",
          themeVariables: {
            fontFamily: "Inter, system-ui, sans-serif",
            primaryColor: "#f4efe6",
            primaryTextColor: "#1f2523",
            primaryBorderColor: "#586f5b",
            lineColor: "#496170",
            secondaryColor: "#e8dfd2",
            tertiaryColor: "#fbfaf7"
          }
        });
        const normalizedChart = cleanChart(chart);
        await mermaid.parse(normalizedChart);
        removeLeakedMermaidErrors();
        const result = await mermaid.render(`diagram-${id}`, normalizedChart);
        removeLeakedMermaidErrors();
        if (!cancelled) setSvg(result.svg);
      } catch (caught) {
        removeLeakedMermaidErrors();
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Diagram failed to render.");
      }
    }

    render();
    return () => {
      cancelled = true;
      removeLeakedMermaidErrors();
    };
  }, [chart, id]);

  if (error) {
    return (
      <details className="border border-brick/25 bg-brick/5 p-4 text-sm text-brick">
        <summary className="cursor-pointer font-medium">Diagram could not be rendered</summary>
        <pre className="mt-3 overflow-auto text-xs leading-6">{cleanChart(chart)}</pre>
      </details>
    );
  }

  return (
    <div
      className="mermaid overflow-auto border border-rule bg-paper p-4"
      dangerouslySetInnerHTML={{ __html: svg || "" }}
    />
  );
}
