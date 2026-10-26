# Architektura

FaultLane jest pojedynczym projektem npm, ale runner nie zależy od procesu Next.js. CLI może testować inną lokalną aplikację, jeśli spełnia ograniczenia opisane w konfiguracji.

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

## Cykl scenariusza

Kontekst nie dziedziczy cookies, localStorage ani service workerów. Routing jest rejestrowany przed otwarciem strony. Każde żądanie jest sprawdzane pod kątem adresu i metody. Przekierowania są odrzucane, ponieważ przeglądarka może obsłużyć kolejne ogniwo bez ponownego wywołania route handlera. Przepuszczane odpowiedzi korzystają z `route.fetch({maxRedirects: 0})` i `route.fulfill({response})`.

Runner czeka na rzeczywiste przechwycenie i zakończenie symulacji. Dla `slow` sprawdza osobno asercje podczas opóźnienia oraz po odpowiedzi. Opóźnienie jest jedynym celowym timerem symulacji; oczekiwania UI korzystają z asercji/pollingu Playwright. Timeout scenariusza zamyka kontekst, a timer opóźnienia otrzymuje AbortSignal.

W v0.2 plan kroków jest budowany przed nawigacją. Rejestr zdarzeń request działa od początku, zlicza tylko skonfigurowane wzorce i nie przechowuje URL z query ani body/headers. Dzięki temu `waitForRequest` nie ma wyścigu przy szybkim requestcie pomiędzy click i wait. Interceptor rezerwuje numer żądania synchronicznie przed operacją async. Completion jest przypisany do konkretnego numeru, a nie do dowolnej pierwszej odpowiedzi.

## Recovery i statusy

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

Nowy zapis używa `schemaVersion: 2`; wspólny czytnik nadal waliduje raporty v1. Nowe pola są opcjonalne w odczycie: brak danych w historycznym raporcie jest pokazany jako „not recorded”, nie jako zero. Panel oddziela najnowszy ukończony run od agregatów wcześniejszych uruchomień. Nie ma migracji, retencji ani edycji starych wyników.

## Źródła API

- [Routing i sieć Playwright](https://playwright.dev/docs/network)
- [Lokatory Playwright](https://playwright.dev/docs/locators)
- [Route: fulfill, abort, fetch i limity przekierowań](https://playwright.dev/docs/api/class-route)
- [Uprawnienia BrowserContext](https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions)
- [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation)
- [Tailwind CSS dla Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
