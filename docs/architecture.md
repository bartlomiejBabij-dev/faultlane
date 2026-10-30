# Architektura

## Dowody i porównanie

Zrzut jest pobierany przed zamknięciem kontekstu, zapisywany do unikalnego pliku tymczasowego, sprawdzany i atomowo publikowany przez hard link bez nadpisania istniejącego pliku. Serializacja JSON i Markdown odbywa się w osobnym, współdzielonym wątku. Raporty są publikowane osobno; `.faultlane-report-pending` blokuje ich odczyt przez panel i `compare`, dopóki oba pliki nie zostały zapisane i sprawdzone. Wymagany jest lokalny system plików obsługujący hard linki. Po błędach runner próbuje usunąć własny plik tymczasowy; awaria usuwania może go pozostawić. Nie ma ukrytego ponawiania. Zapis nie stanowi transakcji obejmującej oba pliki ani gwarancji przeżycia utraty zasilania.

Wynik scenariusza i `evidence` są osobne. Błąd UI wraz z błędem zrzutu zachowuje FAIL i szczegóły dowodu; proces zwraca 2. Diagnostyka zawiera etap i ograniczony kod, bez surowych wyjątków aplikacji, ścieżek, nagłówków i stosów. Porównanie bazuje na skrócie pełnej istotnej konfiguracji scenariusza, nie na nazwie. Raporty bez skrótu nie są automatycznie uznawane za równoważne. Szczegóły: [porównanie](regression-comparison.md) i [CI](ci-integration.md).

FaultLane jest pojedynczym projektem npm, ale runner nie zależy od procesu Next.js. CLI może testować inną lokalną aplikację, jeśli spełnia ograniczenia opisane w konfiguracji.

## Dystrybucja CLI

`package.json.bin` wskazuje `dist/cli.js` z shebang Node. `build:cli` używa esbuild do kompilacji własnego kodu i TypeScript do deklaracji typów. Runtime zależy od `@playwright/test`, `tsx` i `zod`; Next.js/React są zależnościami developerskimi panelu i przykładu. Pole `files` ogranicza tarball do `dist`, dokumentacji i README. `prepack` buduje dystrybucję. `private: true` chroni przed przypadkową publikacją; brak monorepo i instalacyjnego pobierania Chromium.

Publiczne `faultlane/config` eksportuje `defineConfig`, typ wejściowy i schemat. Kreator generuje obiekt `satisfies FaultLaneConfigInput` z importem typu usuwanym w runtime, więc globalny link działa bez runtime importu z aplikacji. Edytor potrzebuje lokalnego pakietu/linku do rozpoznania typów. `load-config.ts` używa `tsx/esm/api` i obsługuje ESM oraz CommonJS. Zod waliduje wynik po wykonaniu zaufanej konfiguracji; nie jest to sandbox.

`cli-args.ts` waliduje komendy i flagi przez `parseArgs` oraz Zod. `init.ts` współdzieli schemat kreatora i `--yes`, serializuje dane przez JSON i chroni stare pliki, tworząc kopię wyłącznie po jawnym wyborze. `project.ts` czyta tylko ograniczony rozmiarem `package.json`, wykrywa zależności i nazwy skryptów, nie wykonuje ich ani nie czyta `.env`.

`doctor.ts` sprawdza Node, konfigurację, moduł Playwright, rzeczywiste uruchomienie Chromium, lokalny origin/stronę (GET, brak redirectów, timeout 5 s) i uprawnienia katalogu bez zapisu. Nie wywołuje API ani nie dowodzi poprawnego UI. `browsers install` jest osobną jawną komendą; uruchamia instalator Playwright przez `spawn` ze stałymi argumentami, bez powłoki.

