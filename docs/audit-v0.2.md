# Audyt przed rozszerzeniem do v0.2

## Stan zastany i wykonana kontrola

Przed modyfikacją runnera wykonano typecheck, lint, 35 testów jednostkowych i 7 istniejących testów E2E. Wszystkie przeszły. Domyślny CLI ponownie uzyskał 6 PASS / 0 FAIL / 0 ERROR (`20261026T185138194Z-cd91d84a`). Stary jawnie zepsuty wariant uzyskał 1 PASS / 1 FAIL / 0 ERROR (`20261026T185152267Z-1fa7e8db`).

Zastana historia zawierała dwa uruchomienia (`20261026T174635448Z-fa940411`, `20261026T174648427Z-9e5fa802`) z łącznie 8 ERROR: brak przechwyconego API. Ich zrzuty i raporty nie dowodzą samodzielnie przyczyny. Z wcześniejszego procesu budowy wiadomo, że badano tam połączenie HMR i uprawnienie local-network-access. Aktualny kod ma oba mechanizmy, a nowe uruchomienia nie odtworzyły tych ERROR. Nie oznacza to zmiany lub „naprawienia” historycznych wyników.

## Ustalenia i zmiany

- Panel sumował całą historię w głównych kartach, co mogło wyglądać jak bieżące błędy. v0.2 rozdziela ostatni ukończony run i poprzednie uruchomienia.
- v0.1 nie rozróżniał wszystkich klas błędów wykonania kodem diagnostycznym. v0.2 zapisuje np. API_NOT_OBSERVED, ROUTE_EXECUTION, NAVIGATION_FAILED, SCENARIO_TIMEOUT, RETRY_NO_REQUEST i ASSERTION_FAILED.
- Przechwycenie dowolnego loopback originu z tym samym pathname mogło zostać zaliczone jako target coverage. Teraz coverage i jawne waitForRequest wymagają originu `baseUrl`. Test jednostkowy odtwarza przypadek innego portu.
- W nowej konfiguracji recovery selektor `role=alert` bez nazwy był niejednoznaczny: Next.js ma również własny announcer. Odtworzono dwa dopasowania. Komunikat demo ma teraz `aria-label="Project error"`, a konfiguracja pełną nazwę; raport wskazuje wieloznaczność zamiast udawać zwykły timeout.
- Nowa logika nie może oprzeć się na liczniku „ukończono coś”: rezerwuje ordinal przed asynchroniczną symulacją i sprawdza konkretną odpowiedź recovery. Przypadki przedwczesnego/podwójnego requestu oraz UI udającego odzyskanie bez żądania mają testy regresyjne.
- Zamknięcie strony podczas asercji jest błędem wykonania, nie błędem oczekiwanego UI. Kod nie zapisuje surowych wyjątków ani DOM w komunikatach diagnostycznych.

Raporty zastane są zachowane. Przed pracą zapisano manifest SHA-256 oryginalnych plików do lokalnego katalogu tymczasowego; kontrola po pracy porównuje zawartość bez migracji i nadpisywania. Nowe nieudane próby implementacyjne również pozostają w historii.

## Końcowa weryfikacja

`npm run verify` zakończyło się kodem 0: TypeScript, ESLint, **47 testów jednostkowych**, **20 E2E** i build produkcyjny Next.js. Zestaw zawiera wszystkie 7 oryginalnych E2E oraz 13 testów kliknięć/recovery i niezależnej aplikacji. Test panelu porównuje ostatnie liczniki z JSON i historyczne sumy z wcześniejszymi raportami; sprawdza też pobieranie dowodu kroku i układ mobilny.

Trzy celowe defekty recovery są uruchamiane w osobnym procesie CLI: każdy daje FAIL, kod procesu 1, wskazanie kroku oraz PNG. Przypadek poprawny weryfikuje dwa zaobserwowane i przechwycone żądania, dokładnie jeden fault, HTTP 500 dla pierwszego i prawdziwe HTTP 200 dla drugiego. Niezależny katalog potwierdza także rzeczywiste trafienia do swojego backendu.

Porównanie SHA-256: **37 oryginalnych plików w `reports/`, 0 zmienionych lub brakujących**. Stare ERROR i FAIL pozostają w historii. Nie wykonano commitów, push ani wdrożenia.
