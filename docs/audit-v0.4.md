# Weryfikacja FaultLane v0.4 — 29–30 października 2026

## Punkt wyjścia i zakres

Przed zmianami drzewo Git było czyste, na commicie `ec4ffe0` (`Add external app onboarding and CLI v0.3`). Wykonano pełne `npm run verify`: **78 testów jednostkowych, 20 E2E, typecheck, lint, build Next.js, build CLI i instalacja paczki w niezależnych aplikacjach — kod 0**. Nie było istniejących zmian użytkownika ani błędów bazowych do nadpisania. Zapisano SHA-256 **991 historycznych plików raportów**; porównanie po implementacji wykazało **0 zmienionych lub brakujących plików**. Nowe raporty, również nieudane przebiegi diagnostyczne, pozostają na dysku.

Środowisko wykonania: **Windows, Node.js 24.21.0, npm 12.2.0, Chromium dostarczany przez zainstalowany Playwright**. Nie wykonano testów na Linux, macOS ani innych liniach Node. Nie wykonano commita, pusha, publikacji npm, deployu ani zmiany remote. Paczka pozostaje `private: true`.

## Architektura i potwierdzone funkcje

- Dotychczasowy model `api` zachowuje swoje reguły i raporty v2. Nowy model `endpoints` ma osobny wykonawca scenariuszy, typowany schemat Zod i raport v3; czytnik akceptuje raporty v1/v2/v3 bez migracji.
- Każdy endpoint ma dokładny origin, metodę, bezpieczną ścieżkę i opcjonalne warunki query, własny licznik oraz ograniczoną sekwencję. Nakładające się matchery są odrzucane. Numery odpowiedzi przydziela się przed operacją asynchroniczną, więc równoległe zakończenia nie zamieniają rekordów.
- `network.mockOrigins` pozwala na mockowanie. Prawdziwy forward obejmuje tylko jawne lokalne GET/HEAD. Niedopasowane API są blokowane; osobne reguły origin/ścieżka/typ dopuszczają potrzebne zasoby statyczne bez cookies i nagłówków autoryzacji przeglądarki. Przekierowania są odrzucane.
- Działają baseline, 500, 429, zerwanie połączenia, pusta tablica, opóźnienie, ręczne recovery i automatyczna sekwencja 429 → 429 → 200. Brak kolejnego wymaganego requestu nie może zostać zastąpiony sukcesem UI.
- Supabase-style GET kolekcji obsługuje jawne warunki query, tablice JSON, błędy o kształcie REST, CORS oraz Content-Range. Fixture używa syntetycznych danych i nagłówków, bez SDK i prawdziwych kluczy.
- `init --advanced` zbiera konfigurację endpointów i uprawnień; `init --advanced --yes --from-json FILE` waliduje kompletny lokalny JSON. Prosty kreator v0.3 pozostaje dostępny. Doctor sprawdza schemat, politykę i lokalne środowisko, ujawniając granice weryfikacji, bez sondowania zewnętrznych API.
- CLI, Markdown, JSON i ciemny panel pokazują sekwencje oczekiwane/rzeczywiste, liczniki, blokady, zero dopasowań, hipotezy i zalecane kroki. Raporty pomijają wartości query, nagłówki, cookies i treści żądań/odpowiedzi. Zrzuty są prawdziwe, na danych syntetycznych.

## Wykonane kontrole

Poniższa tabela zbiera zakończone kontrole implementacji v0.4. Przed zmianą numeru na 0.4.0 przeszło 168 testów jednostkowych, 39 E2E i zewnętrzna instalacja paczki. Dodatkowy test kolejnych opóźnień zwiększył zestaw do **40 E2E**; po poprawce ponownie przeszły kontrola typów, lint, wszystkie testy oraz build aplikacji i CLI. Przerwa w sesji nastąpiła podczas ostatniego testu paczki; ten etap wznowiono osobnym `npm run test:package`. Dane ostatniej zakończonej instalacji tarballa są w lokalnym `.package-tests/latest.json`, a wykonane polecenia także w `.package-tests/last-commands.json`.

| Komenda | Potwierdzony wynik |
| --- | --- |
| `npm run typecheck` | kod 0, strict TypeScript |
| `npm run lint` | kod 0, bez ostrzeżeń ESLint |
| `npm test` | **168 testów, 8 plików**, kod 0 |
| `npm run test:e2e` | **40 E2E**, kod 0; dotychczasowe 20 i 20 testów zgodności |
| `npm run build` | kod 0, produkcyjna aplikacja Next.js |
| `npm run build:cli` | kod 0, ESM i publiczne deklaracje typów |
| `npm run test:package` | **Package smoke PASS**, instalacje poza repozytorium |
| `npm pack --dry-run` | kod 0, sprawdzona lista plików dystrybucji |
| `npx --no-install playwright test tests/e2e/compatibility.spec.ts --grep "dashboard renders"` | 1 PASS po poprawce natywnego rozwijania sekcji; brak błędów hydratacji |
| `git diff --check` | brak błędów whitespace |

