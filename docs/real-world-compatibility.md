# FaultLane v0.4 — zgodność z rzeczywistymi aplikacjami

FaultLane testuje **HTTP fetch/XHR wykonywane przez Chromium** podczas deklaratywnej podróży użytkownika. Strona aplikacji pozostaje na HTTP(S) loopback. API może mieć inny origin, również adres w stylu `https://example-test.supabase.co`, ale domyślnie żądanie jest obsługiwane przez mock w przeglądarce i nie trafia do tego serwera.

Włącz nowy model przez `endpoints`. Starsze konfiguracje z pojedynczym `api` nadal działają według reguł v0.1–v0.3; nie łącz `api` i `endpoints` w jednym pliku. Nowy model zapisuje raport `schemaVersion: 3`; panel odczytuje także raporty 1 i 2 bez przepisywania plików.

## Granica sieci i uprawnień

| Ustawienie | Co pozwala zrobić | Czego nie pozwala zrobić |
| --- | --- | --- |
| `baseUrl` | Otworzyć lokalną aplikację HTTP(S): localhost, 127.0.0.0/8 lub ::1 | Otwierać zdalnej strony aplikacji |
| `network.mockOrigins` | Przechwycić skonfigurowany endpoint w dokładnym originie | Kontaktować się z tym API ani przekazywać niedopasowanych żądań |
| `response: { type: "mock", json: ... }` | Zwrócić zadeklarowane dane syntetyczne | Sprawdzić dostępności lub poprawności prawdziwej usługi |
| `response: { type: "forward" }` | Wykonać prawdziwe GET/HEAD do pasującego lokalnego API | Wysyłać requestów do zdalnego API ani wykonywać POST/PUT/PATCH/DELETE |
| `network.localOrigins` | Dopuścić forward GET/HEAD do wskazanego dodatkowego originu loopback | Przepuszczać dowolnych requestów do tego originu |
| `network.assets` | Pobrać wskazane zasoby o określonym originie, ścieżce i typie | Udzielać zgody na fetch/XHR do tego samego URL |

Każdy cross-origin endpoint wymaga wpisu w `mockOrigins`, również gdy drugi serwer jest lokalny. Forward do drugiego lokalnego serwera dodatkowo wymaga `localOrigins`. Przekazywanie API do Internetu jest odrzucane przez schemat. Żądania fetch/XHR, które nie pasują do żadnego endpointu, są blokowane — także do API w originie aplikacji. Skonfiguruj również zależności, które mają pozostać zdrowe.

Zwykłe GET/HEAD dokumentów i zasobów aplikacji mogą korzystać z jej originu. Zewnętrzne zasoby wymagają wąskiej reguły `assets`. Przekierowania HTTP nie są śledzone; podaj końcowy URL. TLS pozostaje włączony, bez ignorowania błędów certyfikatów. Blokada nie jest tylko ostrzeżeniem: nieplanowany ruch uniemożliwia PASS i pojawia się w dowodach.

Konfiguracja `.ts` jest **zaufanym wykonywalnym kodem**. Zod waliduje obiekt po imporcie; nie izoluje kodu modułu. Ładuj wyłącznie własną lub sprawdzoną konfigurację. Polityka przeglądarki nie ogranicza kodu serwera Twojej aplikacji: lokalny backend może sam wysłać żądanie zdalne. Używaj odizolowanego środowiska i danych syntetycznych.

## Dopasowanie endpointu i liczniki

Endpoint ma stabilne `id`, `match`, poprawną odpowiedź `response`, dokładne `expectedRequests` i twardy `maxRequests`.

