# Audyt FaultLane v0.5 — 30 października 2026

## Punkt wyjścia

Drzewo Git było czyste na gałęzi `main`. Bazowe `npm run verify` zakończyło się kodem 0: 168 testów jednostkowych, 40 E2E, typecheck, lint, build Next.js, build CLI oraz instalacja tarballa i testy niezależnych aplikacji. Środowisko: Windows, Node 24.21.0, npm 12.2.0. Testy zapisują nowe raporty; historycznych raportów nie edytowano ani nie usuwano. Nie wykonano commita, pusha, wdrożenia ani publikacji.

## Incydent EVIDENCE_WRITE

W zachowanym raporcie z v0.4 `baseline` miał `ERROR / EVIDENCE_WRITE` przy pierwszym kroku. Zapisano tylko informację o niedostępności dowodu; końcowy zrzut tego samego scenariusza istniał. Brak kodu systemowego i szczegółów przechwycenia uniemożliwia ustalenie przyczyny. Nie odtworzono pierwotnego błędu podczas bazowego `verify`; nie oznacza to, że jego przyczyna została usunięta.

Runner ma teraz osobny stan `SAVED`, `SKIPPED` lub `FAILED` oraz ograniczone, pozbawione surowych ścieżek i wyjątków informacje o etapie i kodzie. Tymczasowe pliki mają unikalne nazwy, są zapisywane i sprawdzane przed atomową publikacją bez zastępowania celu. Każdy przebieg tworzy nowy katalog; zrzuty są oczekiwane przed zamknięciem kontekstu. Wymagany zrzut, którego nie udało się zapisać, powoduje kod procesu 2. FAIL zachowania i awaria dowodu pozostają osobno widoczne. Nie ma ukrytych ponowień.

Testy z kontrolowaną kolizją w rzeczywistym procesie CLI wykazały `EVIDENCE_WRITE`, kod 2 i zachowanie wcześniejszego pliku. Drugi przypadek zachował jednocześnie `FAIL / ASSERTION_FAILED`, `evidence: FAILED` i kod 2. Testy jednostkowe wymuszają awarię API zrzutu, zamkniętą stronę, nieprawidłowy katalog, równoległą publikację, przerwany częściowy zapis, błąd serializacji i ochronę istniejącego raportu. Test zamknięcia strony używa kontrolowanego stubu, a nie awarii rzeczywistego procesu Chromium.

## Porównanie i CI

Przebiegi z identyczną zapisaną tożsamością mogą wykryć PASS → FAIL i FAIL → PASS. Wykonano rzeczywiste dwa przebiegi lokalnego fixture z kontrolowanym błędem UI: porównanie zwróciło regresję i kod 1, a w odwrotnej kolejności poprawę i kod 0. Wersje 1–3 pozostają czytelne, lecz starsze wyniki bez tożsamości scenariusza są INCOMPARABLE. Porównanie pokazuje liczniki endpointów i stan dowodów, a dostępność PNG sprawdza po sygnaturze; nie modyfikuje źródeł.

Trzy wybrane scenariusze zgodności powtórzono po trzy razy: recovery 500 z wieloma endpointami, mockowany HTTPS cross-origin oraz 429 → 429 → 200. **9/9 uruchomień przeszło, 0 błędów**. To ograniczona próba, a nie dowód eliminacji wszystkich niestabilności.

Kolejny pełny przebieg weryfikacyjny zakończył się kodem 1: 189 unitów przeszło, lecz jeden z 41 E2E wykazał `API_NOT_OBSERVED` w baseline click journey. Raport zapisał wykonane kliknięcie, zero requestów i ekran nadal w stanie początkowym. Stwierdzono w demo możliwy wyścig: HTML serwera zawierał aktywny przycisk przed hydratacją React. Nie ma zapisu pozwalającego z absolutną pewnością przypisać pojedynczą awarię właśnie temu wyścigowi. Nowy deterministyczny test z wyłączonym JavaScript najpierw wykazał, że niezhydratowany przycisk jest nieprawidłowo aktywny. Po poprawce pozostaje wyłączony do gotowości React, a rzeczywiste kliknięcie wysyła request. Powtórzono osobno po pięć razy ten test i click journey: **10/10 PASS**. Nie dodano ponawiania kliknięć ani nie złagodzono asercji requestu. Syntetyczny raport błędu zachowano w `.package-tests/v0.5-hydration-20261030T162405414Z-341649bf`.

