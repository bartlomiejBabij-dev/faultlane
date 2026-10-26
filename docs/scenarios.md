# Scenariusze i oczekiwania

MVP zawiera dokładnie pięć typów awarii i baseline. Można skonfigurować podzbiór awarii, ale baseline jest obowiązkowy i uruchamia się jako pierwszy, również z `--scenario`.

| ID | Mechanizm | Domyślny kontrakt UI |
| --- | --- | --- |
| `baseline` | Prawdziwa odpowiedź lokalnego API | Widoczny Atlas API, dokładnie 3 projekty, brak error/loading |
| `http-500` | `route.fulfill`, status 500, JSON | Komunikat błędu serwera, Retry, loading ukryty |
| `http-429` | `route.fulfill`, 429, JSON, Retry-After | Komunikat limitu, Retry, loading ukryty |
| `slow` | Opóźnienie przed pobraniem prawdziwej odpowiedzi | Loading widoczny jeszcze podczas opóźnienia, następnie dane i brak error/loading |
| `network` | `route.abort("failed")` | Komunikat utraty połączenia, Retry, loading ukryty |
| `empty` | `route.fulfill`, 200, dokładnie `[]` | Pusty stan, brak error/loading |

`delayMs` ma zakres 500–10000 ms, a `retryAfterSeconds` 1–300. Bez `affectRequests` wszystkie pasujące żądania w danym kontekście otrzymują ten sam rodzaj awarii, jak w v0.1. `affectRequests: N` (1–10) ogranicza awarię do pierwszych N requestów; pozostałe idą do prawdziwego lokalnego API. Osobny test E2E v0.1 nadal sprawdza odzyskanie danych po usunięciu przechwycenia HTTP 500.

## Asercje

Asercja przyjmuje dokładnie jedno `testId` (zgodność v0.1) albo `locator`. `visible` sprawdza widoczność, `hidden` ukrycie lub nieobecność, `text` widoczność i zawieranie tekstu, `textAbsent` brak elementu zawierającego wskazany tekst w DOM, a `count` dokładną liczbę elementów. Samo ukrycie tekstu pozostającego w DOM nie spełnia `textAbsent` dla lokatora testId. `count` nie dowodzi widoczności; jeśli to istotne, dodaj osobną asercję. `visible`, `hidden` i `text` wymagają jednoznacznego lokatora.

Konfiguracja bez asercji lub zawierająca wyłącznie negatywne oczekiwania jest odrzucana. Asercje końcowe startują po wykonaniu symulacji. Brak przechwycenia to ERROR nawet wtedy, kiedy widoczna strona wygląda poprawnie. Brak dowodu ładowania przed końcem opóźnienia to FAIL, nawet jeśli później dane się pojawiły.

## Celowy defekt

`faultlane.broken.config.ts` zmienia wyłącznie ścieżkę na `/demo?broken=http-500` i wybiera scenariusz 500. Demo zachowuje komunikat błędu oraz Retry, ale pozostawia spinner. W ten sposób narzędzie musi odróżnić częściowo poprawną obsługę błędu od spełnienia całego kontraktu. Test E2E uruchamia osobny proces CLI, sprawdza kod 1, parsuje JSON i sprawdza istnienie zrzutu błędu.

## Pola konfiguracji v0.2

| Pole | Znaczenie |
| --- | --- |
| `name` | Nazwa uruchomienia w JSON, Markdown i panelu |
| `baseUrl` | HTTP(S) origin loopback; bez ścieżki, query i danych logowania |
| `pagePath` | Początkowa ścieżka względna od `/`; query dozwolone, ale usuwane z raportu |
| `api.pathname` | Wzorzec pathname GET w originie baseUrl; `*` dopasowuje dowolny ciąg, query jest pomijane |
| `actions` | Wspólne akcje po początkowej nawigacji, maks. 30 |
| `baseline.actions`, `scenarios[n].actions` | Opcjonalne zastąpienie całej wspólnej listy akcji |
| `scenarios[n].name` | Czytelna nazwa konkretnego testu |
| `scenarios[n].id` | Jedna z pięciu dotychczasowych awarii, bez duplikatów |
| `scenarios[n].affectRequests` | Liczba requestów z awarią (1–10); wymagane przy recovery |
| `scenarios[n].assertions` | Oczekiwania po awarii; wszystkie muszą być spełnione przed recovery |
| `scenarios[n].recovery.actions` | Jeden początkowy click, opcjonalnie potem wyłącznie assert/waitForElement/waitForRequest |
| `scenarios[n].recovery.assertions` | Oczekiwania po nowym rzeczywistym requestcie zakończonym statusem 2xx |
| `maxRequests` | Globalny limit pasujących requestów na scenariusz, domyślnie 20, zakres 2–30 |
| `timeouts.navigationMs` | Limit nawigacji, domyślnie 20000, zakres 500–60000 |
| `timeouts.requestMs` | Limit oczekiwania na request/odpowiedź, domyślnie 10000, zakres 500–30000 |
| `timeouts.assertionMs` | Domyślny limit UI i akcji, 4000, zakres 100–15000 |
| `timeouts.scenarioMs` | Budżet wykonania scenariusza, domyślnie 45000, zakres 2000–120000; końcowy zapis dowodu ma dodatkowy limit 5000 |
| `reportsDir`, `maskTestIds` | Istniejący katalog raportów i maskowanie danych w screenshotach |