`paths.ts` rozwiązuje `reportsDir` względem katalogu wywołania, odrzuca względne wyjście poza projekt, ścieżki sieciowe i symlinki/junction w wyjściu. Absolutny lokalny katalog jest jawnym wyborem użytkownika zachowanym z v0.2. System plików i konfiguracja pozostają zaufane; ochrona nie obejmuje złośliwego procesu równolegle podmieniającego katalogi. Odczyt raportów w panelu nadal ma osobne kontrole `report-store.ts`.

`scripts/test-package.ts` oraz `scripts/package-compatibility.ts` sprawdzają zawartość tarballa i naprawdę instalują go przez npm w trzech świeżych projektach poza źródłami: Next.js, katalog HTTP oraz React/Vite. Testują publiczne komendy, rzeczywiste defekty i problemy konfiguracji kodami 0/1/2. Raporty pozostają do wglądu; położenie zapisuje `.package-tests/latest.json`. Test nie pobiera Chromium i nie publikuje paczki. Instrukcja: [getting-started.md](getting-started.md).

## Dwie zgodne ścieżki wykonania

Konfiguracja zawiera albo dotychczasowe `api`, albo nowe `endpoints`. Stare konfiguracje nadal korzystają z `RequestTracker` i ścisłego recovery opartego na kliknięciu oraz nowym lokalnym 2xx. Poniższe sekcje historycznego cyklu `api` opisują ten zachowany kontrakt.

Tryb `endpoints` używa `browser-network.ts`, `endpoint-schema.ts`, `network-policy.ts` i `network-tracker.ts`. Każdy endpoint ma niezależny matcher origin/metoda/ścieżka/query, sekwencję, licznik i limit. Konflikty matcherów są odrzucane przed uruchomieniem Chromium; kolejność definicji nie rozstrzyga konfliktów. Numer requestu jest rezerwowany synchronicznie, a zakończenie przypisane do tego numeru nawet przy współbieżnych odpowiedziach.

`network.mockOrigins` uprawnia wyłącznie do przechwytywania. W kodzie nie ma zdalnego forward API: schemat pozwala na prawdziwy GET/HEAD tylko do originu aplikacji lub jawnego `localOrigins`. Niedopasowane fetch/XHR są blokowane, również same-origin. Zasoby aplikacji pozostają dostępne lokalnie; dodatkowe zasoby wymagają reguły origin/ścieżka/resourceType. Ich pobieranie odbywa się bez cookies i nagłówków autoryzacji przeglądarki, bez przekierowań, z limitem czasu i 8 MB.

Sekwencja musi zostać wykonana w całości, z dokładną liczbą rzeczywistych requestów. Końcowy mock jest odróżniony od prawdziwego lokalnego 2xx. `sequenceRecovery` pozwala sprawdzić stan awarii, wykonać akcje i sprawdzić odzyskanie; automatyczne ponowienia mogą zakończyć całą sekwencję przed końcowymi asercjami, bez wymagania Retry. FaultLane nie dodaje logiki retry do aplikacji.

Wyniki endpointów zapisują `schemaVersion: 3`; legacy nadal zapisuje 2. Czytnik obsługuje 1/2/3 bez migracji. `network-redaction.ts` usuwa wszystkie wartości query, fragmenty i userinfo; struktury dowodów nie zawierają bodies, cookies ani headers. Przechowywane jest maksymalnie 200 zdarzeń sieci i 31 rekordów na endpoint, lecz liczniki v3 uwzględniają także późniejsze próby. Brak przechwycenia to ERROR, niepełna wymagana sekwencja po zaobserwowanej awarii lub błędne UI to FAIL. Niezadeklarowana zablokowana zależność może uniemożliwić wiarygodny test i daje ERROR.

`init-advanced.ts` zbiera jawne dane w kreatorze albo czyta wybrany lokalny JSON z limitem 1 MB. Oba warianty używają rzeczywistego schematu runnera i tej samej ochrony plików konfiguracji. `doctor` waliduje konflikty, sekwencje, oczekiwania i uprawnienia bez wysyłania żądań do API. Pełny kontrakt oraz przykłady: [real-world-compatibility.md](real-world-compatibility.md).

