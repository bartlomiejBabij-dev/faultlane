import { DemoProjects } from "./projects";
import Link from "next/link";
import type { DemoBug } from "./projects";

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ broken?: string; mode?: string }> }) {
  const params = await searchParams;
  const broken: DemoBug = ["http-500", "retry-no-request", "recovery-error", "recovery-loading"].includes(params.broken ?? "") ? params.broken as DemoBug : undefined;
  const manual = params.mode === "manual";
  const defect = { "http-500": "HTTP 500 leaves the loading indicator visible.", "retry-no-request": "Retry does not send another request.", "recovery-error": "The error remains after a successful retry.", "recovery-loading": "Loading remains after a successful retry." };
  return <>
    <div className="eyebrow">DEMO APPLICATION</div>
    <div className="page-heading"><div><h1>Your projects<span className="accent">.</span></h1><p>A small dashboard. Real requests. Room for things to go wrong.</p></div><span className="tag">Synthetic data only</span></div>
    <p className="mb-5"><Link className="text-link" href={manual ? "/demo" : "/demo?mode=manual"}>{manual ? "Switch to automatic loading (v0.1)" : "Try the click → failure → recovery journey"} ↗</Link></p>
    {broken && <div className="notice warning" data-testid="broken-mode">Intentional defect enabled: {defect[broken]}</div>}
    <DemoProjects key={`${manual}-${broken}`} broken={broken} manual={manual} />
    <div className="info-grid"><section className="panel info-panel"><div className="eyebrow">TEST THIS PAGE</div><h3>What happens when the API fails?</h3><p>Run all six checks from a second terminal. FaultLane verifies the visible UI and saves browser evidence.</p><code>npm run faultlane -- run</code></section><section className="panel info-panel"><div className="eyebrow">BROWSER-SIDE REQUEST</div><h3>One endpoint. Five failure modes.</h3><p>Server error, rate limit, slow response, network failure and empty data — plus an unmodified baseline.</p><code>GET /api/demo/projects</code></section></div>
  </>;
}
