import { useState } from "react";
import { createRoot } from "react-dom/client";

type Card = { id: number; caption: string };
const parameters = new URLSearchParams(window.location.search);
const api = parameters.get("api") ?? "http://127.0.0.1:3103";

function Board() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [dependency, setDependency] = useState("Not requested");
  async function readCards(attempt = 1): Promise<Card[]> {
    setAttempts(attempt);
    const pathname = parameters.get("route") === "redirect" ? "/v2/redirect" : parameters.get("route") === "redirect-local" ? "/v2/redirect-local" : "/v2/cards";
    const response = await fetch(`${api}${pathname}?lane=ready&token=synthetic-board-query-secret`, parameters.get("method") === "post" ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ synthetic: "synthetic-request-body-secret" }),
    } : undefined);
    if (response.status === 429 && parameters.get("mode") === "auto" && attempt < 3) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
      return readCards(attempt + 1);
    }
    if (!response.ok) throw new Error("Board unavailable");
    const payload = await response.json() as { cards?: Card[] } | Card[];
    return Array.isArray(payload) ? payload : payload.cards ?? [];
  }
  async function load(retry = false) {
    if (retry && parameters.get("bug") === "no-request") {
      setProblem(false); setCards([{ id: 11, caption: "Prepare garden map" }]); return;
    }
    setBusy(true); setProblem(false); setCards(null);
    if (!retry) {
      void fetch(`${api}/v2/session`).then(async (response) => { if (response.ok) setTeam((await response.json() as { displayName: string }).displayName); }).catch(() => setTeam("Unavailable"));
      if (parameters.get("dependency")) {
        const destination = parameters.get("dependency") === "asset-fetch" ? "/assets/leaf.svg" : "/unexpected";
        const dependencyApi = parameters.get("dependencyApi") ?? api;
        void fetch(`${dependencyApi}${destination}?api_key=synthetic-dependency-secret`).then(() => setDependency("Unexpectedly reached server")).catch(() => setDependency("Dependency blocked"));
      }
    }
    try {
      const data = parameters.get("concurrent") === "1" ? (await Promise.all([readCards(), readCards()])).flat()
        : parameters.get("serial") === "1" ? [...await readCards(), ...await readCards(2)] : await readCards();
      setCards(data);
    } catch {
      if (parameters.get("bug") === "ignore-error") setCards([{ id: 99, caption: "Everything is fine" }]);
      else setProblem(true);
    } finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "system-ui", color: "#e8edf5", background: "#17202d", padding: 32 }}>
    <h1>Garden work board</h1><p>Synthetic cross-origin REST requests.</p>
    <button onClick={() => void load()}>Open board</button>
    {parameters.get("asset") === "1" && <img src={`${api}/assets/leaf.svg`} alt="Garden marker" width={16} height={16} />}
    <p aria-label="Board account">{team}</p><p aria-label="Board attempt">Attempt {attempts}</p>
    <p aria-label="Dependency outcome">{dependency}</p>
    {busy && <p role="status" aria-label="Board progress">Updating cards…</p>}
    {problem && <section role="alert" aria-label="Board problem"><p>The board could not be loaded.</p><button onClick={() => void load(true)}>Reload cards</button></section>}
    {cards !== null && <section aria-label="Garden cards">{cards.length ? <ul>{cards.map((card, index) => <li key={`${card.id}-${index}`}>{card.caption}</li>)}</ul> : <p>No cards in this lane.</p>}</section>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Board />);