`npm run verify` wykonuje kolejno typecheck → lint → test → test:e2e → build → build:cli → test:package. Nie pomija testów negatywnych ani testu panelu. Trzy kompletne przykłady TypeScript z przewodnika zgodności zostały dodatkowo przetworzone i zaakceptowane przez rzeczywisty schemat konfiguracji.

## Niezależne aplikacje i dowody negatywne

| Fixture | Wyniki i zakres dowodu |
| --- | --- |
| Harbor, osobny Next.js | Zachowane `/orders` oraz nowe `/workspace` z `/api/projects`, `/api/profile`, `/api/notifications`. Baseline PASS; 500 → realne lokalne 200 PASS. Pozostałe endpointy mają własne liczniki i prawdziwe odpowiedzi. Retry bez requestu daje FAIL, kod CLI 1; błędny matcher daje ERROR, kod 2. |
| Cedar, Node HTTP/HTML | Dotychczasowe init → doctor → run i recovery nadal PASS. Pozorny sukces bez requestu daje rzeczywisty FAIL; poprawiony przebieg ponownie PASS. |
| Garden, React/Vite | Cross-origin mocki, ręczne recovery po 500, automatyczne 429 → 429 → 200, równoległe requesty i niezależne API sesji. Jawny błąd UI daje FAIL/1. Niezadeklarowana zależność daje ERROR/2. Mockowane i blokowane API nie docierają do lokalnego serwera — licznik 0. |
| Orchard, React/Vite + Supabase-style REST | Baseline i wszystkie pięć awarii PASS, w tym recovery i loading podczas opóźnienia. Sprawdzone tablice, query, CORS, Content-Range i redakcja syntetycznych sekretów. Błędny UI daje FAIL. Nie jest to test SDK Supabase. |

Testy jednostkowe i E2E obejmują ponadto błędny origin, metodę, ścieżkę i query (ERROR z zerowym przechwyceniem), mockowanie `https://…fixture.invalid` bez kontaktu ze zdalnym API, mock POST bez zapisu body, limity i wyczerpanie sekwencji, niezmieniony endpoint, jawny lokalny forward, blokowanie przekierowań oraz odrębność zgody na obrazek i fetch pod tym samym adresem. Panel odczytuje rzeczywisty raport v3 i PNG, pokazuje tabele, pobiera JSON oraz mieści się w szerokości 390 px.

Test paczki tworzy tarball, kopiuje Next.js i Cedar, a następnie React/Vite do świeżych katalogów ze spacjami poza repozytorium. Instaluje rzeczywistą paczkę z lokalnego cache (`npm install --offline --ignore-scripts --no-audit --no-fund --save-dev <tarball>`) i wywołuje zainstalowany publiczny bin. Sprawdza `--help`, `--version`, init, doctor, run, kopię konfiguracji, PASS/FAIL/ERROR i dokładne kody procesów. Deklaracje paczki przechodzą strict TypeScript NodeNext **bez `skipLibCheck`**. Nie korzysta ze źródłowego CLI w zewnętrznych aplikacjach. Dystrybucja nie zawiera panelu, demo, źródeł testowych, konfiguracji projektu ani raportów.

Podczas testów awarii **nie kontaktowano się celowo z produkcyjnymi zdalnymi API**. Testy sieciowe używają loopback oraz mockowanego zarezerwowanego hosta `.invalid`; liczniki lokalnego serwera sprawdzają brak forwardu mockowanych i blokowanych żądań. Nie użyto poświadczeń Supabase. Nie jest to obietnica izolacji sieciowej procesów serwerowych aplikacji ani całego systemu operacyjnego.

## Usterki znalezione i poprawione

