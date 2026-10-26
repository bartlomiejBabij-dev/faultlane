import { DemoProjects } from "./projects";

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ broken?: string }> }) {
  const broken = (await searchParams).broken === "http-500";
  return <>
    <div className="eyebrow">DEMO APPLICATION</div>
    <div className="page-heading"><div><h1>Your projects<span className="accent">.</span></h1><p>A small dashboard. Real requests. Room for things to go wrong.</p></div><span className="tag">Synthetic data only</span></div>
    {broken && <div className="notice warning" data-testid="broken-mode">Intentional defect enabled: HTTP 500 leaves the loading indicator visible.</div>}
    <DemoProjects broken={broken} />
    <div className="info-grid"><section className="panel info-panel"><div className="eyebrow">TEST THIS PAGE</div><h3>What happens when the API fails?</h3><p>Run all six checks from a second terminal. FaultLane verifies the visible UI and saves browser evidence.</p><code>npm run faultlane -- run</code></section><section className="panel info-panel"><div className="eyebrow">BROWSER-SIDE REQUEST</div><h3>One endpoint. Five failure modes.</h3><p>Server error, rate limit, slow response, network failure and empty data — plus an unmodified baseline.</p><code>GET /api/demo/projects</code></section></div>
  </>;
}
