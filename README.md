# FaultLane v0.3

**Find failures before users do.** Lokalne narzędzie do sprawdzania, jak interfejs aplikacji reaguje na awarie API. Uruchamia prawdziwe Chromium, przechwytuje żądanie z przeglądarki, wykonuje jawne asercje Playwright i zapisuje raport wraz ze zrzutami ekranu.

To działające MVP: brak kont, chmury, płatnych API i automatycznego skanowania. Panel pokazuje wyłącznie wyniki odczytane z dysku.

**v0.3: CLI we własnym repozytorium.** Lokalnie instalowalny tarball lub `npm link`, interaktywny `faultlane init`, tryb `init --yes`, `faultlane doctor` i `faultlane run` działające bez serwera FaultLane. Konfiguracja i raporty pozostają w testowanej aplikacji. Paczka nie została opublikowana w npm.

Pełna instrukcja dla zewnętrznych Next.js/React, instalacja i odinstalowanie, flagi kreatora oraz recovery: **[Pierwsze użycie](docs/getting-started.md)**.

```sh
# W repozytorium FaultLane:
npm ci
npm run build:cli
npm pack
# W katalogu własnej aplikacji (podaj rzeczywistą lokalną ścieżkę):
npm install --save-dev "/sciezka/do/faultlane-0.3.0.tgz"
npm exec --no -- faultlane init
npm exec --no -- faultlane doctor
# Jeżeli Chromium jest nieobecne: npm exec --no -- faultlane browsers install
# Przy uruchomionej własnej aplikacji:
npm exec --no -- faultlane run
```

Kreator wymaga konkretnych oczekiwań dla baseline i awarii. Bez nich `init --yes` kończy się kodem 2. Istniejącej konfiguracji nie zastępuje bez jawnej kopii (`--backup` lub wybór w kreatorze). `doctor` nie zapisuje plików w projekcie i nie pobiera przeglądarki. Nie stanowi dowodu poprawnego UI — tę weryfikację wykonuje `run`.

Wersja 0.2 dodaje deklaratywne kroki użytkownika i testy **awaria → Retry → odzyskanie**. Dotychczasowe konfiguracje i pięć scenariuszy v0.1 nadal działają bez zmian. Nowe raporty mają `schemaVersion: 2`; panel czyta także wersję 1 i nie przepisuje starych plików.

## Szybki start

Wymagania: Node.js **22.13+, 24.x lub 26.x** (zalecana aktualna wersja LTS), npm, system obsługiwany przez Playwright. Poniższe komendy demonstracyjne uruchamiaj w katalogu FaultLane. Nie potrzebujesz `.env` ani żadnego klucza API.

```sh
npm ci
npm run browsers:install
npm run dev
```

