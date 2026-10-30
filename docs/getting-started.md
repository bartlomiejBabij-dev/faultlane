# FaultLane v0.5.1 — pierwsze użycie we własnej aplikacji

Porównanie dwóch przebiegów i kody procesu opisuje [regression-comparison.md](regression-comparison.md), konfigurację GitHub Actions — [ci-integration.md](ci-integration.md), a kontrolę prywatnej bety — [beta-checklist.md](beta-checklist.md). W razie błędu zrzutu sprawdź osobne pole `evidence` i diagnostykę etapu; kod procesu 2 nie oznacza, że inne obserwacje UI zostały utracone.

CLI działa w katalogu Twojej aplikacji. Serwer i panel FaultLane nie muszą być uruchomione. Paczka **nie została opublikowana w npm**; nie zakładamy działania publicznego `npx faultlane`.

Wymagania: Node.js 22.13+, 24.x lub 26.x, npm oraz system obsługiwany przez Chromium/Playwright. Testy projektu w tym środowisku uruchamiamy na Windows; nie stanowi to sprawdzenia Linux/macOS ani każdej wspieranej linii Node. Faktyczne wyniki są zapisane w [audycie v0.4](audit-v0.4.md). Polecenia z cudzysłowami działają także ze spacjami w ścieżkach.

## 1. Przygotuj i zainstaluj lokalne CLI

W repozytorium FaultLane:

```sh
npm ci
npm run build:cli
npm pack --dry-run
npm pack
```

`npm pack` uruchamia także `prepack`, czyli ponowny build CLI, i tworzy tarball o wersji z `package.json` — dla wydania v0.5.1 jest to `faultlane-0.5.1.tgz`. Nie publikuje paczki. Dystrybucja zawiera skompilowany JavaScript, deklaracje typów i dokumentację, bez panelu Next.js, demo, konfiguracji projektu, screenshotów i historycznych raportów. Flaga `private: true` pozostaje włączona.

W katalogu **własnej aplikacji**, z poprawną lokalną ścieżką do tarballa:

```sh
npm install --save-dev "/sciezka/do/faultlane/faultlane-0.5.1.tgz"
npm exec --no -- faultlane --version
npm exec --no -- faultlane --help
```

Na Windows podaj np. `"C:\projekty\faultlane\faultlane-0.5.1.tgz"`. W tej instrukcji `npm exec --no -- faultlane` oznacza wykonywalny plik z już zainstalowanej lokalnej paczki; odmowa instalacji zapobiega przypadkowemu sięgnięciu po publiczny pakiet o tej nazwie. W skrypcie `package.json` możesz używać bezpośrednio `faultlane run`, np. `"test:reliability": "faultlane run"`.

Alternatywa z `npm link`:

```sh
# W repozytorium FaultLane, po build:cli:
npm link
# W katalogu własnej aplikacji:
npm link faultlane
faultlane --version
```

Globalny katalog bin npm musi znajdować się w PATH. Lokalny link daje również edytorowi typy `faultlane/config`. Nie zmieniaj z tego powodu polityki wykonywania PowerShell; przy blokadzie skryptu `.ps1` użyj `faultlane.cmd`. Po zmianach w runnerze ponów `npm run build:cli` w repozytorium FaultLane.

## 2. Uruchom swoją aplikację

W pierwszym terminalu repozytorium Next.js:

