# FaultLane — zasady pracy

- Projekt jest lokalnym narzędziem developerskim. Strona aplikacji pozostaje HTTP(S) loopback; brak integracji chmurowych. Zewnętrzne browser API wolno wyłącznie mockować po jawnej zgodzie `network.mockOrigins`, nigdy przekazywać do prawdziwej usługi.
- Runner znajduje się w `src/runner`, demo w `src/app/demo`, panel w `src/app/results`, bezpieczny odczyt plików w `src/lib/report-store.ts`.
- Zod waliduje konfigurację i odczytywane raporty. Zachowaj strict TypeScript i jawne typy wyników.
- PASS wymaga przechwyconego API, wykonanej symulacji i wszystkich jawnych asercji UI. Nie zastępuj ich samą nawigacją ani brakiem błędów.
- Kroki są deklaratywne i walidowane w `journey-schema.ts`; nie dodawaj eval ani dowolnych selektorów CSS do konfiguracji. Preferuj role z nazwami, etykiety i test IDs.
- Legacy `recovery` wymaga fault coverage, jawnego kliknięcia i nowego requestu z prawdziwą odpowiedzią 2xx. Nowe `endpoints` dopuszczają jawne sekwencje mock/forward i automatyczny backoff; każdy wymagany request musi rzeczywiście wystąpić. Wizualny sukces bez nowego requestu jest FAIL. Respektuj limity i nie zaliczaj SKIPPED.
- Czytaj raporty schemaVersion 1, 2 i 3 bez migracji na dysku. Nie edytuj ani nie usuwaj historycznych raportów. Najnowszy wynik i sumy historyczne prezentuj oddzielnie.
- Każdy scenariusz używa świeżego kontekstu Chromium; interceptory rejestruj przed nawigacją. Zachowaj skończone limity czasu.
- Nie zapisuj surowych logów, treści żądań, cookies, nagłówków ani stack trace z aplikacji. Zrzuty testuj na danych syntetycznych.
- `broken=http-500` jest wyłącznie jawnym demonstracyjnym przełącznikiem. Nie włączaj go domyślnie.
- Tak samo traktuj `retry-no-request`, `recovery-error`, `recovery-loading`; tryb ręcznego ładowania jest jawny (`mode=manual`). Zachowaj automatyczne `/demo` z v0.1.
- Przy zmianach runnera wykonaj `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`. Przy zmianach aplikacji sprawdź również `npm run build`.
- Nie dodawaj testów pozorujących sukces. Test błędnego demo musi weryfikować rzeczywisty FAIL i niezerowy kod CLI.
- Niezależna aplikacja testowa jest w `examples/catalog`; testuj runner również na niej, bez demo-specific selektorów. `npm run verify` obejmuje typecheck, lint, jednostkowe, wszystkie E2E i build.
- Dokumentacja i podsumowania dla właściciela projektu są po polsku. Komunikaty produktu mogą pozostać po angielsku.
- CLI buduj przez `npm run build:cli`; `dist/cli.js` jest publicznym bin. Zachowaj `private: true` i paczkę bez panelu, źródeł demo i raportów.
- `init` i `init --yes` współdzielą schemat v0.2; nie zgaduj oczekiwań UI i nie nadpisuj konfiguracji bez jawnej kopii. Nie pobieraj automatycznie Chromium w init/doctor/run.
- `doctor` nie zapisuje plików w projekcie i nie certyfikuje UI. Konfiguracja TypeScript pozostaje zaufanym kodem; wyjaśniaj tę granicę.
- Ścieżki CLI licz od katalogu aplikacji. `npm run test:package` kopiuje `examples/next-orders` i `examples/catalog` poza repozytorium, instaluje tarball i sprawdza rzeczywiste PASS/FAIL/ERROR. `npm run verify` obejmuje też build CLI i test paczki.
- V0.4 dodaje do testu paczki React/Vite, a do E2E osobny Supabase-style REST. Nie używaj prawdziwych kluczy ani zdalnych produkcyjnych API. Liczniki lokalnych serwerów muszą dowodzić, że mockowanie i blokady nie wysyłają do nich requestów.
- W `endpoints` odrzucaj nakładające się matchery; liczniki i sekwencje są niezależne. Niedopasowane fetch/XHR blokuj. `assets` dotyczy tylko jawnych originów, ścieżek i typów statycznych zasobów, bez danych autoryzacji przeglądarki. Usuwaj wszystkie wartości query z metadanych raportu.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