- `match.origin` jest pełnym originem, bez ścieżki, danych logowania, query i wildcardów. Brak oznacza origin `baseUrl`. Nazwa hosta i domyślny port są normalizowane przez URL; porównanie nie obejmuje subdomen ani innych portów.
- `match.method` jest jawne; domyślne `GET`. Metody GET, HEAD, POST, PUT, PATCH i DELETE można mockować. Prawdziwy forward jest ograniczony do GET/HEAD. Dane requestu nie są warunkiem dopasowania i nie są zapisywane.
- `match.pathname` to ścieżka dokładna albo jeden końcowy `/*`. `/api/projects/*` obejmuje ścieżki poniżej `/api/projects/`, nie samo `/api/projects`. Brak dowolnego regex, CSS i wykonywalnych funkcji.
- `match.query` zawiera dokładne warunki typu `{ status: "eq.open", select: "id,label" }`. Każdy wymieniony parametr musi wystąpić dokładnie raz z podaną wartością. Dodatkowe parametry są dozwolone. W raporcie zostają tylko nazwy, wszystkie wartości są usuwane.
- Nakładające się matchery są błędem konfiguracji. Nie ma zależnego od kolejności „pierwszy wygrywa”. Rozdziel origin, metodę, ścieżkę albo sprzeczne dokładne warunki query.
- Liczniki i numery requestów są oddzielne dla każdego endpointu. Numer rezerwowany jest przy wejściu requestu, przed oczekiwaniem na odpowiedź. Równoczesne odpowiedzi nie zmieniają przydziału sekwencji; kolejność samych requestów jest kolejnością zaobserwowaną przez przeglądarkę.

Domyślnie endpoint oczekuje jednego requestu i ma limit 10. Można ustawić 1–30, a liczba endpointów wynosi maksymalnie 10. Liczba oczekiwana musi zostać osiągnięta dokładnie; sam brak przekroczenia limitu nie wystarcza.

## Next.js: kilka lokalnych API i awaria tylko jednego

Poniższy plik działa z `examples/next-orders` na porcie 3101 i stroną `/workspace`. Komponent kliencki, po kliknięciu **Open workspace**, wykonuje osobne wywołania profilu, projektów i powiadomień. Awaria dotyczy wyłącznie projektów; pozostałe odpowiedzi pochodzą z prawdziwego lokalnego API.

```ts
import type { FaultLaneConfigInput } from "faultlane/config";

export default {
  name: "Harbor — trzy lokalne endpointy",
  baseUrl: "http://127.0.0.1:3101",
  pagePath: "/workspace",
  endpoints: [
    { id: "profile", match: { pathname: "/api/profile", method: "GET" }, response: { type: "forward" }, expectedRequests: 1, maxRequests: 1 },
    { id: "projects", match: { pathname: "/api/projects", method: "GET", query: { view: "active" } }, response: { type: "forward" }, expectedRequests: 1, maxRequests: 2 },
    { id: "notifications", match: { pathname: "/api/notifications", method: "GET" }, response: { type: "forward" }, expectedRequests: 1, maxRequests: 1 },
  ],
  actions: [{ type: "click", locator: { by: "role", role: "button", name: "Open workspace" } }],
  baseline: { assertions: [{ locator: { by: "role", role: "region", name: "Workspace projects" }, state: "text", text: "Signal harbor" }] },
  scenarios: [{
    id: "http-500",
    targets: [{ id: "projects", sequence: [{ type: "http-500" }, { type: "forward" }], expectedRequests: 2 }],
    assertions: [{ locator: { by: "role", role: "alert", name: "Project warning" }, state: "text", text: "Project list is unavailable." }],
    sequenceRecovery: {
      actions: [{ type: "click", locator: { by: "role", role: "button", name: "Retry projects" } }],
      assertions: [
        { locator: { by: "role", role: "region", name: "Workspace projects" }, state: "text", text: "Signal harbor" },
        { locator: { by: "role", role: "region", name: "Workspace identity" }, state: "text", text: "Harbor operator" },
        { locator: { by: "role", role: "region", name: "Workspace notifications" }, state: "text", text: "3 unread notices" },
        { locator: { by: "role", role: "alert", name: "Project warning" }, state: "hidden" },
        { locator: { by: "role", role: "status", name: "Workspace progress" }, state: "hidden" },
      ],
    },
  }],
} satisfies FaultLaneConfigInput;
```