v0.2 rozszerza istniejące moduły, bez dodawania usług ani zależności. Dotychczasowy cykl baseline + pięć awarii pozostaje; każdy scenariusz może teraz mieć uporządkowane akcje i fazę recovery.

```text
faultlane.config.ts → Zod → CLI → Chromium
                                  ├─ baseline: świeży BrowserContext
                                  ├─ http-500: świeży BrowserContext
                                  ├─ http-429: świeży BrowserContext
                                  ├─ slow: świeży BrowserContext
                                  ├─ network: świeży BrowserContext
                                  └─ empty: świeży BrowserContext
                                         ↓
                               asercje + screenshoty
                                         ↓
                               report.md + results.json
                                         ↓
                           bezpieczny odczyt → /results
```

## Moduły

| Plik/katalog | Odpowiedzialność |
| --- | --- |
| `src/runner/config.ts` | Schemat Zod, loopback, wzorce API, wybór scenariuszy |
| `src/runner/journey-schema.ts` | Walidowane lokatory, akcje, oczekiwania i kontrakt recovery |
| `src/runner/locators.ts` | getByRole / getByLabel / getByTestId i czytelne opisy |
| `src/runner/actions.ts` | Nawigacja lokalna, click, fill, oczekiwania i asercje kroków |
| `src/runner/steps.ts` | Kolejność kroków, fail-fast, SKIPPED i screenshot po kroku |
| `src/runner/requests.ts` | Oddzielne liczniki zdarzeń i interceptów, ordinal, limit i bramka Retry |
| `src/runner/errors.ts` | Kontrolowany status FAIL/ERROR i kod diagnostyczny |
| `src/runner/load-config.ts` | Import zaufanej lokalnej konfiguracji TypeScript |
| `src/runner/cli.ts` | Argumenty, wyjście tekstowe i kody procesu |
| `src/runner/scenarios.ts` | Odpowiedzi 500/429/[], abort, opóźnienie i bezpieczne forwarding |
| `src/runner/browser.ts` | Cykl kontekstu, przechwycenia, limity, zrzuty, wykonanie |
| `src/runner/assertions.ts` | `expect` Playwright i bezpieczne opisy obserwacji |
| `src/runner/results.ts` | Typy i schemat wyników, zliczanie i kody |
| `src/runner/report.ts` | Markdown i atomowy zapis JSON |
| `src/lib/report-store.ts` | Walidacja odczytu, allowlista nazw, realpath i limity rozmiaru |
| `src/app/demo` | Browser fetch i jawne stany UI |
| `src/app/api/demo/projects` | Deterministyczne dane syntetyczne |
| `src/app/results` | Panel serwerowy odczytujący istniejące wyniki |
| `src/app/api/reports` | Kontrolowane udostępnianie raportów i PNG |
| `examples/catalog` | Niezależna aplikacja HTTP z innymi lokatorami, bez Next.js |

## Cykl scenariusza legacy `api`

Kontekst nie dziedziczy cookies, localStorage ani service workerów. Routing jest rejestrowany przed otwarciem strony. Każde żądanie jest sprawdzane pod kątem adresu i metody. Przekierowania są odrzucane, ponieważ przeglądarka może obsłużyć kolejne ogniwo bez ponownego wywołania route handlera. Przepuszczane odpowiedzi korzystają z `route.fetch({maxRedirects: 0})` i `route.fulfill({response})`.

Runner czeka na rzeczywiste przechwycenie i zakończenie symulacji. Dla `slow` sprawdza osobno asercje podczas opóźnienia oraz po odpowiedzi. Opóźnienie jest jedynym celowym timerem symulacji; oczekiwania UI korzystają z asercji/pollingu Playwright. Timeout scenariusza zamyka kontekst, a timer opóźnienia otrzymuje AbortSignal.