## Lokatory i kroki

```ts
{ by: "role", role: "button", name: "Retry" }
{ by: "label", value: "Category" }
{ by: "testId", value: "projects" }
```

Nazwa roli i etykieta są dopasowywane dokładnie, bez regexów. Click po roli wymaga nazwy. Schemat zawiera jawny zestaw typowych ról ARIA; CSS/XPath i dowolny JavaScript nie są obsługiwane. Dla alertów w Next.js nadaj nazwę dostępną (np. `aria-label="Project error"`), aby nie dopasować dodatkowego announcera frameworka.

| `type` | Pozostałe pola | Działanie |
| --- | --- | --- |
| `navigate` | `path` | Otwiera ścieżkę w skonfigurowanym originie loopback |
| `click` | `locator` | Playwright click z automatycznym oczekiwaniem na gotowość elementu |
| `fill` | `locator`, `value` | Wypełnia pole; wartość nie jest wpisywana do tekstu raportu |
| `waitForElement` | `locator`, `state: "visible" / "hidden"` | Czeka na oczekiwany stan (domyślnie visible) |
| `waitForRequest` | `request: {pathname, method: "GET"}`, `occurrence` | Czeka na N-te wystąpienie od początku scenariusza (domyślnie 1) |
| `assert` | `assertion` | Wykonuje pojedyncze oczekiwanie visible/hidden/text/textAbsent/count |

Każdy krok może mieć `timeoutMs` w zakresie 100–30000. Brak fixed sleep. Obserwator requestów jest rejestrowany przed nawigacją, więc `waitForRequest` **może zaliczyć request, który już wystąpił**. Dla Retry użyj occurrence 2, nie ponownie 1. Mechanizm recovery niezależnie wymaga nowego requestu po jego kliknięciu.

## Recovery: warunki zaliczenia

Przykład działający: `faultlane.recovery.config.ts`. Z baseline w świeżym kontekście pobierane są prawdziwe dane. Scenariusz 500 uruchamia Load Projects, wymusza pierwszą awarię, sprawdza błąd i Retry, klika Retry, weryfikuje request #2 z prawdziwym statusem 200 oraz brak błędu i loading i widoczność danych.

Request pojawiający się **przed** recovery click ponad `affectRequests` jest błędem. Recovery musi wywołać dokładnie jeden nowy pasujący request. Dzięki temu auto-retry przed kliknięciem, podwójny handler i sam sukces wizualny nie są zaliczane. Nie gwarantujemy wykrycia requestów zaplanowanych już po zakończeniu scenariusza.

Konfiguracja `faultlane.recovery-broken.config.ts` przyjmuje jawny `FAULTLANE_DEMO_BUG`: `retry-no-request`, `recovery-error`, `recovery-loading`. Trzy testy E2E uruchamiają rzeczywisty CLI, wymagają kodu 1, FAIL, przyczyny, numeru kroku i PNG. Niezależny przykład `faultlane.catalog.config.ts` dodatkowo używa fill/navigate i innych lokatorów.

## Statusy i kody diagnostyczne

| Status / kod | Obserwacja |
| --- | --- |
| FAIL / ASSERTION_FAILED | UI nie spełniło oczekiwania; komunikat może wskazać niejednoznaczność lokatora |
| FAIL / ACTION_EXPECTATION_FAILED | Wymagany element nie pozwolił wykonać click/fill/wait |
| FAIL / RETRY_NO_REQUEST | Po poprawnie zasymulowanej awarii kliknięto Retry, ale nie zaobserwowano nowego requestu |
| FAIL / REQUEST_BEFORE_RETRY | Dodatkowe API przed jawną akcją odzyskania |
| FAIL / UNEXPECTED_RETRY_COUNT, REQUEST_LIMIT_EXCEEDED | Więcej żądań niż dopuszcza kontrakt/limit; nadmiar zablokowany |
| FAIL / RECOVERY_HTTP_STATUS | Request recovery wystąpił, ale rzeczywista odpowiedź nie miała statusu 2xx |
| FAIL / PAGE_JAVASCRIPT_ERROR | Zaobserwowano nieobsłużony wyjątek JS; treść nie jest zapisana |
| ERROR / API_NOT_OBSERVED | Brak początkowego pokrycia requestu; sprawdź origin, pathname i trigger |
| ERROR / API_REQUEST_TIMEOUT, ROUTE_EXECUTION | Odpowiedź nie zakończyła się w budżecie lub routing nie mógł działać bezpiecznie |
| ERROR / BROWSER_LAUNCH, BROWSER_EXECUTION, BROWSER_CLOSED | Problem uruchomienia/życia przeglądarki |
| ERROR / NAVIGATION_FAILED, UNSAFE_TARGET | Niedostępna strona albo niedozwolony cel |
| ERROR / SCENARIO_TIMEOUT, EVIDENCE_WRITE | Przekroczony budżet lub brak wymaganego dowodu |

Wynik kroku SKIPPED oznacza niewykonanie po wcześniejszym problemie i nigdy nie jest dowodem PASS. FAIL/ERROR zatrzymuje resztę danego scenariusza; kolejny scenariusz dostaje świeży kontekst. Raport opisuje **obserwację** oraz sugestię sprawdzenia, nie udowodnioną przyczynę błędu.