`targets` zmienia tylko wskazane endpointy w danym scenariuszu. `expectedRequests` w override musi być równe długości `sequence`, a sekwencja musi mieścić się w limicie endpointu. Próba po końcu sekwencji jest blokowana i powoduje FAIL. Nowy request jest konieczny także przy recovery opartym na mocku; sama zmiana UI na sukces nie wystarcza. `forward` potwierdza rzeczywisty lokalny status 2xx, natomiast `mock` potwierdza zachowanie aplikacji wobec danych syntetycznych.

## React/Vite: cross-origin i kontrolowane automatyczne 429

Fixture `examples/react-board` domyślnie korzysta z lokalnego API `http://127.0.0.1:3103`. Strona `/?mode=auto` ma własną, ograniczoną do trzech prób obsługę HTTP 429. FaultLane nie dopisuje retry do aplikacji.

W tym przykładzie wszystkie API są mockowane, więc serwer API nie musi działać. Vite działa na porcie 3102. Dwa HTTP 429 są naprawdę dostarczane do aplikacji, trzeci request otrzymuje JSON, a profil zespołu ma niezależny licznik.

```ts
import type { FaultLaneConfigInput } from "faultlane/config";

export default {
  name: "Garden — automatyczne ponowienia",
  baseUrl: "http://127.0.0.1:3102",
  pagePath: "/?mode=auto",
  network: { mockOrigins: ["http://127.0.0.1:3103"] },
  endpoints: [
    { id: "cards", match: { origin: "http://127.0.0.1:3103", pathname: "/v2/cards", method: "GET", query: { lane: "ready" } }, response: { type: "mock", json: { cards: [{ id: 11, caption: "Prepare garden map" }] } }, expectedRequests: 1, maxRequests: 3 },
    { id: "session", match: { origin: "http://127.0.0.1:3103", pathname: "/v2/session", method: "GET" }, response: { type: "mock", json: { displayName: "Garden team" } }, expectedRequests: 1, maxRequests: 1 },
  ],
  actions: [{ type: "click", locator: { by: "role", role: "button", name: "Open board" } }],
  baseline: { assertions: [{ locator: { by: "role", role: "region", name: "Garden cards" }, state: "text", text: "Prepare garden map" }] },
  scenarios: [{
    id: "http-429",
    targets: [{ id: "cards", expectedRequests: 3, sequence: [
      { type: "http-429", retryAfterSeconds: 1 },
      { type: "http-429", retryAfterSeconds: 1 },
      { type: "mock", json: { cards: [{ id: 11, caption: "Prepare garden map" }] } },
    ] }],
    assertions: [
      { locator: { by: "role", role: "region", name: "Garden cards" }, state: "text", text: "Prepare garden map" },
      { locator: { by: "role", role: "status", name: "Board progress" }, state: "hidden" },
    ],
  }],
} satisfies FaultLaneConfigInput;
```

Tutaj końcowe asercje są wykonywane po całej sekwencji. Nie twierdzimy, że sprawdzono przejściowy komunikat błędu ani dokładny czas backoff. Jeśli aplikacja pokazuje stan awarii i czeka na człowieka, użyj `sequenceRecovery.actions` z kliknięciem, tak jak w przykładzie Next.js. Gdy sama ponawia, możesz użyć deklaratywnych oczekiwań lub pustego `actions`; każda wymagana asercja pozostaje jawna. Kolejne `waitForRequest` mogą wskazywać origin, metodę, pathname, query i absolutne `occurrence` w scenariuszu.

## Supabase-style REST w przeglądarce

Zakres v0.4 to **GET kolekcji JSON** pod `/rest/v1/...`: filtrowanie URL, lista rekordów, pusta tablica, błędy 500/429, zerwane połączenie, opóźnienie i kontrolowana sekwencja recovery. Nie oznacza pełnego wsparcia PostgREST ani wszystkich wersji SDK Supabase.