```sh
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Jeżeli Twój skrypt `dev` przyjmuje inne argumenty, uruchom go zgodnie z konfiguracją projektu i odczytaj rzeczywisty port. Kreator wykrywa nazwy zależności Next.js/React/Vite i nazwy skryptów `dev`/`start`; nie odgaduje ich działania. Port 3000 dla Next.js/React lub 5173 dla Vite jest wyłącznie sugestią.

Endpoint musi być wywoływany przez **przeglądarkę**, np. `fetch('/api/orders')` w komponencie klienckim lub handlerze przycisku. Server Components, Server Actions i wewnętrzne wywołania backendu nie są automatycznie przechwytywane. Prosty tryb `api` obsługuje GET w originie strony. Dla cross-origin, Supabase-style REST, kilku API i sekwencji wybierz `endpoints` przez kreator zaawansowany. Aplikacja pozostaje lokalna; zgoda na mockowanie zewnętrznego API nie pozwala go wywołać.

## 3. Wygeneruj konfigurację

Bez `--advanced` pozostaje prosty kreator pojedynczego GET API, zgodny z v0.3:

W drugim terminalu, nadal w katalogu Twojej aplikacji:

```sh
npm exec --no -- faultlane init
```

Kreator pyta o:

- adres HTTP(S) loopback, ścieżkę strony oraz pathname API, opcjonalnie z `*`;
- uruchamianie requestu automatycznie lub kliknięciem wskazanej roli i dostępnej nazwy;
- rodzaj awarii: `http-500`, `http-429`, `network`, `slow`, `empty`;
- lokator i rzeczywisty tekst oczekiwany po poprawnej odpowiedzi — baseline;
- lokator i tekst po awarii lub pustej odpowiedzi; dla `slow` — wskaźnik ładowania;
- opcjonalnie przycisk ponowienia, zniknięcie ładowania i pełne recovery HTTP 500;
- lokalny katalog raportów.

Lokatory: `role:button:Load orders`, `role:alert:Order problem`, `role:region:Orders`, `label:Category`, `testId:loading`. Nazwy ról i dostępne nazwy są dopasowywane dokładnie; zawartość tekstowa oczekiwania jest sprawdzana jako fragment. Rola bez nazwy jest dopuszczona dla asercji, ale musi wskazywać jednoznaczny element. Nie wpisuj CSS ani XPath. Przykładowy tekst błędu poniżej trzeba zastąpić komunikatem Twojej aplikacji.

Nie ma domyślnych tekstów sukcesu ani awarii. Brak wymaganych wartości kończy inicjalizację kodem 2 bez pliku. Istniejący plik pozostaje bez zmian, chyba że wybierzesz kopię i zastąpienie. Kopia ma unikalną końcówkę `.bak`. `--yes` sam w sobie **nie** pozwala nadpisywać.

Tryb powtarzalny, bez pytań (jedna linia, również w PowerShell):

```sh
npm exec --no -- faultlane init --yes --url http://127.0.0.1:3001 --page /orders --api /api/orders --failure http-500 --trigger click --click-name "Load orders" --success-locator "role:region:Orders" --success-text "Order 123" --failure-locator "role:alert:Order problem" --failure-text "Could not load orders" --retry-name "Retry" --loading-locator "role:status:Loading orders"
```

W wariancie automatycznym użyj `--trigger auto` i pomiń `--click-name`. Do jawnej kopii i zastąpienia dodaj `--backup`. W razie potrzeby wybierz `--config faultlane.orders.config.ts`; kolejne polecenia muszą używać tej samej flagi. Wygenerowany plik to zwykły TypeScript zgodny ze schematem v0.2. Można dopisać istniejące kroki `fill`, `navigate`, `waitForElement`, `waitForRequest` i `assert`.

### Cross-origin, wiele endpointów i Supabase REST

```sh
npm exec --no -- faultlane init --advanced
```

Ten wariant pyta o lokalną aplikację, liczbę endpointów, ich ID, origin/metodę/ścieżkę/query, format `json` lub `supabase-rest`, dane poprawnej odpowiedzi i limity requestów. Wymaga osobnej zgody na mockowanie każdego cross-origin oraz na prawdziwy forward do dodatkowego lokalnego API. Następnie wybierasz wyzwalacz, pozytywne oczekiwania UI, awarię i ograniczoną sekwencję odpowiedzi. Opcjonalnie konfigurujesz stan błędu, kliknięcie odzyskania i jego asercje oraz wąskie reguły zasobów. Kreator tworzy jeden scenariusz awarii; kolejne można dopisać w pliku.

Tryb bez pytań przyjmuje pełny deklaratywny obiekt konfiguracji w wybranym pliku JSON:

```sh
npm exec --no -- faultlane init --advanced --yes --from-json setup.json
```

`setup.json` używa rzeczywistego schematu: `baseUrl`, `pagePath`, `endpoints`, opcjonalnego `network`, `baseline` i `scenarios` z oczekiwaniami UI. To dane JSON, bez importu ani `export default`. Limit pliku wynosi 1 MB. `init` waliduje cały obiekt i zapisuje wynik jako typowany TypeScript; nie wysyła requestów do API. Nie mieszaj flag prostego kreatora (`--api`, `--failure` itp.) z `--advanced`. `--backup` i `--config` działają w obu trybach, a `--yes` nadal nie upoważnia do nadpisania.

Kompletne przykłady zgodne ze schematem, ręczne recovery 500 i automatyczne 429 → 429 → 200: [zgodność z rzeczywistymi aplikacjami](real-world-compatibility.md).

## 4. Sprawdź środowisko i przeglądarkę

```sh
npm exec --no -- faultlane doctor
```

`PASS` oznacza udany konkretny check środowiska, `WARNING` potrzebę uwagi, a `ERROR` przeszkodę. Kod 0 dopuszcza ostrzeżenia; kod 2 oznacza co najmniej jeden błąd. Doctor nie dowodzi przechwycenia API ani poprawnego UI, nie zapisuje plików w projekcie, nie uruchamia serwera i nie wywołuje API. Robi ograniczone czasowo GET originu i strony, nie śledzi przekierowań i sprawdza uprawnienia katalogu bez próbnego zapisu. Importuje jednak **zaufaną wykonywalną konfigurację**, tak samo jak `run`.

Dla `endpoints` sprawdza również originy, metody, query, nakładanie matcherów, granice forward, sekwencje i jawne oczekiwania. Wypisuje politykę sieciową i ostrzeżenie o service workerach/SSR. Nie wykorzystuje kluczy API ani cookies do sprawdzania dostępności zewnętrznych usług.

Jeżeli Chromium nie jest zainstalowane:

```sh
npm exec --no -- faultlane browsers install
```

Jest to osobna, jawna zgoda na pobranie przeglądarki wymaganej przez zainstalowaną wersję Playwright. `init`, `doctor` i `run` niczego nie pobierają. Na Linux mogą być dodatkowo wymagane biblioteki systemowe opisane w [dokumentacji Playwright](https://playwright.dev/docs/browsers#install-system-dependencies).

## 5. Uruchom test i przeczytaj dowody

```sh
npm exec --no -- faultlane run
# Opcjonalnie pojedyncza awaria oraz obowiązkowy baseline:
npm exec --no -- faultlane run --scenario http-500 --no-color
```

Kody procesu: **0 — PASS, 1 — niespełnione oczekiwania aplikacji, 2 — konfiguracja/wykonanie/infrastruktura ERROR**. ERROR ma pierwszeństwo przed FAIL. Niektóre wersje npm zmieniają kod potomnego procesu. Dokładny kod można odczytać przez bezpośredni `faultlane` z linku albo `node node_modules/faultlane/dist/cli.js run`.

`reports/<id>/report.md` można otworzyć w edytorze Markdown. W tym samym katalogu są `results.json`, screenshot scenariusza i zrzuty kroków. Linki w Markdown są względne; przy kopiowaniu zachowaj cały katalog uruchomienia. PASS wymaga przechwyconego requestu, wykonanej symulacji, jawnych asercji i dowodów. Brak requestu oznacza ERROR, a pozorny sukces po Retry bez nowego requestu oznacza FAIL. SKIPPED nie jest zaliczane.

Ścieżki `--config` i względne `reportsDir` są liczone od bieżącego katalogu aplikacji, także przy konfiguracji w podkatalogu. `../` wychodzące poza projekt, ścieżki sieciowe i dowiązania w wyjściu są odrzucane. Absolutny lokalny `reportsDir` jest jawnym wyborem innego katalogu, zachowanym dla kompatybilności v0.2. Panel `/results` w repozytorium FaultLane pozostaje osobną funkcją; nie agreguje automatycznie raportów innych projektów.

Po poprawieniu aplikacji uruchom ponownie **tę samą komendę i konfigurację**. Nowy raport nie zmienia poprzedniego. Nie włączaj demonstracyjnych przełączników usterek domyślnie.

## 6. Recovery HTTP 500 → Retry → prawdziwe 2xx w prostym trybie

W kreatorze wybierz recovery albo dodaj `--recovery` do pełnej komendy `init`. Wymagane są: oczekiwania sukcesu i błędu, nazwa przycisku ponowienia oraz lokator ładowania. Wygenerowana konfiguracja ustawia `affectRequests: 1`, `maxRequests: 2`, sprawdza błąd, klika Retry, wymaga nowego requestu z rzeczywistym statusem 2xx, sprawdza dane, zniknięcie błędu i zakończenie ładowania. Nie przechodzi na podstawie samego wyglądu UI.

Tryb `endpoints` dodaje także recovery z syntetycznym 2xx oraz automatyczne ponowienia aplikacji. Każdy etap sekwencji wymaga rzeczywistego requestu przeglądarki; `mocked` w raporcie nie oznacza odpowiedzi prawdziwego Supabase. Kontrakt starszego `recovery` pozostaje bez zmian.

## Niezależne przykłady i liczba kroków

`examples/next-orders` to osobna aplikacja Next.js z `/orders`, `GET /api/shipments`, przyciskami **Fetch shipments / Reconnect** i danymi **Parcel Aurora**. Uruchom `npm install`, a następnie `npm run dev` w jej katalogu; port to 3101. Przycisk pozostaje nieaktywny do zakończenia hydratacji.

`examples/catalog` to aplikacja Node HTTP i zwykły HTML, z `/catalog`, `GET /api/inventory`, przyciskami **Search inventory / Try again** i danymi **Cedar notebook**. Uruchom `npm install` i `npm run dev` w jej katalogu; port to 3100. Nie jest to drugi wariant demo FaultLane.

Wersja v0.4 dodaje `/workspace` z trzema endpointami do Next.js oraz osobne `examples/react-board` i `examples/supabase-tasks`. Obie aplikacje Vite mają inne teksty, lokatory i struktury odpowiedzi; korzystają z syntetycznego `examples/test-api`. Szczegółowe porty i konfiguracje: [przewodnik zgodności](real-world-compatibility.md#fixture-lokalne-i-uruchamianie).

Automatyczny `npm run test:package` kopiuje aplikacje do świeżych katalogów poza repozytorium (także ze spacjami), instaluje tarball przez npm, uruchamia serwery i wykonuje publiczne `init`, `doctor`, `run`, test usterki oraz ponowienie po poprawce. Zachowuje poprzednie próby Next.js/katalogu, dodaje wiele endpointów w Next.js i instalację zewnętrznego React/Vite z cross-origin. Konfiguracje i raporty pozostają do wglądu; ich położenie zapisuje w `.package-tests/latest.json`. Instalacja używa cache npm (`--offline`); jeśli brakuje zależności, zgłasza rzeczywisty błąd zamiast pozorować instalację.

Licząc operacje, po przygotowaniu tarballa i zależności własnej aplikacji jest **5 wymaganych czynności**: instalacja CLI, uruchomienie aplikacji, init, doctor, run. Brak Chromium dodaje **1** jawne polecenie instalacji. Odczyt raportu jest kolejną czynnością, a test po poprawce wymaga tylko ponownego `run`. To liczba kroków, nie pomiar czasu. Liczba pytań kreatora zależy od wybranego wyzwalacza i recovery; nie deklarujemy fikcyjnego czasu wdrożenia.

## Usunięcie instalacji/linku

```sh
# W projekcie aplikacji, po lokalnej instalacji tarballa:
npm uninstall --save-dev faultlane
# Lub usunięcie lokalnego linku:
npm unlink faultlane
# Usunięcie globalnego CLI utworzonego przez npm link:
npm uninstall --global faultlane
```

Konfiguracje i raporty pozostają Twoimi plikami. Usuń je ręcznie tylko wtedy, gdy nie są już potrzebne. FaultLane nie usuwa historycznych dowodów.

## Najczęstsze problemy

- `API_NOT_OBSERVED`: porównaj origin, metodę, pathname, query i wyzwalacz z metadanymi obserwowanych żądań. Nie wystarczy żądanie serwerowe Next.js. Lista możliwych przyczyn w raporcie jest oznaczona jako hipotezy.
- Widoczny przycisk przed hydratacją może nie mieć handlera. Aplikacja powinna ujawniać gotowość przez `disabled` lub własny element; w konfiguracji można poprzedzić kliknięcie `waitForElement` na takim elemencie. Runner nie zgaduje gotowości każdego frameworka i nie powtarza potajemnie kliknięć.
- Niejednoznaczna rola `alert`/`status`: dodaj dokładną dostępną nazwę lub stabilny test ID. Framework może mieć własny element o tej roli.
- `RETRY_NO_REQUEST`: Retry nie wywołało nowego API w limicie. Zmiana tekstu lub zniknięcie błędu nie wystarcza.
- `RECOVERY_REQUEST_MISSING` / `RESPONSE_SEQUENCE_INCOMPLETE`: nie wystąpiły wszystkie wymagane requesty nowego kontraktu endpointu; samo odtworzenie zdrowego UI nie wystarcza.
- `NETWORK_POLICY_BLOCKED`: sprawdź blokowane ścieżki i typy zasobów. Dodatkowe API potrzebuje własnego endpointu, a CDN — wąskiej reguły zasobów. `mockOrigins` samo nie otwiera dostępu do sieci.
- `BROWSER_LAUNCH`: wykonaj podaną instalację Chromium; sprawdź biblioteki systemowe i `PLAYWRIGHT_BROWSERS_PATH`, jeśli ustawiasz go świadomie.
- ERROR przy `baseUrl`: tylko HTTP(S) localhost/127.0.0.0/8/::1, bez danych logowania. `baseUrl` to sam origin. Zdalny origin API wolno zadeklarować wyłącznie do mockowania. Użyj końcowej strony bez przekierowania.
- Konfiguracja `.ts` jest kodem lokalnym; Zod sprawdza wynik importu, nie bezpieczeństwo kodu. Ładuj tylko pliki, którym ufasz. Kreator zapisuje deklaratywny obiekt przez bezpieczną serializację, bez eval.

Źródła zasad pakowania: [manifest i bin npm](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), [wydania Node.js](https://github.com/nodejs/node/releases).
