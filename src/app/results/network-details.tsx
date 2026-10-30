import type { EndpointResult, NetworkSummary } from "@/runner/results";

function EndpointEvidence({ endpoint }: { endpoint: EndpointResult }) {
  return <details className="journey" open={endpoint.interceptedRequests === 0} suppressHydrationWarning data-testid="endpoint-evidence">
    <summary>{endpoint.id} · {endpoint.method} {endpoint.pathname} · {endpoint.interceptedRequests}/{endpoint.expectedRequests} expected requests</summary>
    <div className="request-table">
      <p><code>{endpoint.origin}{endpoint.pathname}</code></p>
      <p className="muted">Query keys: {endpoint.queryKeys.join(", ") || "none"}. All query values redacted.</p>
      <div className="request-metrics"><span>Observed <strong>{endpoint.observedRequests}</strong></span><span>Intercepted <strong>{endpoint.interceptedRequests}</strong></span><span>Blocked <strong>{endpoint.blockedRequests}</strong></span><span>Faulted <strong>{endpoint.faultedRequests}</strong></span><span>Request limit <strong>{endpoint.maxRequests}</strong></span></div>
      <table><caption>Expected response sequence · {endpoint.id}</caption><thead><tr><th>Request</th><th>Action</th><th>HTTP</th><th>Configured delay</th></tr></thead><tbody>{endpoint.expectedSequence.map((response) => <tr key={response.ordinal}><td>#{response.ordinal}</td><td>{response.action}</td><td>{response.status ?? "—"}</td><td>{response.delayMs === undefined ? "—" : `${response.delayMs} ms`}</td></tr>)}</tbody></table>
      <table><caption>Actual response sequence · {endpoint.id}</caption><thead><tr><th>Request</th><th>Phase</th><th>Outcome</th><th>HTTP</th><th>Injected fault</th></tr></thead><tbody>{endpoint.requests.map((response) => <tr key={response.ordinal}><td>#{response.ordinal}</td><td>{response.phase}</td><td>{response.outcome}</td><td>{response.status ?? "—"}</td><td>{response.fault ? "yes" : "no"}</td></tr>)}</tbody></table>
      {!endpoint.requests.length && <p>No matching request was intercepted. No endpoint coverage is claimed.</p>}
    </div>
  </details>;
}

export function NetworkDetails({ endpoints, network }: { endpoints: EndpointResult[]; network: NetworkSummary }) {
  return <section aria-label="Endpoint and network evidence" data-testid="network-evidence">
    <h3>Endpoint coverage</h3>
    <p className="text-xs">Request ordinals are independent for each endpoint. Mocked responses do not prove that the real API is available.</p>
    {endpoints.map((endpoint) => <EndpointEvidence key={endpoint.id} endpoint={endpoint} />)}
    <details className="journey" open={network.blockedRequests > 0 || network.zeroMatchTargets.length > 0} suppressHydrationWarning>
      <summary>Browser network evidence · {network.observedRequests} observed · {network.blockedRequests} blocked</summary>
      <div className="request-table">
        <p className="text-xs">Policy: <code>{network.policy}</code>. Declaring an API origin permits matching mocks; it does not permit contacting that service.</p>
        <div className="request-metrics"><span>Mocked <strong>{network.mockedRequests}</strong></span><span>Explicitly allowed <strong>{network.allowedRequests}</strong></span><span>Blocked <strong>{network.blockedRequests}</strong></span></div>
        <p className="text-xs">Routes with zero matches: {network.zeroMatchTargets.join(", ") || "none"}.</p>
        <table><caption>Observed browser requests · query values redacted</caption><thead><tr><th>Method</th><th>Origin and path</th><th>Query keys</th><th>Resource</th><th>Decision</th><th>Endpoint</th></tr></thead><tbody>{network.events.map((event, index) => <tr key={index}><td>{event.method}</td><td><code>{event.origin}{event.pathname}</code></td><td>{event.queryKeys.join(", ") || "—"}</td><td>{event.resourceType}</td><td>{event.decision}</td><td>{event.endpointId ?? "—"}</td></tr>)}</tbody></table>
        {network.truncated && <p className="text-xs">Only the first 200 events are shown. Counters include later requests.</p>}
      </div>
    </details>
    {network.warnings.length > 0 && <><h3>Coverage warnings</h3><ul className="assertion-list">{network.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></>}
    {network.hypotheses.length > 0 && <><h3>Hypotheses — not verified causes</h3><ul className="assertion-list">{network.hypotheses.map((hypothesis, index) => <li key={index}>{hypothesis}</li>)}</ul></>}
    {network.nextActions.length > 0 && <><h3>Recommended debugging actions</h3><ol className="assertion-list">{network.nextActions.map((action, index) => <li key={index}>{action}</li>)}</ol></>}
  </section>;
}
