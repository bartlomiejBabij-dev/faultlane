# Architektura

FaultLane jest pojedynczym projektem npm, ale runner nie zależy od procesu Next.js. CLI może testować inną lokalną aplikację, jeśli spełnia ograniczenia opisane w konfiguracji.

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

## Cykl scenariusza

Kontekst nie dziedziczy cookies, localStorage ani service workerów. Routing jest rejestrowany przed otwarciem strony. Każde żądanie jest sprawdzane pod kątem adresu i metody. Przekierowania są odrzucane, ponieważ przeglądarka może obsłużyć kolejne ogniwo bez ponownego wywołania route handlera. Przepuszczane odpowiedzi korzystają z `route.fetch({maxRedirects: 0})` i `route.fulfill({response})`.

Runner czeka na rzeczywiste przechwycenie i zakończenie symulacji. Dla `slow` sprawdza osobno asercje podczas opóźnienia oraz po odpowiedzi. Opóźnienie jest jedynym celowym timerem symulacji; oczekiwania UI korzystają z asercji/pollingu Playwright. Timeout scenariusza zamyka kontekst, a timer opóźnienia otrzymuje AbortSignal.

Wspierana wersja Chromium otrzymuje uprawnienie `local-network-access` tylko dla testowanego originu. Lokalne WebSockety są dozwolone ze względu na HMR Next.js. Nie są objęte scenariuszami awarii.

`results.json` jest końcowym znacznikiem ukończenia. Panel nie wykonuje dowolnego pliku konfiguracyjnego dostarczonego przez HTTP: importuje własną konfigurację projektu. Parametry route służą wyłącznie do wyboru identyfikatora uruchomienia i dozwolonej nazwy artefaktu. Realpath zabezpiecza przed typowym wyjściem poza katalog przez dowiązania. Lokalny system plików pozostaje zaufany; nie jest to sandbox dla złośliwego procesu równolegle zmieniającego pliki.

## Źródła API

- [Routing i sieć Playwright](https://playwright.dev/docs/network)
- [Route: fulfill, abort, fetch i limity przekierowań](https://playwright.dev/docs/api/class-route)
- [Uprawnienia BrowserContext](https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions)
- [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation)
- [Tailwind CSS dla Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
