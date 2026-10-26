# FaultLane

**Find failures before users do.** Lokalne narzędzie do sprawdzania, jak interfejs aplikacji reaguje na awarie API. Uruchamia prawdziwe Chromium, przechwytuje żądanie z przeglądarki, wykonuje jawne asercje Playwright i zapisuje raport wraz ze zrzutami ekranu.

To działające MVP: brak kont, chmury, płatnych API i automatycznego skanowania. Panel pokazuje wyłącznie wyniki odczytane z dysku.

## Szybki start

Wymagania: Node.js **22.13+** (zalecane 24 LTS), npm, system obsługiwany przez Playwright. Wszystkie komendy uruchamiaj w katalogu projektu. Nie potrzebujesz `.env` ani żadnego klucza API.

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

Dodaj odpowiednie `data-testid` w aplikacji. Dostępne asercje: `visible`, `hidden`, `text` (widoczność i zawieranie tekstu) oraz `count`. Każdy zestaw wymaga przynajmniej jednej pozytywnej asercji. Scenariusz `slow` dodatkowo wymaga `duringDelay` i przyjmuje `delayMs` w zakresie 500–10000 ms.

Wzorzec API porównuje **pathname**, ignoruje query string i dopuszcza `*` jako dowolny ciąg znaków, także zawierający `/`. Rejestracja interceptora następuje przed nawigacją. Przechwytywane są wszystkie pasujące żądania GET; komponenty React w trybie developerskim mogą wykonać więcej niż jedno żądanie.

```sh
npm run faultlane -- run --config faultlane.custom.config.ts
npm run faultlane -- run --scenario http-500
npm run faultlane -- run --scenario baseline
npm run faultlane -- --help
```

Wybór jednego scenariusza awarii **nadal uruchamia baseline**. Brak scenariusza w konfiguracji albo literówka powodują błąd, a nie pusty sukces. Ścieżki konfiguracji i raportów są względne wobec bieżącego katalogu roboczego. Własny plik może wskazać ten sam `reportsDir`, aby jego wyniki pojawiły się w panelu.

Konfiguracja TypeScript jest wykonywalnym kodem lokalnym: uruchamiaj tylko zaufane pliki. Walidacja Zod nie jest piaskownicą dla kodu konfiguracyjnego.

## Testy automatyczne

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
# albo wszystkie powyższe:
npm run verify
```

Testy E2E uruchamiają lokalny serwer, jeśli nie działa na porcie 3000. Weryfikują sześć scenariuszy, Retry, rzeczywiste FAIL, brak przechwycenia, kody CLI, zapis dowodów i panel mobilny. Test CLI celowo zepsutego demo tworzy prawdziwy raport w `reports/`; pozostałe artefakty testowe trafiają do `test-results/`. Vitest bada konfigurację, symulacje, selekcję scenariuszy, logikę wyników, raporty i ochronę ścieżek, w tym dowiązania/junction na Windows.

## Ograniczenia MVP

- **Przechwytywanie żądań przeglądarki przez Playwright nie obejmuje automatycznie wywołań API wykonywanych wewnętrznie przez kod serwerowy Next.js.** Dotyczy to m.in. Server Components i Server Actions.
- To kontrola wybranych stanów UI, nie dowód pełnej odporności dowolnej aplikacji.
- Tylko Chromium, adresy HTTP(S) `localhost`/loopback, API GET i żądanie wyzwalane otwarciem strony. Brak logowania, zapisanego profilu, skryptów kliknięć, testów POST, chmury i zewnętrznych celów.
- Przekierowania HTTP są odrzucane; podaj bezpośredni końcowy URL. Service Workers są blokowane. Zewnętrzne zasoby i metody inne niż GET/HEAD są blokowane. Lokalne WebSockety są przepuszczane dla developerskiego HMR, ale nie są testowane jako API.
- Lokalny backend może sam komunikować się z innymi usługami. Runner nie kontroluje kodu serwera ani baz danych. Używaj odizolowanej aplikacji developerskiej i danych syntetycznych.
- Zrzuty mogą zawierać widoczne dane strony. Pola haseł, elementy z `data-faultlane-private` i `maskTestIds` są maskowane. Nie zapisujemy cookies, nagłówków autoryzacji, treści żądań ani surowych wyjątków; query string URL strony jest usuwany z raportu.
- Brak auto-odświeżania i retencji raportów; usuń niepotrzebne katalogi ręcznie. Panel jest lokalny, bez uwierzytelniania — nie wystawiaj go jako publicznej usługi.

Szczegóły: [architektura](docs/architecture.md), [scenariusze](docs/scenarios.md), [ograniczenia](docs/limitations.md).

Następny sensowny etap: jawne, typowane kroki przed żądaniem (np. kliknięcie) oraz sprawdzanie, czy Retry prowadzi do odzyskania danych w ramach tego samego scenariusza.
