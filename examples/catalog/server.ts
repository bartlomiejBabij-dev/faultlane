import { createServer } from "node:http";
import { once } from "node:events";

// Independent local application: no React, Next.js or FaultLane selectors.
export async function startCatalogFixture(port = 0) {
  const stats = { apiRequests: 0 };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (url.pathname === "/api/inventory") {
      stats.apiRequests++;
      const fail = url.searchParams.get("serverError") === "1";
      response.writeHead(fail ? 503 : 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(fail ? { error: "Synthetic unavailable response" } : [{ label: "Cedar notebook" }, { label: "Graphite pencil" }]));
      return;
    }
    if (url.pathname === "/redirect") { response.writeHead(302, { Location: "https://example.com" }).end(); return; }
    if (url.pathname !== "/catalog") { response.writeHead(404).end("Not found"); return; }
    const bugs = ["missing-retry", "no-request", "stale-error", "stuck-loading", "duplicate-retry", "auto-retry", "server-error", "fake-recovery"];
    const bug = bugs.includes(url.searchParams.get("bug") ?? "") ? url.searchParams.get("bug")! : "none";
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cedar inventory</title>
<style>body{font:16px system-ui;background:#111820;color:#e7edf4;margin:0;padding:48px 24px}main{max-width:640px;margin:auto}label{display:block;margin:24px 0 8px}input,button{font:inherit;padding:12px;border:1px solid #60778a;border-radius:6px}input{background:#182532;color:white;width:60%}button{background:#bee5ce;color:#142e20;cursor:pointer}section{margin-top:24px;border:1px solid #3c4c59;padding:24px;border-radius:8px}[role=alert]{color:#ffc4b8}li{padding:12px}</style></head><body><main>
<h1>Cedar inventory</h1><p>An independent synthetic local app.</p><label for="category">Category</label><input id="category" autocomplete="off"><button id="search">Search inventory</button>
<p role="status" aria-label="Catalog loading" hidden>Looking up items…</p>
<section role="alert" aria-label="Inventory problem" hidden><p>Inventory is unavailable.</p><button id="again">Try again</button></section>
<section role="region" aria-label="Inventory results" hidden><h2>Available items</h2><ul></ul></section>
<script>
const bug=${JSON.stringify(bug)};
const loading=document.querySelector('[role=status]');
const problem=document.querySelector('[role=alert]');
const results=document.querySelector('[role=region]');
let attempts=0;
async function load(){
  attempts++; loading.hidden=false; problem.hidden=true; results.hidden=true;
  try {
    const response=await fetch('/api/inventory?category='+encodeURIComponent(document.querySelector('input').value)+(bug==='server-error'&&attempts>1?'&serverError=1':''));
    if(!response.ok) throw new Error('Unavailable');
    const items=await response.json();
    results.querySelector('ul').replaceChildren(...items.map(item=>{const li=document.createElement('li');li.textContent=item.label;return li}));
    results.hidden=false; problem.hidden=!(bug==='stale-error'&&attempts>1);
  }catch{
    problem.hidden=false;
    document.querySelector('#again').hidden=bug==='missing-retry';
    if(bug==='auto-retry'&&attempts===1) void load();
  }finally{loading.hidden=!(bug==='stuck-loading'&&attempts>1)}
}
document.querySelector('#search').addEventListener('click',()=>void load());
document.querySelector('#again').addEventListener('click',()=>{
  if(bug==='no-request') return;
  if(bug==='fake-recovery'){problem.hidden=true;loading.hidden=true;results.hidden=false;results.querySelector('ul').innerHTML='<li>Cedar notebook</li>';return;}
  void load(); if(bug==='duplicate-retry') void load();
});
</script></main></body></html>`);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind to loopback");
  return { server, stats, url: `http://127.0.0.1:${address.port}` };
}
