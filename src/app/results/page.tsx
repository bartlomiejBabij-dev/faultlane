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
    <div className="scenario-body"><h3>{result.name ?? "Observed behavior"}</h3><p className="text-xs">{result.observation}</p>
      <div className="request-metrics"><span>Observed <strong>{result.observedRequests ?? "not recorded (v0.1)"}</strong></span><span>Intercepted <strong>{result.interceptedRequests}</strong></span><span>Faulted <strong>{result.faultedRequests ?? "not recorded (v0.1)"}</strong></span></div>
      {result.code && <p className="muted"><code>{result.code}</code>{result.failedStep ? ` · Stopped at step ${result.failedStep}` : ""}</p>}
      <ul className="assertion-list">{result.assertions.map((assertion, i) => <li key={i}><span className={assertion.passed ? "text-lime-300" : "text-red-300"}>{assertion.passed ? "✓" : "✕"}</span> {assertion.observed} <span className="muted">({assertion.phase})</span></li>)}</ul>
      {result.assertions.length === 0 && <p className="muted">UI assertions were not reached.</p>}
      {result.steps && result.steps.length > 0 && <details className="journey"><summary>Journey steps · {result.steps.filter((step) => step.status === "PASS").length}/{result.steps.length} completed{result.failedStep ? ` · failed at ${result.failedStep}` : ""}</summary><ol className="step-list">{result.steps.map((step) => <li key={step.index} className={step.status === "SKIPPED" ? "step-skipped" : ""}><div className="step-heading"><span className={`status ${step.status.toLowerCase()}`}>{step.status}</span><strong>{step.index}. {step.expected}</strong><span className="muted">{step.phase} · {(step.durationMs / 1000).toFixed(1)}s</span></div><p>{step.observed}</p>{step.code && <code>{step.code}</code>}{step.screenshot && <a className="text-link" href={assetUrl(runId, step.screenshot)} target="_blank" rel="noreferrer">Step {step.index} evidence ↗</a>}</li>)}</ol></details>}
      {result.requests && result.requests.length > 0 && <details className="journey"><summary>API request evidence · {result.requests.length} recorded</summary><div className="request-table"><table><thead><tr><th>Request</th><th>Phase</th><th>Outcome</th><th>HTTP</th></tr></thead><tbody>{result.requests.map((request) => <tr key={request.ordinal}><td>#{request.ordinal}</td><td>{request.phase}</td><td>{request.outcome}</td><td>{request.status ?? "—"}</td></tr>)}</tbody></table></div></details>}
      <h3>Suggested inspection</h3><p className="text-xs">{result.suggestion}</p>
      {result.diagnostics.map((message) => <p className="text-xs" key={message}>{message}</p>)}
      {result.screenshot && <div className="evidence"><a className="text-link" href={assetUrl(runId, result.screenshot)} target="_blank" rel="noreferrer">Open browser evidence ↗</a><Image unoptimized src={assetUrl(runId, result.screenshot)} alt={`${scenarioLabels[result.id]} — ${result.status} screenshot`} width={1440} height={1000} /></div>}
      {result.loadingScreenshot && <p><a className="text-link" href={assetUrl(runId, result.loadingScreenshot)} target="_blank" rel="noreferrer">View loading state during delay ↗</a></p>}
    </div>
  </details>;
}

export default async function ResultsPage() {
  const { runs, skipped, unavailable } = await listReports(config.reportsDir);
  const latest = runs[0];
  const results = runs.slice(1).flatMap((run) => run.results);
  const counts = summarize(results);
  const latestCounts = summarize(latest?.results ?? []);
  const lastError = latest?.results.find((result) => result.status !== "PASS");
  return <>
    <div className="eyebrow">RESILIENCE, VERIFIED</div>
    <div className="page-heading"><div><h1>Find failures first<span className="accent">.</span></h1><p>Real browser checks. Clear expectations. Evidence you can act on.</p></div><Link href="/demo" className="button">Open demo <span>↗</span></Link></div>
    {latest && <section className="panel latest-run" data-testid="latest-run"><div className="eyebrow">LATEST COMPLETED RUN</div><h2>{latest.name ?? "Legacy v0.1 run"}</h2><p>{latest.application}</p><div className="latest-counts"><span className="status pass">{latestCounts.pass} PASS</span><span className="status fail">{latestCounts.fail} FAIL</span><span className="status error">{latestCounts.error} ERROR</span><span className="muted">{(latest.durationMs / 1000).toFixed(1)}s · <time dateTime={latest.startedAt}>{new Date(latest.startedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</time></span></div><code>{latest.id}</code></section>}
    <div className="section-heading"><h2>Historical totals</h2><span className="muted">Earlier runs only · latest run excluded</span></div>
    <div className="stats" data-testid="historical-totals"><section className="panel stat"><span className="muted">Earlier runs</span><div className="value">{Math.max(0, runs.length - 1)}</div><small>Within the most recent 100</small></section><section className="panel stat"><span className="muted">Historical passes</span><div className="value text-lime-300">{counts.pass}</div><small>Past expectations verified</small></section><section className="panel stat"><span className="muted">Historical failures</span><div className="value text-red-300">{counts.fail}</div><small>Includes intentional defects</small></section><section className="panel stat"><span className="muted">Historical errors</span><div className="value text-amber-200">{counts.error}</div><small>Preserved, not current errors</small></section></div>
    {unavailable && <div role="alert" className="notice warning">The report directory cannot be read. Check its local permissions.</div>}
    {skipped > 0 && <div className="notice warning">{skipped} incomplete or invalid report(s) skipped. Only validated, completed reports are shown.</div>}
    {lastError && <div className="notice warning"><strong>Issue in latest run · {scenarioLabels[lastError.id]}</strong><div>{lastError.observation}</div></div>}
    <div className="section-heading"><h2>Recent test runs</h2><a href="/results" className="text-link">Refresh results ↻</a></div>
    {runs.length === 0 && <section className="panel empty-results"><span className="status pass">READY WHEN YOU ARE</span><h3 className="mt-5">Your first run starts in the terminal.</h3><p>No results yet. Start the demo server, then run:</p><code>npm run faultlane -- run</code></section>}
    {runs.map((run) => {
      const summary = summarize(run.results);
      const status = summary.error ? "ERROR" : summary.fail ? "FAIL" : "PASS";
      return <article className="panel run" key={run.id} data-testid="run"><div className="run-header"><span className={`status ${status.toLowerCase()}`}>{status}</span><div className="run-meta"><h3>{run.name ?? "Legacy v0.1 run"}</h3><p>{run.application}</p><p><time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</time> · {(run.durationMs / 1000).toFixed(1)}s · {summary.pass} passed / {summary.fail} failed / {summary.error} errors</p><code>{run.id}</code></div><a className="text-link" href={assetUrl(run.id, "report.md")}>Markdown ↓</a><a className="text-link" href={assetUrl(run.id, "results.json")}>JSON ↓</a></div>{run.results.map((result) => <ScenarioDetails key={result.id} result={result} runId={run.id} />)}</article>;
    })}
    <div className="info-grid"><section className="panel info-panel"><div className="eyebrow">START A NEW RUN</div><h3>Six checks. One command.</h3><p>Run the baseline and all five configured failures against your local application.</p><code>npm run faultlane -- run</code></section><section className="panel info-panel"><div className="eyebrow">PROVE IT CAN FAIL</div><h3>An intentional defect. A real failure.</h3><p>The broken demo keeps its spinner after HTTP 500. The runner must report FAIL.</p><code>npm run faultlane -- run --config faultlane.broken.config.ts</code></section></div>
    <section className="panel info-panel mt-5"><div className="eyebrow">USER JOURNEYS · V0.2</div><h3>Failure → Retry → recovery</h3><p>Load projects with a click, simulate one HTTP 500, then verify a second real request and the recovered UI.</p><code>npm run demo:recovery</code></section>
  </>;
}