## Wykonane kontrole wersji 0.5.0

Po naprawie gotowości demo ponownie uruchomiono pełne `npm run verify` na aktualnym kodzie: **kod 0, 189/189 testów jednostkowych i 42/42 E2E**, a także typecheck, lint, produkcyjny build aplikacji, build CLI i test rzeczywistej instalacji paczki. Wcześniejszy nieudany przebieg opisany wyżej zachowano w historii audytu; nie był pominiętym testem.

`npm run verify` zakończyło się kodem 0: typecheck, lint, 187 ówczesnych testów jednostkowych, **41 E2E**, build aplikacji, build CLI oraz test paczki. Podczas tego przebiegu dodano dwie dodatkowe kontrole jednostkowe; osobne `npm test` na aktualnym kodzie zakończyło się kodem 0 z **189/189 testami**. Uzupełnione testy E2E porównania, błędnej ścieżki raportu i pobrania Markdown panelu uruchomiono osobno po zmianach; oba przeszły. Ponowne `npm run typecheck` i `npm run lint` na aktualnym stanie zwróciły 0.

`npm run test:package`, wykonany w `verify`, zainstalował rzeczywisty tarball w niezależnych aplikacjach Next.js, Node/HTML i React/Vite. Sprawdził publiczne `--help`, `--version`, `init`, `doctor`, `run`, `compare`, prawdziwe PASS/FAIL/ERROR i ścisłe typy NodeNext. Przy `compare` sprawdzono niezmieniony raport oraz brak pliku wejściowego. Test cross-origin potwierdził zerową liczbę requestów do serwera mockowanego API.

`npm pack --dry-run` zwróciło kod 0 i listę 23 plików dystrybucji bez raportów, zrzutów, `.env`, źródeł aplikacji i katalogu `.git`. Dodatkowo w nowym katalogu, z pustym cache npm, zainstalowano tarball wraz z zależnościami React/Vite: instalacja pobrała 30 pakietów, a zainstalowane `faultlane --version` zwróciło `0.5.0`. Jest to test Windows, nie dowód uruchomienia Linux/GitHub Actions. Instalacja korzysta z cache, a w razie potrzeby z rejestru npm; nie wymaga produkcyjnych API testowanej aplikacji.

Workflow repozytorium dla PR i push na `main` uruchamia Node 24, `npm ci`, instalację Chromium i `npm run verify` z lokalnymi fixture’ami, bez uploadu artefaktów. Przykład zewnętrzny wymaga samodzielnego dostarczenia lokalnego tarballa. Oba pliki przeszły lokalne parsowanie YAML. GitHub Actions nie został zdalnie uruchomiony; Linux i macOS nie zostały zweryfikowane w tej sesji.

## Ograniczenia

Publikacja używa hard linków, więc wymaga wspierającego je lokalnego systemu plików; zapis obu raportów nie jest jedną transakcją. Usunięcie pliku tymczasowego po błędzie jest próbą best effort: błąd systemu może pozostawić ten plik. Weryfikacja obecności screenshotu sprawdza typ pliku i sygnaturę, a nie wszystkie bajty PNG, i nie gwarantuje jego późniejszej dostępności. Operacje systemu plików nie mają niezależnego twardego limitu czasu narzuconego przez runner. Przeglądarka ma limity czasu, lecz komunikacja backendu aplikacji nie podlega polityce sieciowej przeglądarki. Zrzuty mogą zawierać dane aplikacji; używaj syntetycznych danych i maskowania. Konfiguracja TypeScript jest zaufanym kodem.
