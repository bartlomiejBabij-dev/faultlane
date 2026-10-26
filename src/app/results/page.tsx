import Image from "next/image";
import Link from "next/link";
import config from "../../../faultlane.config";
import { listReports } from "@/lib/report-store";
import { summarize, type ScenarioResult } from "@/runner/results";
import { scenarioLabels } from "@/runner/scenarios";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const assetUrl = (id: string, filename: string) => `/api/reports/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`;

function ScenarioDetails({ result, runId }: { result: ScenarioResult; runId: string }) {
  return <details className="scenario" open={result.status !== "PASS"}>
    <summary><span className="scenario-name">{scenarioLabels[result.id]}</span><span className="scenario-duration">{(result.durationMs / 1000).toFixed(1)}s</span><span className={`status ${result.status.toLowerCase()}`}>{result.status === "PASS" ? "✓" : "!"} {result.status}</span></summary>
    <div className="scenario-body"><h3>Observed behavior</h3><p className="text-xs">{result.observation}</p><p className="muted">{result.interceptedRequests} matching request(s) intercepted</p>
      <ul className="assertion-list">{result.assertions.map((assertion, i) => <li key={i}><span className={assertion.passed ? "text-lime-300" : "text-red-300"}>{assertion.passed ? "✓" : "✕"}</span> {assertion.observed} <span className="muted">({assertion.phase})</span></li>)}</ul>
      {result.assertions.length === 0 && <p className="muted">UI assertions were not reached.</p>}
      <h3>Suggested inspection</h3><p className="text-xs">{result.suggestion}</p>
      {result.diagnostics.map((message) => <p className="text-xs" key={message}>{message}</p>)}
      {result.screenshot && <div className="evidence"><a className="text-link" href={assetUrl(runId, result.screenshot)} target="_blank" rel="noreferrer">Open browser evidence ↗</a><Image unoptimized src={assetUrl(runId, result.screenshot)} alt={`${scenarioLabels[result.id]} — ${result.status} screenshot`} width={1440} height={1000} /></div>}
      {result.loadingScreenshot && <p><a className="text-link" href={assetUrl(runId, result.loadingScreenshot)} target="_blank" rel="noreferrer">View loading state during delay ↗</a></p>}
    </div>
  </details>;
}

export default async function ResultsPage() {
  const { runs, skipped, unavailable } = await listReports(config.reportsDir);
  const results = runs.flatMap((run) => run.results);
  const counts = summarize(results);
  const lastError = results.find((result) => result.status !== "PASS");
  return <>
    <div className="eyebrow">RESILIENCE, VERIFIED</div>
    <div className="page-heading"><div><h1>Find failures first<span className="accent">.</span></h1><p>Real browser checks. Clear expectations. Evidence you can act on.</p></div><Link href="/demo" className="button">Open demo <span>↗</span></Link></div>
    <div className="stats"><section className="panel stat"><span className="muted">Recorded runs</span><div className="value">{runs.length}</div><small>Most recent 100 runs</small></section><section className="panel stat"><span className="muted">Passed checks</span><div className="value text-lime-300">{counts.pass}</div><small>Expectations verified</small></section><section className="panel stat"><span className="muted">Failed checks</span><div className="value text-red-300">{counts.fail}</div><small>UI behavior needs attention</small></section><section className="panel stat"><span className="muted">Execution errors</span><div className="value text-amber-200">{counts.error}</div><small>Check setup or configuration</small></section></div>
    {unavailable && <div role="alert" className="notice warning">The report directory cannot be read. Check its local permissions.</div>}
    {skipped > 0 && <div className="notice warning">{skipped} incomplete or invalid report(s) skipped. Only validated, completed reports are shown.</div>}
    {lastError && <div className="notice warning"><strong>Last observed issue · {scenarioLabels[lastError.id]}</strong><div>{lastError.observation}</div></div>}
    <div className="section-heading"><h2>Recent test runs</h2><a href="/results" className="text-link">Refresh results ↻</a></div>
    {runs.length === 0 && <section className="panel empty-results"><span className="status pass">READY WHEN YOU ARE</span><h3 className="mt-5">Your first run starts in the terminal.</h3><p>No results yet. Start the demo server, then run:</p><code>npm run faultlane -- run</code></section>}
    {runs.map((run) => {
      const summary = summarize(run.results);
      const status = summary.error ? "ERROR" : summary.fail ? "FAIL" : "PASS";
      return <article className="panel run" key={run.id} data-testid="run"><div className="run-header"><span className={`status ${status.toLowerCase()}`}>{status}</span><div className="run-meta"><h3>{run.application}</h3><p><time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</time> · {(run.durationMs / 1000).toFixed(1)}s · {summary.pass} passed / {summary.fail} failed / {summary.error} errors</p><code>{run.id}</code></div><a className="text-link" href={assetUrl(run.id, "report.md")}>Markdown ↓</a><a className="text-link" href={assetUrl(run.id, "results.json")}>JSON ↓</a></div>{run.results.map((result) => <ScenarioDetails key={result.id} result={result} runId={run.id} />)}</article>;
    })}
    <div className="info-grid"><section className="panel info-panel"><div className="eyebrow">START A NEW RUN</div><h3>Six checks. One command.</h3><p>Run the baseline and all five configured failures against your local application.</p><code>npm run faultlane -- run</code></section><section className="panel info-panel"><div className="eyebrow">PROVE IT CAN FAIL</div><h3>An intentional defect. A real failure.</h3><p>The broken demo keeps its spinner after HTTP 500. The runner must report FAIL.</p><code>npm run faultlane -- run --config faultlane.broken.config.ts</code></section></div>
  </>;
}