Fixture `examples/supabase-tasks` to osobna aplikacja React/Vite na porcie 3104. Wykonuje browser fetch z syntetycznymi nagłówkami `apikey`, `Authorization`, `Prefer` i `X-Client-Info`. Nie używa SDK Supabase ani prawdziwego klucza. Lokalne API `examples/test-api` emuluje tylko używany kontrakt. Można też mockować fikcyjny origin HTTPS bez kontaktu z nim.

```ts
import type { FaultLaneConfigInput } from "faultlane/config";

export default {
  name: "Orchard — REST i ręczne recovery",
  baseUrl: "http://127.0.0.1:3104",
  pagePath: "/",
  network: { mockOrigins: ["http://127.0.0.1:3103"] },
  endpoints: [
    { id: "tasks", format: "supabase-rest", match: { origin: "http://127.0.0.1:3103", pathname: "/rest/v1/tasks", method: "GET", query: { select: "id,label", status: "eq.open" } }, response: { type: "mock", json: [{ id: "spruce", label: "Inspect greenhouse" }] }, maxRequests: 2 },
    { id: "teams", format: "supabase-rest", match: { origin: "http://127.0.0.1:3103", pathname: "/rest/v1/teams", method: "GET", query: { select: "title" } }, response: { type: "mock", json: [{ title: "Orchard crew" }] }, maxRequests: 1 },
  ],
  actions: [{ type: "click", locator: { by: "role", role: "button", name: "Find open tasks" } }],
  baseline: { assertions: [{ locator: { by: "role", role: "region", name: "Open task list" }, state: "text", text: "Inspect greenhouse" }] },
  scenarios: [{
    id: "http-500",
    targets: [{ id: "tasks", expectedRequests: 2, sequence: [{ type: "http-500" }, { type: "mock", json: [{ id: "spruce", label: "Inspect greenhouse" }] }] }],
    assertions: [{ locator: { by: "role", role: "alert", name: "Task notice" }, state: "text", text: "Tasks are unavailable." }],
    sequenceRecovery: {
      actions: [{ type: "click", locator: { by: "role", role: "button", name: "Refresh checklist" } }],
      assertions: [
        { locator: { by: "role", role: "region", name: "Open task list" }, state: "text", text: "Inspect greenhouse" },
        { locator: { by: "role", role: "alert", name: "Task notice" }, state: "hidden" },
        { locator: { by: "role", role: "status", name: "Task lookup" }, state: "hidden" },
      ],
    },
  }],
} satisfies FaultLaneConfigInput;
```

`format: "supabase-rest"` wymaga tablicy dla poprawnego mocku kolekcji. Błędy mają pola `code`, `message`, `details`, `hint`; odpowiedź kolekcji ma `Content-Range` i `Range-Unit: items`. Są to dane mocka, nie wynik zapytania do PostgREST. Nie emulujemy pełnej paginacji, `count`, `.single()`, RPC, mutacji ani wszystkich wariantów `Prefer`.

Mock ustawia CORS dla dokładnego originu aplikacji i udostępnia `Content-Range`, `Range-Unit`, `Retry-After`. Rozpoznany preflight OPTIONS może zostać obsłużony syntetycznie; nie zwiększa licznika docelowego GET i nie dowodzi, że prawdziwy serwer udzieliłby tej samej zgody. Nagłówki requestu nie są zapisywane. Supabase Auth, Realtime, Storage, połączenia PostgreSQL oraz service-role keys pozostają poza zakresem.

## Pozostałe odpowiedzi sekwencji

| Odpowiedź | Zachowanie |
| --- | --- |
| `{ type: "http-500" }` | Syntetyczny błąd JSON i status 500 |
| `{ type: "http-429", retryAfterSeconds: 1 }` | Błąd 429 z `Retry-After`; runner nie planuje retry aplikacji |
| `{ type: "network" }` | Zerwanie requestu w przeglądarce, bez statusu HTTP |
| `{ type: "empty" }` | HTTP 200 z pustą tablicą JSON |
| `{ type: "mock", json: ... }` | Zadeklarowana odpowiedź 2xx, domyślnie 200 |
| `{ type: "forward" }` | Prawdziwe pasujące lokalne GET/HEAD bez śledzenia redirect |
| `{ type: "slow", delayMs: 3000, response: { type: "mock", json: [] } }` | Ograniczone opóźnienie, następnie mock lub lokalny forward |

