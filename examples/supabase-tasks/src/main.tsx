import { useState } from "react";
import { createRoot } from "react-dom/client";

type Task = { id: string; label: string };
const parameters = new URLSearchParams(window.location.search);
const api = parameters.get("api") ?? "http://127.0.0.1:3103";
// To nie jest SDK Supabase: fixture celowo obejmuje tylko jego przeglądarkowy
// kontrakt REST GET kolekcji JSON. Wartości są jawnie syntetyczne, nie są kluczami.
const headers = { apikey: "synthetic-anon-fixture-key", Authorization: "Bearer synthetic-browser-fixture-token", "X-Client-Info": "faultlane-local-fixture", Prefer: "count=exact" };

function Orchard() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [crew, setCrew] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [range, setRange] = useState("");
  async function load(retry = false) {
    if (retry && parameters.get("bug") === "no-request") { setProblem(""); setTasks([{ id: "spruce", label: "Inspect greenhouse" }]); return; }
    setBusy(true); setProblem(""); setTasks(null);
    if (!retry) void fetch(`${api}/rest/v1/teams?select=title`, { headers }).then(async (response) => { if (response.ok) setCrew(((await response.json()) as { title: string }[])[0]?.title ?? ""); }).catch(() => setCrew("Unavailable"));
    try {
      const response = await fetch(`${api}/rest/v1/tasks?select=id,label&status=eq.open&access_token=synthetic-rest-query-secret`, { headers });
      if (!response.ok) {
        const error = await response.json() as { message?: string; code?: string };
        if (typeof error.message !== "string" || typeof error.code !== "string") throw new Error("Malformed REST error");
        throw new Error(response.status === 429 ? "Tasks are rate limited." : "Tasks are unavailable.");
      }
      setRange(response.headers.get("Content-Range") ?? "Header unavailable");
      setTasks(await response.json() as Task[]);
    } catch (error) {
      if (parameters.get("bug") === "ignore-error") setTasks([{ id: "fake", label: "All tasks complete" }]);
      else setProblem(error instanceof Error && error.message.startsWith("Tasks ") ? error.message : "Tasks are unavailable.");
    } finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 680, margin: "40px auto", fontFamily: "system-ui", background: "#142a27", color: "#e9f2e9", padding: 32 }}>
    <h1>Orchard checklist</h1><p>Local Supabase-style REST collection fixture.</p>
    <button onClick={() => void load()}>Find open tasks</button>
    <p aria-label="Orchard team">{crew}</p><p aria-label="REST range">{range}</p>
    {busy && <p role="status" aria-label="Task lookup">Reading checklist…</p>}
    {problem && <aside role="alert" aria-label="Task notice"><p>{problem}</p><button onClick={() => void load(true)}>Refresh checklist</button></aside>}
    {tasks !== null && <section aria-label="Open task list">{tasks.length ? <ol>{tasks.map((task) => <li key={task.id}>{task.label}</li>)}</ol> : <p>There are no open tasks.</p>}</section>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Orchard />);
