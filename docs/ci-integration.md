# Integracja z GitHub Actions

Przykład znajduje się w `examples/github-actions/faultlane.yml`. Skopiuj go do `.github/workflows/` własnego projektu i dostosuj adres gotowości oraz skrypt `start:ci`, tak aby uruchamiał odizolowaną aplikację na `127.0.0.1:3000`. Konfigurację FaultLane przygotuj i sprawdź lokalnie. `doctor` sprawdza środowisko, ale nie certyfikuje UI.

Paczki **nie opublikowano w npm**. Przykład oczekuje zaufanego tarballa pod `vendor/faultlane-local.tgz`: trzeba dostarczyć go do środowiska CI własnym sposobem, przed uruchomieniem workflow. Nie dodawaj do repozytorium prywatnych raportów ani zrzutów. Tarball utworzysz lokalnie przez `npm run build:cli && npm pack`. Przykład nie pobiera żadnej fikcyjnej publicznej wersji. Instaluje Chromium wyłącznie przez jawną komendę Playwright.

Skrypt ogranicza oczekiwanie na serwer i zatrzymuje jego grupę procesów przy wyjściu. `run` zwraca 0 dla PASS, 1 dla FAIL i 2 dla ERROR, w tym braku wymaganego dowodu. `compare` zwraca 0 bez potwierdzonej regresji, 1 przy regresji i 2 dla błędnych danych lub porównania INCOMPARABLE. Narzędzie npm może normalizować kody niezerowe; do dokładnego rozróżnienia użyj bezpośredniego `node node_modules/faultlane/dist/cli.js ...`.

Repozytoryjny `.github/workflows/ci.yml` uruchamia `npm ci`, instaluje zależności Chromium dla Linux i wykonuje `npm run verify`, w tym instalację paczki w niezależnych aplikacjach. Instalacje używają cache npm, a w razie braku metadanych mogą pobrać zależności z rejestru npm; instalator Chromium i Linux pobiera potrzebne składniki. Same testowane aplikacje używają syntetycznych fixture’ów, bez produkcyjnych API; workflow nie wysyła artefaktów. Uruchomienie lokalne nie dowodzi, że workflow przeszedł na GitHubie. Lokalne testy E2E korzystają z portu 3000; nie uruchamiaj na nim innego serwera, a w CI używaj czystego runnera.

Przeglądarka używa lokalnej aplikacji i wyłącznie jawnie dozwolonych mocków zewnętrznych API; rzeczywisty zdalny forward API nie jest dozwolony. Backend aplikacji działa poza tą ochroną. Nie używaj produkcyjnych danych ani kluczy. Zrzuty mogą zawierać dane widoczne na ekranie.
