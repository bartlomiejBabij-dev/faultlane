import type { EndpointDefinition, EndpointMatcher, NetworkPolicy, SequenceResponse, TargetOverride } from "./endpoint-schema";
import { isLoopbackOrigin, isSafePathname, normalizeOrigin } from "./endpoint-schema";
export { isLoopbackOrigin, normalizeOrigin } from "./endpoint-schema";

export function matchesPathname(pathname: string, pattern: string): boolean {
  return pattern.endsWith("/*") ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern;
}

export function matchesEndpoint(value: string, method: string, matcher: EndpointMatcher, baseUrl: string): boolean {
  try {
    if (/[\s\\\x7f]/.test(value)) return false;
    const url = new URL(value);
    if (url.username || url.password || !["http:", "https:"].includes(url.protocol) || !isSafePathname(url.pathname)) return false;
    if (url.origin !== (matcher.origin ?? new URL(baseUrl).origin) || method !== matcher.method || !matchesPathname(url.pathname, matcher.pathname)) return false;
    return Object.entries(matcher.query ?? {}).every(([key, expected]) => {
      const actual = url.searchParams.getAll(key);
      return actual.length === 1 && actual[0] === expected;
    });
  } catch { return false; }
}

export function findMatchingEndpoint(value: string, method: string, endpoints: EndpointDefinition[], baseUrl: string): EndpointDefinition | undefined {
  return endpoints.find((endpoint) => matchesEndpoint(value, method, endpoint.match, baseUrl));
}

function pathnamesOverlap(first: string, second: string): boolean {
  if (!first.endsWith("/*")) return matchesPathname(first, second);
  if (!second.endsWith("/*")) return matchesPathname(second, first);
  const a = first.slice(0, -1), b = second.slice(0, -1);
  return a.startsWith(b) || b.startsWith(a);
}

export function matchersOverlap(first: EndpointMatcher, second: EndpointMatcher, baseUrl: string): boolean {
  if ((first.origin ?? new URL(baseUrl).origin) !== (second.origin ?? new URL(baseUrl).origin) || first.method !== second.method || !pathnamesOverlap(first.pathname, second.pathname)) return false;
  return !Object.entries(first.query ?? {}).some(([key, value]) => second.query?.[key] !== undefined && second.query[key] !== value);
}

export type ConfigurationIssue = { path: (string | number)[]; message: string };
export function validateEndpointConfiguration(endpoints: EndpointDefinition[], baseUrl: string, network: NetworkPolicy, targets: TargetOverride[] = []): ConfigurationIssue[] {
  const issues: ConfigurationIssue[] = [];
  const appOrigin = normalizeOrigin(baseUrl);
  if (!appOrigin || !isLoopbackOrigin(appOrigin)) return [{ path: ["baseUrl"], message: "The browser application origin must be HTTP(S) loopback." }];
  const checkResponse = (endpoint: EndpointDefinition, response: SequenceResponse, at: (string | number)[]) => {
    const nested = response.type === "slow" ? response.response : response;
    if (nested.type === "forward") {
      const origin: string = endpoint.match.origin ?? appOrigin;
      if (!isLoopbackOrigin(origin) || (origin !== appOrigin && !network.localOrigins.includes(origin)) || !["GET", "HEAD"].includes(endpoint.match.method)) issues.push({ path: at, message: "Forwarding requires GET/HEAD and the application origin or an explicitly declared loopback localOrigin. External API forwarding is never allowed." });
    }
    if (endpoint.format === "supabase-rest" && nested.type === "mock" && !Array.isArray(nested.json)) issues.push({ path: at, message: "Supabase REST collection mocks require a JSON array." });
  };
  for (const [index, endpoint] of endpoints.entries()) {
    const origin: string = endpoint.match.origin ?? appOrigin;
    if (origin !== appOrigin && !network.mockOrigins.includes(origin)) issues.push({ path: ["endpoints", index, "match", "origin"], message: "Every cross-origin endpoint must be explicitly listed in network.mockOrigins; this permits interception, not remote access." });
    checkResponse(endpoint, endpoint.response, ["endpoints", index, "response"]);
    for (let previous = 0; previous < index; previous++) if (matchersOverlap(endpoints[previous]!.match, endpoint.match, appOrigin)) issues.push({ path: ["endpoints", index, "match"], message: "Endpoint matcher overlaps another configured endpoint. Use disjoint origin, method, pathname or exact query conditions." });
  }
  for (const [index, target] of targets.entries()) {
    const endpoint = endpoints.find((item) => item.id === target.id);
    if (!endpoint) { issues.push({ path: ["targets", index, "id"], message: "Target override must refer to a configured endpoint ID." }); continue; }
    if (target.sequence.length > endpoint.maxRequests) issues.push({ path: ["targets", index, "sequence"], message: "The response sequence must fit within this endpoint's maxRequests." });
    for (const [ordinal, response] of target.sequence.entries()) checkResponse(endpoint, response, ["targets", index, "sequence", ordinal]);
  }
  return issues;
}

export type NetworkDecision = { kind: "same-origin" | "allowed-asset"; reason?: never } | { kind: "blocked"; reason: string };

// Wywoływane po dopasowaniu endpointów. localOrigins nie zezwala na niedopasowane żądania.
export function classifyNetworkRequest(value: string, method: string, resourceType: string, baseUrl: string, policy: NetworkPolicy): NetworkDecision {
  let url: URL;
  if (/[\s\\\x7f]/.test(value)) return { kind: "blocked", reason: "Invalid request URL." };
  try { url = new URL(value); } catch { return { kind: "blocked", reason: "Invalid request URL." }; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return { kind: "blocked", reason: "Unsupported URL protocol or embedded credentials." };
  if (!["GET", "HEAD"].includes(method)) return { kind: "blocked", reason: "Unmatched non-read-only request." };
  if (["fetch", "xhr", "eventsource"].includes(resourceType)) return { kind: "blocked", reason: "Browser API request did not match an explicitly configured endpoint." };
  const safeLocalResources = ["document", "stylesheet", "font", "image", "script", "media", "manifest", "other"];
  if (url.origin === new URL(baseUrl).origin && safeLocalResources.includes(resourceType)) return { kind: "same-origin" };
  // Zasoby lokalnego bundlera (np. /@vite/client i chunk[hash].js) nie są matcherami API.
  // Reguły dla zewnętrznych zasobów nadal używają ograniczonej składni ścieżek.
  if (!isSafePathname(url.pathname)) return { kind: "blocked", reason: "Asset pathname is outside the supported matching rules." };
  if (policy.assets.some((rule) => url.origin === rule.origin && matchesPathname(url.pathname, rule.pathname) && (rule.resourceTypes as string[]).includes(resourceType))) return { kind: "allowed-asset" };
  return { kind: "blocked", reason: "Destination or asset resource type is not explicitly permitted." };
}
