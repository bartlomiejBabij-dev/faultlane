"use client";
import { useState, useSyncExternalStore } from "react";

const subscribe = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

export default function Orders() {
  const hydrated = useSyncExternalStore(subscribe, hydratedSnapshot, serverSnapshot);
  const [orders, setOrders] = useState<{ title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function load(retry = false) {
    const bug = new URLSearchParams(window.location.search).get("bug");
    if (retry && bug === "no-request") return;
    setBusy(true); setError(false); setOrders([]);
    try {
      const response = await fetch("/api/shipments", { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      setOrders(await response.json());
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <main>
    <h1>Harbor dispatch desk</h1><p>Synthetic orders. No production data.</p>
    <button disabled={!hydrated} onClick={() => void load()}>Fetch shipments</button>
    {busy && <p role="status" aria-label="Shipment progress">Fetching shipments…</p>}
    {error && <aside role="alert" aria-label="Shipment problem"><p>Shipments could not be retrieved.</p><button onClick={() => void load(true)}>Reconnect</button></aside>}
    {orders.length > 0 && <section aria-label="Dispatch results"><h2>Dispatch queue</h2><ol>{orders.map((order) => <li key={order.title}>{order.title}</li>)}</ol></section>}
  </main>;
}
