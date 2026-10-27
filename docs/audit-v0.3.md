# Weryfikacja FaultLane v0.3 — 27 października 2026

## Punkt wyjścia

Przed zmianami wykonano `npm run verify`: kontrola typów, lint, **47 testów jednostkowych, 20 E2E i build Next.js** zakończyły się kodem 0. Drzewo Git było czyste. Zapisano SHA-256 506 istniejących plików w `reports`; końcowe porównanie wykazało **0 zmienionych lub brakujących plików**.

## Końcowe kontrole

| Wykonana komenda | Wynik |
| --- | --- |
| `npm run typecheck` | kod 0 |
| `npm run lint` | kod 0, zero ostrzeżeń ESLint |
| `npm test` | kod 0, **78 testów**, 5 plików |
| `npm run test:e2e` | kod 0, **20 E2E** |
| `npm run build` | kod 0, aplikacja produkcyjna zbudowana |
| `npm run build:cli` | kod 0, JavaScript ESM i deklaracje typów |
| `npm run test:package` | kod 0 / Package smoke PASS, dwie zewnętrzne instalacje |

`npm run verify` uruchamia wszystkie powyższe kontrole po kolei. Po ostatnich poprawkach budowania paczki wykonano ponownie test paczki oraz cały ciąg typecheck → lint → unit → E2E → build. Nie pomijano uszkodzonych scenariuszy ani testu panelu.

Test paczki rzeczywiście wykonał `npm pack --dry-run --ignore-scripts --json`, utworzył tarball i zainstalował go przez `npm install --offline --ignore-scripts --no-audit --no-fund --save-dev <tarball>`. Następnie uruchomił lokalnie zainstalowany bin przez `npm exec --offline --no -- faultlane ...`, bez używania źródłowego CLI. Szczegółowa lista argumentów, kodów wyjścia, katalogów i raportów pozostaje w lokalnym `.package-tests/latest.json`; plik nie trafia do dystrybucji.

## Przebiegi na niezależnych aplikacjach

| Aplikacja | API i interakcje | Poprawne recovery | Jawny defekt |
| --- | --- | --- | --- |
| Harbor / osobny Next.js | `/api/shipments`, Fetch shipments / Reconnect | baseline PASS, HTTP 500 → prawdziwe 200 PASS | Retry bez requestu: FAIL, kod CLI 1 |
| Cedar / Node HTTP + HTML | `/api/inventory`, Search inventory / Try again | baseline PASS, HTTP 500 → prawdziwe 200 PASS | pozorny sukces UI bez requestu: FAIL, kod CLI 1 |

Obie aplikacje były kopiowane do świeżych katalogów tymczasowych poza repozytorium, ze spacjami w nazwach. Uruchomiono ich własne serwery. Potwierdzono `--help`, `--version`, `init --yes`, `doctor`, `run`, zachowanie istniejącej konfiguracji, dokładną kopię `.bak`, odrzucenie niekompletnej inicjalizacji i ponowienie tej samej konfiguracji po usunięciu jawnego defektu.

Oddzielne procesy sprawdziły kod 2 i kontrolowane komunikaty dla brakującej konfiguracji, nieprzechwyconego API, nieobecnego Chromium, niedostępnego serwera, nieprawidłowej strony oraz uszkodzonej instalacji modułu Playwright. Pomoc nadal działa przy brakującym Playwright. Sprawdzono deklaracje typów zainstalowanej paczki w rygorystycznym trybie TypeScript NodeNext, bez `skipLibCheck`. Markdown, JSON i pliki PNG zostały odczytane; poprawne recovery dowodzi zapisów `simulated/500` i `forwarded/200` oraz wykonanych kroków.

Kreator interaktywny uruchomiono także w prawdziwym terminalu Windows: wykrył Next.js, zebrał pola, wygenerował konfigurację recovery i zakończył się kodem 0. Jednostkowo sprawdzono ponowne pytanie po błędnym URL, walidację lokatorów, odmowę traversal/junction, import konfiguracji ESM/CommonJS i brak zapisu podczas diagnostyki katalogu.

## Usterki znalezione i poprawione podczas pracy

- CommonJS wymaga rozpakowania dodatkowego `default` po imporcie przez tsx.
- W osobnej aplikacji Next.js kliknięcie przed hydratacją nie wywoływało API. Runner zwracał poprawny ERROR. Przykład blokuje przycisk do gotowości; ograniczenie opisano w instrukcji.
- Typy ESM potrzebują rozszerzeń importów, podczas gdy źródła panelu używają rozwiązywania modułów przez bundler. Rozszerzenia są teraz dodawane w AST deklaracji podczas budowania paczki, bez zmiany wspólnych źródeł.
- Część przeglądarkowa jest ładowana osobno, aby brak Playwright dawał kontrolowany wynik doctor zamiast błędu startu całego CLI.

Próba automatycznego przeliczenia lockfile w tym środowisku została zatrzymana przez blokadę pobierania opcjonalnego pakietu Tailwind WASM. Nie dodano jego pobierania ani obejścia ograniczeń. Zachowano istniejące wersje i integralności zależności, zaktualizowano klasyfikację runtime/dev oraz manifest. Rzeczywista instalacja tarballa wraz z zależnościami runtime z lokalnego cache zakończyła się poprawnie w obu projektach.

## Zakres potwierdzenia

Najważniejsze utworzone lub zmienione pliki:

| Obszar | Pliki |
| --- | --- |
| Polecenia i onboarding | `src/runner/cli.ts`, `cli-args.ts`, `cli-error.ts`, `init.ts`, `doctor.ts`, `project.ts`, `paths.ts` |
| Integracja z istniejącym runnerem | `src/runner/load-config.ts`, `src/runner/browser.ts` |
| Paczka i narzędzia budowania | `package.json`, `package-lock.json`, `scripts/build-cli.mjs`, `tsconfig.cli.json`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore` |
| Testy | `tests/unit/onboarding.test.ts`, `scripts/test-package.ts` |
| Niezależny Next.js | `examples/next-orders/package.json`, `next.config.mjs`, `tsconfig.json`, `app/layout.tsx`, `app/orders/page.tsx`, `app/api/shipments/route.ts` |
| Istniejący katalog Cedar | `examples/catalog/package.json`, `examples/catalog/start.ts` |
| Dokumentacja | `README.md`, `AGENTS.md`, `docs/getting-started.md`, `docs/architecture.md`, `docs/scenarios.md`, `docs/limitations.md`, `docs/audit-v0.3.md` |

Środowisko: Windows, Node.js 24.21.0, npm 12.2.0. Implementacja używa przenośnych API Node; nie deklarujemy wykonania testów na macOS, Linux ani innych liniach Node. Nie wykonywano publicznego `npx faultlane`, publikacji npm, deployu, commita ani pusha. Paczka pozostaje `private: true`.

Onboarding wymaga 5 czynności po przygotowaniu tarballa i zależności aplikacji: instalacji CLI, startu aplikacji, init, doctor, run; brak Chromium dodaje jedno jawne polecenie. Nie mierzono czasu wdrożenia człowieka i nie podajemy fikcyjnego wyniku czasowego.
