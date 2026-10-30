"use client";
import { useState, useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export default function Workspace() {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [profile, setProfile] = useState("");
  const [notifications, setNotifications] = useState<number | null>(null);
  const [projects, setProjects] = useState<{ key: string; title: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  async function load(retry = false) {
    const bug = new URLSearchParams(window.location.search).get("bug");
    if (retry && bug === "no-request") { setProblem(false); setProjects([{ key: "fake", title: "Signal harbor" }]); return; }
    setBusy(true); setProblem(false); setProjects(null);
    if (!retry) {
      void fetch("/api/profile", { cache: "no-store" }).then(async (response) => { if (response.ok) setProfile((await response.json() as { nickname: string }).nickname); });
      void fetch("/api/notifications", { cache: "no-store" }).then(async (response) => { if (response.ok) setNotifications((await response.json() as { unread: number }).unread); });
    }
    try {
      const response = await fetch("/api/projects?view=active", { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      setProjects((await response.json() as { entries: { key: string; title: string }[] }).entries);
    } catch { if (bug === "ignore-error") setProjects([{ key: "fake", title: "Pretend success" }]); else setProblem(true); }
    finally { setBusy(false); }
  }
  return <main>
    <h1>Harbor workspace</h1><p>Three independent browser API requests.</p>
    <button disabled={!hydrated} onClick={() => void load()}>Open workspace</button>
    {profile && <section aria-label="Workspace identity">{profile}</section>}
    {notifications !== null && <section aria-label="Workspace notifications">{notifications} unread notices</section>}
    {busy && <p role="status" aria-label="Workspace progress">Reading projects…</p>}
    {problem && <aside role="alert" aria-label="Project warning"><p>Project list is unavailable.</p><button onClick={() => void load(true)}>Retry projects</button></aside>}
    {projects !== null && <section aria-label="Workspace projects">{projects.length ? <ul>{projects.map((project) => <li key={project.key}>{project.title}</li>)}</ul> : <p>No active projects.</p>}</section>}
  </main>;
}