Otwórz [demo](http://127.0.0.1:3000/demo). Serwer domyślnie nasłuchuje wyłącznie na `127.0.0.1`.

W **drugim terminalu**:

```sh
npm run faultlane -- run
```

Oczekiwany wynik normalnego demo: **6 PASS / 0 FAIL / 0 ERROR**. Każdy scenariusz ma świeży kontekst przeglądarki. Demo używa stałych danych syntetycznych i pobiera je po stronie klienta z `GET /api/demo/projects`.

Otwórz [wyniki](http://127.0.0.1:3000/results), a po kolejnych uruchomieniach kliknij **Refresh results**. Panel nie uruchamia komend: odczytuje ostatnie 100 ukończonych raportów z katalogu ustawionego w `faultlane.config.ts`.

Sekcja **Latest completed run** dotyczy wyłącznie ostatniego zakończonego uruchomienia. **Historical totals** sumuje wcześniejsze raporty, z wyłączeniem ostatniego. Historyczny ERROR nie oznacza, że obecny test zakończył się błędem, a nowy PASS nie zmienia historii.

Alternatywnie do trybu developerskiego:

```sh
npm run build
npm start
```

Nie uruchamiaj dwóch serwerów na tym samym porcie. Jeżeli wybierzesz inny port, zmień również `baseUrl` w konfiguracji.

## Dowód wykrywania błędu

```sh
npm run faultlane -- run --config faultlane.broken.config.ts
```

Konfiguracja wybiera `/demo?broken=http-500` i test HTTP 500. Baseline nadal działa. W tym wyraźnie oznaczonym wariancie demo spinner pozostaje po błędzie serwera. Oczekiwany wynik: **1 PASS / 1 FAIL / 0 ERROR**, kod zakończenia **1**, `http-500-failure.png` oraz opis nieudanej asercji. Niezerowy kod jest tutaj prawidłowym dowodem działania narzędzia.

Zwykłe `/demo` i domyślna konfiguracja nie aktywują usterki. Sam parametr demonstracyjny bez symulowanego HTTP 500 nie powoduje awarii.

## Nowe scenariusze v0.2

Przy działającym `npm run dev`, w drugim terminalu:

```sh
# Żądanie wywołane przez Load Projects, następnie HTTP 500:
npm run demo:click
# Jedno HTTP 500 → kliknięcie Retry → prawdziwe HTTP 200:
npm run demo:recovery
# Celowy defekt: Retry nie wysyła żądania; oczekiwany kod 1:
npm run demo:broken-recovery
```

Pierwsze dwie komendy powinny dać **2 PASS**: baseline i test awarii. Trzecia powinna dać **1 PASS / 1 FAIL**, kod `RETRY_NO_REQUEST` i niezerowy kod procesu. Nie jest to błąd instalacji.

Konfiguracje: `faultlane.click.config.ts`, `faultlane.recovery.config.ts`, `faultlane.recovery-broken.config.ts`. Każda może być uruchomiona zwykłym `npm run faultlane -- run --config NAZWA_PLIKU`.

Na [demo w trybie ręcznym](http://127.0.0.1:3000/demo?mode=manual) początkowo nie jest wykonywane żadne żądanie API. Przycisk **Load Projects** uruchamia je dokładnie raz; zwykłe `/demo` zachowuje automatyczne pobieranie z v0.1. Symulacje błędów włącza runner, nie sam przycisk.

Pozostałe celowe usterki recovery, PowerShell:

```powershell
$env:FAULTLANE_DEMO_BUG = 'recovery-error'
npm run demo:broken-recovery
$env:FAULTLANE_DEMO_BUG = 'recovery-loading'
npm run demo:broken-recovery
Remove-Item Env:FAULTLANE_DEMO_BUG
```

W bash odpowiednik to `FAULTLANE_DEMO_BUG=recovery-error npm run demo:broken-recovery`. Dozwolone są wyłącznie `retry-no-request`, `recovery-error`, `recovery-loading`. Żaden defekt nie jest aktywny domyślnie.

## Scenariusze i kody zakończenia

| Scenariusz | Symulacja | Co sprawdza domyślna konfiguracja |
| --- | --- | --- |
| `baseline` | Prawdziwa odpowiedź bez modyfikacji statusu i danych | Atlas API, 3 projekty, brak ładowania i błędu |
| `http-500` | HTTP 500, błąd JSON | Komunikat, Retry, zniknięcie ładowania |
| `http-429` | HTTP 429, `Retry-After: 30` | Komunikat limitu, Retry, brak ładowania |
| `slow` | 3000 ms opóźnienia, potem prawdziwa odpowiedź | Ładowanie podczas opóźnienia, następnie dane |
| `network` | `route.abort("failed")` | Komunikat połączenia, Retry, brak ładowania |
| `empty` | HTTP 200 z `[]` | Przyjazny pusty stan, brak błędu |

**PASS** wymaga przechwycenia żądania, wykonania symulacji, spełnienia wszystkich skonfigurowanych asercji i zapisania końcowego zrzutu. Nie wystarczy poprawne załadowanie strony. Nieobsłużony wyjątek JavaScript również oznacza FAIL.

**FAIL** to niezgodność zachowania UI z oczekiwaniami. **ERROR** to problem wykonania: np. brak żądania, błędny URL, brak Chromium, niedostępny serwer albo brak możliwości zapisu dowodu.

Kody procesu CLI: `0` — wszystkie PASS, `1` — co najmniej jeden FAIL, `2` — błąd konfiguracji/wykonania/zapisu. ERROR ma pierwszeństwo przed FAIL. Niektóre wersje npm normalizują niezerowe kody skryptów do `1`; do dokładnego rozróżnienia użyj:

```sh
node --import tsx src/runner/cli.ts run
```

## Raporty

Każde wykonanie tworzy osobny katalog:

```text
reports/<UTC-run-id>-<random-id>/
  results.json
  report.md
  baseline.png
  http-500.png                # albo http-500-failure.png
  http-429.png
  slow-loading.png
  slow.png
  network.png
  empty.png
```

Zrzuty powstają dla wykonanych scenariuszy; przy awarii uruchomienia przeglądarki lub zamknięciu kontekstu z powodu limitu czasu zrzut może być niedostępny. Raport nie ukrywa takiego błędu. `slow-loading.png` jest dodatkowym dowodem pomocniczym; asercja w trakcie opóźnienia jest właściwym sprawdzeniem.

JSON jest zapisywany atomowo na końcu i zawiera wyniki asercji, statusy, liczniki przechwyceń, czasy i względne nazwy plików. Markdown oddziela obserwacje od sugestii diagnostycznych. Możesz przekazać go Codexowi przy naprawie swojej aplikacji. Nie zawiera zgadywanej „udowodnionej przyczyny”.

Raport v0.2 dodaje nazwę uruchomienia, `observedRequests` (zdarzenia przeglądarki), `interceptedRequests` (wywołania route handlera), `faultedRequests` (ukończone symulacje), bezpieczne metadane odpowiedzi, `steps`, `failedStep` i `code`. Każdy wykonany krok ma obserwację i zrzut `http-500-step-010.png` itp. Kroki po niepowodzeniu mają status **SKIPPED** — nie są zaliczane ani przedstawiane jako zweryfikowane. Nieznanych liczników starych raportów nie zastępujemy zerami.

Wyniki wcześniejszych nieudanych uruchomień pozostają w historii. Panel pokazuje także ERROR; nie zastępuje ich fikcyjnymi sukcesami.

## Własny test

Edytuj `faultlane.config.ts` albo utwórz własny lokalny plik TypeScript:

```ts
import { defineConfig } from "./src/runner/config";

export default defineConfig({
  baseUrl: "http://127.0.0.1:3000",
  pagePath: "/orders",
  api: { pathname: "/api/orders", method: "GET" },
  reportsDir: "reports",
  baseline: {
    assertions: [{ testId: "orders", state: "visible" }],
  },
  scenarios: [{
    id: "http-500",
    assertions: [
      { testId: "orders-error", state: "visible" },
      { testId: "retry", state: "visible" },
      { testId: "loading", state: "hidden" },
    ],
  }],
  timeouts: {
    navigationMs: 20000,
    requestMs: 10000,
    assertionMs: 4000,
    scenarioMs: 45000,
  },
  maskTestIds: ["private-account"],
});
```

Dodaj odpowiednie `data-testid` w aplikacji albo użyj `locator` po roli i nazwie dostępnej lub etykiecie. Dostępne asercje: `visible`, `hidden`, `text` (widoczność i zawieranie tekstu), `textAbsent` (brak dopasowanego tekstu w DOM) oraz `count`. Każdy zestaw wymaga przynajmniej jednej pozytywnej asercji. Scenariusz `slow` dodatkowo wymaga `duringDelay` i przyjmuje `delayMs` w zakresie 500–10000 ms.

Wzorzec API porównuje **pathname w originie `baseUrl`**, ignoruje query string i dopuszcza `*` jako dowolny ciąg znaków, także zawierający `/`. Rejestracja interceptora i obserwacji następuje przed nawigacją. Przechwytywane są wszystkie pasujące żądania GET; komponenty React w trybie developerskim mogą wykonać więcej niż jedno żądanie przy montowaniu. Recovery najlepiej uruchamiać jawnym kliknięciem ze stanu idle.

```sh
npm run faultlane -- run --config faultlane.custom.config.ts
npm run faultlane -- run --scenario http-500
npm run faultlane -- run --scenario baseline
npm run faultlane -- --help
```

Wybór jednego scenariusza awarii **nadal uruchamia baseline**. Brak scenariusza w konfiguracji albo literówka powodują błąd, a nie pusty sukces. Ścieżki konfiguracji i raportów są względne wobec bieżącego katalogu roboczego. Własny plik może wskazać ten sam `reportsDir`, aby jego wyniki pojawiły się w panelu.

Konfiguracja TypeScript jest wykonywalnym kodem lokalnym: uruchamiaj tylko zaufane pliki. Walidacja Zod nie jest piaskownicą dla kodu konfiguracyjnego.

## Kroki i recovery we własnej aplikacji

Poniższy przykład działa również z drugą lokalną aplikacją Next.js/React. Uruchom ją np. na porcie 3001; endpoint musi być wywoływany przez przeglądarkę. Dodaj dostępne nazwy przycisków i wskazane test IDs, a następnie zapisz w katalogu FaultLane plik `faultlane.orders.config.ts`:

```ts
import { defineConfig } from "./src/runner/config";

export default defineConfig({
  name: "Orders · recovery",
  baseUrl: "http://127.0.0.1:3001",
  pagePath: "/orders",
  api: { pathname: "/api/orders", method: "GET" },
  maxRequests: 2,
  actions: [
    { type: "fill", locator: { by: "label", value: "Customer" }, value: "Example" },
    { type: "click", locator: { by: "role", role: "button", name: "Load orders" } },
    { type: "waitForRequest", request: { pathname: "/api/orders", method: "GET" }, occurrence: 1 },
  ],
  baseline: { assertions: [{ testId: "orders", state: "visible" }] },
  scenarios: [{
    id: "http-500",
    affectRequests: 1,
    assertions: [
      { testId: "orders-error", state: "visible" },
      { locator: { by: "role", role: "button", name: "Retry" }, state: "visible" },
    ],
    recovery: {
      actions: [{ type: "click", locator: { by: "role", role: "button", name: "Retry" } }],
      assertions: [
        { testId: "orders-error", state: "hidden" },
        { testId: "orders", state: "visible" },
        { testId: "loading", state: "hidden" },
      ],
    },
  }],
});
```

```sh
npm run faultlane -- run --config faultlane.orders.config.ts
```

`actions` uruchamiają się po wejściu na `pagePath`; są wspólne dla baseline i awarii. Można je zastąpić przez `baseline.actions` lub `scenarios[n].actions`. Lista zastępuje całość, nie dopisuje się do odziedziczonych kroków. `affectRequests: 1` zmienia tylko pierwszy request; następny jest przekazywany do prawdziwego lokalnego API. `recovery.actions` musi zaczynać się jednym kliknięciem; potem dozwolone są asercje i oczekiwania. Runner sprawdza nowe żądanie i jego status 2xx jeszcze przed asercjami sukcesu. `maxRequests` ogranicza łączną liczbę żądań (domyślnie 20, maksymalnie 30).

Wszystkie pola, rodzaje kroków, limity czasu i kody błędów: [docs/scenarios.md](docs/scenarios.md). Nie ma `eval`, stringów JavaScript ani wykonywania kodu dostarczonego jako krok.

## Niezależny przykład bez Next.js

Druga dołączona aplikacja ma własny serwer Node HTTP, inny HTML i selektory. Nie wymaga nowych zależności.

```sh
# Terminal 1: aplikacja Cedar na porcie 3100
npm run fixture:start
# Terminal 2: baseline i pełne recovery
npm run fixture:test
```

Otwórz [Cedar inventory](http://127.0.0.1:3100/catalog). Konfiguracja `faultlane.catalog.config.ts` korzysta z `getByLabel` i `getByRole`, wypełnia kategorię i klika Search inventory / Try again. Nie używa identyfikatorów demo FaultLane. Raporty trafiają do tego samego katalogu; panel FaultLane wymaga osobno działającego `npm run dev`.

## Testy automatyczne

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run test:journeys
npm run build
npm run build:cli
npm pack --dry-run
npm run test:package
# albo pełna weryfikacja, łącznie z buildami i instalacją paczki:
npm run verify
```

Testy E2E uruchamiają lokalny serwer, jeśli nie działa na porcie 3000. Weryfikują także sześć oryginalnych scenariuszy v0.1. Nowe testy badają wszystkie kroki, recovery, trzy defekty demo przez osobne procesy CLI, drugi serwer na losowym porcie loopback, brak requestu, pozorne odzyskanie UI, brak Retry, przedwczesne/podwójne ponowienie i HTTP 503 po Retry. Testy CLI celowych defektów tworzą prawdziwe raporty w `reports/`; pozostałe artefakty trafiają do `test-results/`. Vitest bada konfigurację, symulacje, liczniki i limity żądań, selekcję scenariuszy, kompatybilność raportów i ochronę ścieżek, w tym dowiązania/junction na Windows.

## Ograniczenia MVP

- **Przechwytywanie żądań przeglądarki przez Playwright nie obejmuje automatycznie wywołań API wykonywanych wewnętrznie przez kod serwerowy Next.js.** Dotyczy to m.in. Server Components i Server Actions.
- To kontrola wybranych stanów UI, nie dowód pełnej odporności dowolnej aplikacji.
- Tylko Chromium, adresy HTTP(S) `localhost`/loopback i API GET w testowanym originie. Dostępne są deklaratywne kroki, ale brak logowania, zapisanego profilu, dowolnego JavaScript, testów POST, chmury i zewnętrznych celów.
- Przekierowania HTTP są odrzucane; podaj bezpośredni końcowy URL. Service Workers są blokowane. Zewnętrzne zasoby i metody inne niż GET/HEAD są blokowane. Lokalne WebSockety są przepuszczane dla developerskiego HMR, ale nie są testowane jako API.
- Lokalny backend może sam komunikować się z innymi usługami. Runner nie kontroluje kodu serwera ani baz danych. Używaj odizolowanej aplikacji developerskiej i danych syntetycznych.
- Zrzuty mogą zawierać widoczne dane strony. Pola haseł, elementy z `data-faultlane-private` i `maskTestIds` są maskowane. Nie zapisujemy cookies, nagłówków autoryzacji, treści żądań ani surowych wyjątków; query string URL strony jest usuwany z raportu.
- Brak auto-odświeżania i retencji raportów; usuń niepotrzebne katalogi ręcznie. Panel jest lokalny, bez uwierzytelniania — nie wystawiaj go jako publicznej usługi.

Szczegóły: [architektura](docs/architecture.md), [scenariusze](docs/scenarios.md), [ograniczenia](docs/limitations.md).

Recovery potwierdza kolejność i liczbę requestów w czasie scenariusza; nie dowodzi przyczynowości wobec dowolnego ukrytego timera aplikacji. Żądanie przed Retry jest błędem, a dodatkowe retry jest blokowane. Po zamknięciu kontekstu runner nie obserwuje dalszego zachowania aplikacji.

Audyt wcześniejszego etapu: [docs/audit-v0.2.md](docs/audit-v0.2.md). Wdrożenie zewnętrzne: [docs/getting-started.md](docs/getting-started.md). Następny etap może dodać jawne retry/backoff i wiele endpointów w jednym kontrakcie, zachowując lokalny charakter narzędzia.