Scenariusz `slow` dodatkowo potrzebuje `delayMs` równego opóźnieniom w sekwencji i pozytywnych asercji `duringDelay`. Sam zrzut spinnera nie zastępuje sprawdzenia, że asercja nastąpiła podczas oczekującej odpowiedzi. Każdy scenariusz musi zawierać swoją deklarowaną awarię i pozytywne oczekiwanie UI; nie można skonfigurować „sukcesu” przez pustą listę sprawdzeń. Dane fixture są ograniczonym JSON, bez funkcji, cykli ani arbitralnego kodu.

## Jawne zasoby CDN

Przykład fragmentu polityki, który dopuszcza wyłącznie arkusze CSS i fonty z wybranej ścieżki:

```ts
const network = {
  mockOrigins: ["https://example-test.supabase.co"],
  assets: [{ origin: "https://assets.example.invalid", pathname: "/fonts/*", resourceTypes: ["font", "stylesheet"] }],
};
```

Ten adres jest ilustracją, nie usługą testową. Dopiero jawna reguła zezwala na rzeczywiste pobranie zasobu; użyj własnego zaufanego CDN lub lokalnej fixture. Pobranie jest ograniczone czasem i rozmiarem, bez przekazywania cookies i nagłówków autoryzacji przeglądarki, bez przekierowań. Nie wkładaj sekretów do URL zasobu. `script` to zezwolenie na wykonanie zaufanego kodu dostawcy w aplikacji; dodawaj je świadomie. Fetch/XHR pod adresem obrazka nadal wymaga endpointu API.

## Gdy nic nie zostało przechwycone

`API_NOT_OBSERVED` oznacza ERROR, nie PASS. Raport zawiera endpointy z zerowym dopasowaniem, obserwowane metody/ścieżki/originy, blokady i hipotezy. Hipoteza nie jest ustaloną przyczyną.

1. Sprawdź port aplikacji, origin API, metodę, pathname i dokładne warunki query. Wartości query nie są w raporcie; porównaj je lokalnie w narzędziach przeglądarki.
2. Potwierdź, że odpowiedni klik/fill uruchamia request. Widoczny przycisk przed hydratacją Next.js może nie mieć jeszcze handlera. Korzystaj z jawnego sygnału gotowości aplikacji; runner nie powtarza sam kliknięć.
3. Sprawdź, czy żądanie występuje jako fetch/XHR w przeglądarce. Fetch w Server Component, Route Handlerze, Server Action lub innym procesie serwerowym nie należy do tego kontekstu Playwright.
4. Przejrzyj blokady. Zależność API może potrzebować osobnego mockowanego endpointu, a obrazek lub font — konkretnej reguły zasobów. Samo dopisanie originu do `mockOrigins` nie odblokowuje ruchu.
5. Sprawdź service workera, cache i transport. Kontekst powstaje od nowa, service workers są blokowane, routing wyłącza cache HTTP. Aplikacja zależna od trybu offline lub service workera może zachowywać się inaczej.

Interceptory i obserwacja są rejestrowane **przed nawigacją**. Raport nie zgaduje, że „request był za wcześnie”, gdy nie ma na to dowodu. Wszystkie limity są skończone. Brak pierwszego oczekiwanego przechwycenia daje ERROR; brak kolejnej wymaganej próby lub błędny UI po faktycznej symulacji daje FAIL. Stan SKIPPED oznacza niewykonane sprawdzenie.

## Co pokazują dowody

