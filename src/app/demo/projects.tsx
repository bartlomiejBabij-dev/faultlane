"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type Project = { id: string; name: string; description: string; language: string; owner: string; status: string };
export type DemoBug = "http-500" | "retry-no-request" | "recovery-error" | "recovery-loading" | undefined;
type State = { kind: "idle" | "loading" } | { kind: "success"; projects: Project[]; staleError: boolean; stuck: boolean } | { kind: "error"; code: "server" | "rate-limit" | "network"; message: string; stuck: boolean };
const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function DemoProjects({ broken, manual = false }: { broken: DemoBug; manual?: boolean }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ kind: manual ? "idle" : "loading" });
  useEffect(() => {
    if (manual && attempt === 0) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    async function load() {
      try {
        const response = await fetch("/api/demo/projects", { signal: controller.signal, cache: "no-store" });
        if (!active) return;
        if (!response.ok) {
          setState({ kind: "error", code: response.status === 429 ? "rate-limit" : "server", message: response.status === 429 ? "Too many requests. Please wait a moment and try again." : "We couldn’t load your projects. Please try again.", stuck: broken === "http-500" && response.status === 500 });
          return;
        }
        const projects: Project[] = await response.json();
        if (active) setState({ kind: "success", projects, staleError: broken === "recovery-error" && attempt > 1, stuck: broken === "recovery-loading" && attempt > 1 });
      } catch {
        if (active) setState({ kind: "error", code: "network", message: "Connection interrupted. Check your connection and try again.", stuck: false });
      } finally { clearTimeout(timeout); }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt, broken, manual]);

  const loading = state.kind === "loading" || ((state.kind === "error" || state.kind === "success") && state.stuck);
  const load = () => { setState({ kind: "loading" }); setAttempt((n) => n + 1); };
  return <section className="panel project-panel" aria-label="Projects">
    <div className="panel-heading"><h2>Project directory</h2><span className="muted">{state.kind === "success" ? `${state.projects.length} projects` : "Live API response"}</span></div>
    {state.kind === "idle" && <div className="state-box" data-testid="idle"><span className="state-symbol">◇</span><h3>Ready to load your projects</h3><p>No request has been made. Start the journey when you’re ready.</p><button onClick={load} disabled={!hydrated}>Load Projects</button></div>}
    {loading && <div className="state-box" data-testid="loading" role="status"><span className="spinner" /><h3>Loading your projects…</h3><p>Connecting to your workspace.</p></div>}
    {state.kind === "error" && <div className="state-box error-state" role="alert" aria-label="Project error" data-testid="error"><span className="state-symbol">!</span><h3 data-testid={state.code}>{state.message}</h3><p>Your workspace is safe. You can retry this request.</p><button aria-label="Retry" data-testid="retry" onClick={() => { if (broken !== "retry-no-request") load(); }}><span aria-hidden="true">↻</span> <span>Retry</span></button></div>}
    {state.kind === "success" && state.staleError && <div role="alert" aria-label="Project error" data-testid="error" className="notice warning">We couldn’t load your projects. Please try again.</div>}
    {state.kind === "success" && (state.projects.length === 0 ? <div className="state-box" data-testid="empty"><span className="state-symbol">◇</span><h3>No projects yet</h3><p>Your projects will appear here when there’s something to show.</p></div> : <div data-testid="projects" className="project-list">{state.projects.map((project, i) => <article key={project.id} className="project-row" data-testid="project"><div className={`project-icon project-icon-${i}`}>{project.name.slice(0, 1)}</div><div className="project-title"><h3>{project.name}</h3><p>{project.description}</p></div><span className="language"><span className="language-dot" />{project.language}</span><span className="muted project-owner">{project.owner}</span><span className="status pass"><span className="online-dot" />{project.status}</span></article>)}</div>)}
  </section>;
}

