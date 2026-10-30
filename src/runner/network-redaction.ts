export type SafeRequestMetadata = {
  origin: string;
  pathname: string;
  queryKeys: string[];
  method: string;
  resourceType: string;
};

/** Metadane są opisem pokrycia; nigdy nie służą do dopasowania requestu. */
export function sanitizeMetadataText(value: string, maxLength = 500): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength);
}

/** Usuwa query/fragment również wtedy, gdy wywołujący poda pełny path. */
export function sanitizePathname(pathname: string): string {
  return sanitizeMetadataText(pathname.split(/[?#]/, 1)[0] ?? "/", 500)
    .replace(/%(?:0[0-9a-f]|1[0-9a-f]|7f)/gi, "_");
}

/** Wszystkie wartości są pomijane, także dla nierozpoznanych nazw parametrów. */
export function sanitizeQueryKeys(keys: Iterable<string>): string[] {
  const distinct = new Set<string>();
  let checked = 0;
  for (const key of keys) {
    distinct.add(/^[a-zA-Z_][a-zA-Z0-9_.[\]-]{0,63}$/.test(key) ? key : "[redacted-key]");
    if (distinct.size >= 30 || ++checked >= 200) break;
  }
  return [...distinct].sort();
}

export function safeRequestMetadata(url: string, method: string, resourceType: string): SafeRequestMetadata {
  const safeMethod = /^[A-Z]{1,20}$/.test(method) ? method : "OTHER";
  const safeType = /^[a-z-]{1,30}$/.test(resourceType) ? resourceType : "other";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
      return { origin: "[non-http]", pathname: "[omitted]", queryKeys: [], method: safeMethod, resourceType: safeType };
    }
    return { origin: parsed.origin.length <= 300 ? parsed.origin : "[invalid URL]", pathname: sanitizePathname(parsed.pathname), queryKeys: sanitizeQueryKeys(parsed.searchParams.keys()), method: safeMethod, resourceType: safeType };
  } catch {
    return { origin: "[invalid URL]", pathname: "[omitted]", queryKeys: [], method: safeMethod, resourceType: safeType };
  }
}