1. Domyślna polityka Zod zmieniała kształt legacy konfiguracji. Polityka jest opcjonalna i nie dopisuje nowego trybu do starych konfiguracji.
2. Restrykcyjna gramatyka matcherów API blokowała lokalne pliki bundlera, m.in. `/@vite/client` i nazwy chunków Next.js. Dozwolone lokalne zasoby mają odrębną klasyfikację; reguły zewnętrznych zasobów i API pozostają wąskie.
3. Testowy Vite na porcie 0 generował nieprawidłowy URL WebSocket. Fixture rezerwuje konkretny port i podaje go HMR; nie dodano wyjątku w polityce runnera.
4. Wspólna tablica oczekiwań fixture była mutowana przez test forwardu. Test tworzy własną kopię; rzeczywiste przechwytywanie i CORS nie zostały rozluźnione.
5. Pierwszy pełny przebieg integracyjny przeszedł 168 unit, 39 E2E i build, lecz test paczki wykrył TS2834 w deklaracjach zawierających `import("./endpoint-schema")`. Transformacja AST podczas budowania dodaje `.js` również do węzłów importu typu. Ponowna zewnętrzna instalacja i strict NodeNext przeszły.
6. Rozwinięcie natywnego `<details>` przed hydratacją powodowało ostrzeżenie różnicy atrybutu `open`. Wyłączono ostrzeżenie tylko dla tego elementu zachowującego stan przeglądarki; test kontroluje brak błędów hydratacji, prawdziwe dane i działanie rozwijania.
7. Dwa kolejne opóźnienia w jednej sekwencji przekraczały budżet oparty tylko na największym opóźnieniu. Dodatkowy rzeczywisty E2E najpierw odtworzył `API_REQUEST_TIMEOUT`, a po poprawce przeszedł, potwierdzając dwa requesty i dwie ukończone symulacje. Oczekiwanie uwzględnia teraz sumę zadeklarowanych opóźnień wymaganej części sekwencji, nadal z twardym limitem całego scenariusza.
8. Pierwsza próba wznowienia testu paczki 30 października zwróciła `EVIDENCE_WRITE` przy pierwszym zrzucie baseline Next.js. Kolejny scenariusz zapisał 13 zrzutów. Runner prawidłowo zwrócił ERROR i kod CLI 2; test paczki zakończył się niepowodzeniem. Zachowano raport i ponowiono niezmieniony test, bez pomijania zrzutów ani rozluźnienia asercji. Nie ustalono przyczyny tego pojedynczego błędu; przejściowa niedostępność dowodów pozostaje ryzykiem wykonania.

Nieudane przebiegi były sygnałami do naprawy; nie oznaczono ich jako sukces ani nie usunięto historycznych dowodów.

## Ważne pliki

| Obszar | Pliki |
| --- | --- |
| Schemat i polityka | `src/runner/endpoint-schema.ts`, `network-policy.ts`, `config.ts`, `journey-schema.ts` |
| Wykonanie i diagnostyka | `src/runner/browser-network.ts`, `network-tracker.ts`, `network-redaction.ts`, `browser.ts`, `actions.ts`, `requests.ts` |
| Onboarding i CLI | `src/runner/init-advanced.ts`, `init.ts`, `doctor.ts`, `cli.ts`, `cli-args.ts` |
| Raporty i panel | `src/runner/results.ts`, `report.ts`, `src/app/results/network-details.tsx`, `page.tsx`, `src/app/layout.tsx` |
| Paczka | `scripts/build-cli.mjs`, `scripts/test-package.ts`, `scripts/package-compatibility.ts`, `package.json`, `package-lock.json` |
| Fixture i testy | `examples/next-orders/app/workspace`, trzy nowe route handlers, `examples/react-board`, `examples/supabase-tasks`, `examples/test-api`, `tests/helpers/compatibility-fixtures.ts`, `tests/e2e/compatibility.spec.ts`, `tests/unit/network.test.ts`, `advanced-init.test.ts`, `report-v3.test.ts` |
| Dokumentacja | `README.md`, `AGENTS.md`, `docs/real-world-compatibility.md`, `getting-started.md`, `architecture.md`, `scenarios.md`, `limitations.md`, ten audyt |

## Granice i następny etap

Nie zaimplementowano serwerowej iniekcji Next.js, SDK Supabase, Auth, Realtime, Storage, PostgreSQL, RPC, `.single()`, mutacji Supabase ani pełnej semantyki PostgREST. Nie weryfikowano czasu backoff, produkcyjnych usług, Linux/macOS ani wszystkich wersji przeglądarek i frameworków. Service workers są blokowane, routing wyłącza cache; sesje autoryzacyjne i tryb offline wymagają osobnego zakresu. Konfiguracja TypeScript pozostaje zaufanym kodem. Ścieżki URL, jawne oczekiwania i screenshoty mogą zawierać dane aplikacji mimo pomijania query values i nagłówków.

Kreator interaktywny prowadzi przez jeden wybrany scenariusz awarii; bardziej złożone zestawy tworzy się przez pełny JSON lub edycję typowanej konfiguracji. Automatyczne testy kreatora korzystają z kontrolowanych odpowiedzi na pytania; nie zastępuje to badania użyteczności z użytkownikami. Szczegóły limitów i ryzyka opisano w [ograniczeniach](limitations.md).

Zalecany następny etap: lokalne testy zgodności z rzeczywistym SDK Supabase oraz jawne kontrakty czasu i budżetu retry. Zachować obecne granice sieci, rzeczywiste liczniki i negatywne testy CLI.