W v0.2 plan kroków jest budowany przed nawigacją. Rejestr zdarzeń request działa od początku, zlicza tylko skonfigurowane wzorce i nie przechowuje URL z query ani body/headers. Dzięki temu `waitForRequest` nie ma wyścigu przy szybkim requestcie pomiędzy click i wait. Interceptor rezerwuje numer żądania synchronicznie przed operacją async. Completion jest przypisany do konkretnego numeru, a nie do dowolnej pierwszej odpowiedzi.

## Recovery i statusy legacy `api`

1. Nawigacja → odziedziczone lub lokalne akcje → obserwacja API.
2. Pierwsze `affectRequests` żądań otrzymuje awarię. Wszystkie wymagane odpowiedzi muszą się zakończyć.
3. Wszystkie asercje błędu muszą przejść. Brak Retry lub błędny UI to FAIL.
4. Tuż przed recovery click tracker sprawdza liczbę zakończonych faultów i otwiera fazę recovery. Request ponad oczekiwany limit jeszcze przed Retry to FAIL, nie dowód odzyskania.
5. Kliknięcie musi spowodować dokładnie jedno nowe pasujące żądanie. Brak tego requestu to FAIL / RETRY_NO_REQUEST. Odpowiedź pochodzi z prawdziwego lokalnego API i musi mieć status 2xx.
6. Następują asercje stanu odzyskanego. FAIL zatrzymuje wykonywanie; dalsze kroki pozostają SKIPPED. PASS wymaga spełnienia całego planu i zapisu dowodów.

Tracker ogranicza liczbę rekordów do `maxRequests + 1`; ostatni rekord dowodzi przekroczenia. Kolejne pasujące żądania są abortowane, a liczniki pozostają nasycone. Kontrola obejmuje także requesty przychodzące podczas końcowego screenshotu. Nie obserwujemy zdarzeń po zamknięciu kontekstu i nie dowodzimy przyczynowości wobec arbitralnych timerów aplikacji.

Pierwszy niezaobserwowany request to ERROR / API_NOT_OBSERVED (problem coverage/config). Brak nowego requestu po zweryfikowanej awarii i wykonanym Retry to FAIL (niespełnione zachowanie aplikacji). Problemy przeglądarki/nawigacji/routingu/limitu czasu to ERROR. Kod i bezpieczny komunikat trafiają do kroku i scenariusza, bez surowego wyjątku Playwright.

Wspierana wersja Chromium otrzymuje uprawnienie `local-network-access` tylko dla testowanego originu. Lokalne WebSockety są dozwolone ze względu na HMR Next.js. Nie są objęte scenariuszami awarii.

`results.json` jest końcowym znacznikiem ukończenia. Panel nie wykonuje dowolnego pliku konfiguracyjnego dostarczonego przez HTTP: importuje własną konfigurację projektu. Parametry route służą wyłącznie do wyboru identyfikatora uruchomienia i dozwolonej nazwy artefaktu. Realpath zabezpiecza przed typowym wyjściem poza katalog przez dowiązania. Lokalny system plików pozostaje zaufany; nie jest to sandbox dla złośliwego procesu równolegle zmieniającego pliki.

Zapis legacy używa `schemaVersion: 2`; endpointy używają 3. Wspólny czytnik nadal waliduje raporty v1. Brak danych w historycznym raporcie jest pokazany jako „not recorded”, nie jako zero. Panel oddziela najnowszy ukończony run od agregatów wcześniejszych uruchomień. Nie ma migracji, retencji ani edycji starych wyników.

## Źródła API

- [Routing i sieć Playwright](https://playwright.dev/docs/network)
- [Lokatory Playwright](https://playwright.dev/docs/locators)
- [Route: fulfill, abort, fetch i limity przekierowań](https://playwright.dev/docs/api/class-route)
- [Uprawnienia BrowserContext](https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions)
- [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation)
- [Tailwind CSS dla Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