Raport JSON, Markdown i panel mają te same sekcje: endpoint, origin/metoda/ścieżka, oczekiwana i rzeczywista sekwencja, liczniki obserwacji/przechwyceń/blokad/awarii, kroki UI i zrzuty. `simulated` oznacza symulowaną awarię lub opóźnienie, `mocked` poprawne syntetyczne dane, `forwarded` odpowiedź od dozwolonego lokalnego serwera, `aborted` zerwanie, `blocked` egzekwowanie polityki. Żadne z nich nie oznacza automatycznie PASS całego scenariusza.

Sieciowe dowody przechowują najwyżej 200 zdarzeń; pole `truncated` ujawnia obcięcie, a liczniki obejmują dalsze zdarzenia. Wszystkie wartości query, fragmenty URL, userinfo, headers i body są pomijane. Ścieżka URL i widoczny UI mogą nadal zawierać prywatne dane. Używaj danych syntetycznych oraz `maskTestIds`/`data-faultlane-private`; nie umieszczaj sekretów w nazwach endpointów, tekstach asercji ani ścieżkach.

## Fixture lokalne i uruchamianie

- `examples/next-orders`: `npm install`, `npm run dev` w tym katalogu; Next.js na 3101, `/workspace` dla wielu API, dotychczasowe `/orders` zachowane.
- `examples/react-board`: `npm install`, `npm run dev`; React/Vite na 3102, API domyślnie na 3103. Parametr `mode=auto` włącza jawny wariant trzech prób po 429.
- `examples/test-api`: `npm install`, `npm run dev`; serwer HTTP loopback na 3103, dane dla obu aplikacji Vite i lokalny zasób SVG. Nie jest potrzebny przy konfiguracji w pełni mockowanej.
- `examples/supabase-tasks`: `npm install`, `npm run dev`; React/Vite na 3104, Supabase-style GET `/rest/v1/tasks` i `/rest/v1/teams`.

Po zapisaniu odpowiedniego przykładu jako `faultlane.config.ts` w katalogu aplikacji:

```sh
npm exec --no -- faultlane doctor
npm exec --no -- faultlane run
```

`doctor` waliduje matchery i politykę, ale nie wywołuje skonfigurowanych zdalnych API. Gotowość środowiska nie jest dowodem poprawnego UI. Szczegóły instalacji tarballa i istniejącego kreatora: [pierwsze użycie](getting-started.md).

## Granice zgodności

- Wspierany jest Chromium i przeglądarkowe fetch/XHR, nie serwerowa iniekcja awarii.
- Lokalne WebSockety HMR mogą być przepuszczane dla działania narzędzi developerskich, ale ich wiadomości nie są faultowane ani weryfikowane. WebSockety zewnętrzne są blokowane. To nie jest narzędzie do testowania Realtime ani dowolnych transportów.
- Nowy kontekst nie ma zapisanej sesji użytkownika. Logowanie, profile, Supabase Auth i sekrety nie są automatycznie importowane.
- Nie ma automatycznego skanowania domen, pobierania przeglądarki, modyfikowania baz ani kontaktu z produkcyjnym API podczas mockowania. Rzeczywisty ruch wynika tylko z lokalnego forward lub jawnej reguły zasobu.
- Weryfikacja nie dowodzi działania systemu po zamknięciu kontekstu ani ścisłego związku przyczynowego między kliknięciem a ukrytym timerem. Potwierdza rzeczywistą liczbę i kolejność zaobserwowanych requestów oraz zadeklarowane asercje.
- Testy w tym środowisku są wykonywane na Windows. Nie deklarujemy testów Linux/macOS bez osobnego uruchomienia.

Podstawy zakresu: [Playwright — service workers i brakujące zdarzenia](https://playwright.dev/docs/network#missing-network-events-and-service-workers), [BrowserContext.route i cache](https://playwright.dev/docs/api/class-browsercontext#browser-context-route), [Service Workers](https://playwright.dev/docs/service-workers), [Supabase Data REST API](https://supabase.com/docs/guides/api), [PostgREST — zakres i liczniki](https://docs.postgrest.org/en/stable/references/api/pagination_count.html).
