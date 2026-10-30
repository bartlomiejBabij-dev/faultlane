# Audyt FaultLane v0.5.1 — 30 października 2026

## Punkt wyjścia

Przed zmianami Git był czysty na `main`, a pakiet miał wersję 0.5.0. Zapisano SHA-256 2095 istniejących plików w `reports/` do późniejszego porównania. Bazowe `npm run verify` zwróciło **0**: 189 testów jednostkowych, 42 E2E, typecheck, lint, build aplikacji i CLI oraz instalację tarballa w niezależnych fixture’ach. Pierwszy przebieg również przeszedł te etapy, ale jego końcowy kod nie został odebrany po wygaśnięciu sesji; dlatego pełne `verify` powtórzono i bezpośrednio odczytano kod 0.

Środowisko: Windows, Node 24.21.0, npm 12.2.0, lokalny dysk NTFS. WSL nie jest zainstalowany, a Docker nie był dostępny. Nie wykonano commita, pusha, publikacji ani wdrożenia. Niezweryfikowany publiczny odczyt strony Actions zwrócił 404, a dostępne nazwy narzędzia GitHub nie zostały obsłużone przez backend; nie stanowi to wyniku GitHub Actions.

## Limity i publikacja

Pobranie PNG ma limit 5 s. Każdy zapis pliku ma łącznie 10 s na utworzenie katalogu, plik tymczasowy, zapis, synchronizację, zamknięcie, weryfikację i publikację; sprzątanie ma dodatkowe 2 s. Tworzenie katalogu runu i kontrole przed zapisem mają osobne limity po 10 s. Serializacja raportu lub porównania pracuje w osobnym współdzielonym wątku z limitem 10 s. Budżety są mierzone monotonicznie i sprawdzane również po opóźnionym callbacku timera. Kod `EVIDENCE_TIMEOUT` oznacza przekroczenie limitu; `EVIDENCE_UNSUPPORTED` — brak obsługi bezpiecznej publikacji.

Limit kończy oczekiwanie, nie udaje przerwania syscalla. Dla operacji `writeFile` i `readFile` przekazywany jest `AbortSignal`; Node nie gwarantuje nim anulowania pojedynczego żądania systemowego. Kolejne etapy nie rozpoczynają się po timeoutcie. Spóźniony uchwyt lub plik tymczasowy są sprzątane po zakończeniu operacji; gdy spóźni się hard-link, runner próbuje usunąć wyłącznie plik o tym samym inode. Sprzątanie może się nie udać lub samo przekroczyć limit. Synchronouszne uruchomienie wątku i klonowanie wiadomości nie podlegają fizycznemu przerwaniu timerem; spóźniony wynik jest odrzucany po powrocie sterowania.

Przed publikacją raportu powstaje `.faultlane-report-pending`. Panel i `compare` nie uznają raportu z tym znacznikiem za ukończony, nawet jeżeli późny `results.json` już fizycznie istnieje. Nowe JSON-y zawierają `publicationProtocol: pending-marker-v1`. Własne narzędzia odczytujące JSON bez czytnika FaultLane **muszą również sprawdzać znacznik**; nie kontrolujemy zewnętrznych czytników. Jeżeli obydwa zweryfikowane pliki zapisano, a samo usunięcie znacznika nie zakończyło się w 2 s, zwracany jest stan `SAVED / PENDING` i ostrzeżenie `REPORT_VISIBILITY_TIMEOUT`; kod procesu nadal opisuje scenariusze. Natychmiastowa awaria usunięcia znacznika kończy komendę kodem 2. Dwa pliki raportu nie są jedną transakcją.

Osobne pola `captureStatus` i `persistenceStatus` zachowują informację o etapie awarii zrzutu. Zachowanie UI pozostaje w dotychczasowym polu statusu, a zapis raportu jest oddzielnym wynikiem zwracanym przez runner. Wymagany nieudany lub pominięty dowód daje kod 2, również równocześnie z FAIL UI. `compare` zachowuje widoczny wynik regresji, lecz zwraca 2 dla nieudanych lub niedostępnych dowodów.

Na lokalnym NTFS utworzenie hard-linka i odmowę drugiego linka na istniejącą nazwę (`EEXIST`) sprawdzono rzeczywiście. Linux/ext4 i systemy bez hard-linków nie zostały tu uruchomione; brak obsługi jest testowany kontrolowanym błędem. Nie ma fallbacku przez `copyFile` ani zwykły `rename`: Node nie gwarantuje atomowości kopiowania, a rename może zastąpić plik. Źródła: [Node.js fs](https://nodejs.org/docs/latest-v24.x/api/fs.html), [Microsoft NTFS](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions), [Linux link(2)](https://man7.org/linux/man-pages/man2/link.2.html).

## Odtworzenia i powtarzalność

Pierwotnego incydentu `EVIDENCE_WRITE` z v0.4 nie odtworzono i nie ustalono jego przyczyny. Kontrolowane testy wymusiły zawieszenie operacji i serializatora, opóźniony zrzut, zapis i publikację, `EACCES`, `ENOSPC`, przerwany zapis, kolizję, błąd sprzątania oraz `EOPNOTSUPP`. Test późnego `results.json` sprawdził faktycznie istniejący plik z PASS i potwierdził, że panel i `compare` go odrzucają przy aktywnej kwarantannie. Rzeczywisty E2E zachowuje jednoczesny FAIL UI i błąd zrzutu z kodem CLI 2.

Osobny przebieg E2E wymusił zawieszenie publikacji w rzeczywistym procesie CLI: raport wskazał błąd zapisu, diagnostyka zawierała `EVIDENCE_TIMEOUT`, a kod procesu wyniósł 2. Pierwsza próba tego testu wykazała błąd samego testu na Windows: argument `--import` wymaga adresu `file:`, nie ścieżki `C:\...`. Po poprawieniu sposobu uruchomienia test przeszedł bez zmniejszenia wymagań.

Początkowo współbieżne testy ujawniły dwa przekroczenia limitu Vitest przy każdorazowym uruchamianiu nowego wątku serializacji TypeScript. Wątek serializacji jest teraz współdzielony i przerywany przy timeoutcie; po zmianie pełny zestaw jednostkowy przeszedł 202/202. Nie osłabiono istniejących asercji.

Wykonano sześć wybranych testów E2E po trzy razy: recovery 500, 429 → 429 → 200, cross-origin, wieloendpointowość, równoległe przebiegi i porównanie. **18/18 PASS, 0 FAIL**. Każdy z trzech testów równoległych uruchamiał dwa niezależne runy, sprawdzając oddzielne katalogi, liczniki, zrzuty, raporty i porównanie. Ograniczona liczba powtórzeń nie dowodzi braku wszystkich wyścigów.

## CI i dalsza weryfikacja

Workflow uruchamia się dla push i pull request, ma `contents: read`, używa Node 24 oraz jawnej instalacji Chromium z zależnościami, a następnie `npm run verify`. Testy wykorzystują lokalne dane syntetyczne i nie wysyłają artefaktów. Dla procesów fixture’ów dodano osobne grupy procesów na Unix i ograniczone oczekiwanie na ich zakończenie; Windows sprawdzono lokalnie, zachowania Linux nie zweryfikowano. Instrukcja samodzielnego uruchomienia i sprawdzenia przebiegu przez właściciela jest w [ci-integration.md](ci-integration.md).

## Końcowa weryfikacja 0.5.1

Po podniesieniu wersji ponownie wykonano `npm run verify`: kod **0**, 203/203 testy jednostkowe, 43/43 E2E, build aplikacji i CLI oraz `npm run test:package` zakończony `Package smoke PASS`. Skrypt `verify` uruchomił kolejno `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`, `npm run build:cli` i `npm run test:package`. Paczkę rzeczywiście zainstalowano poza repozytorium w fixture’ach Next.js, katalogu i React/Vite; sprawdzono komendy CLI, kody 0/1/2, porównanie raportów oraz blokadę rzeczywistych żądań do serwera cross-origin. `npm pack --dry-run` również zwrócił **0**, wykazując 26 plików, w tym CLI i worker serializacji, bez raportów oraz PNG. Nie dokonano publikacji.

Dodatkowo na Windows zainstalowano rzeczywisty tarball 0.5.1 w nowym, pustym projekcie, wskazując nowy katalog cache przez `npm install --cache ... --prefix ...`; instalacja i zainstalowane `faultlane --version` zwróciły kod 0. Nie jest to test pustego cache na Linuxie.

Porównanie SHA-256 istniejących przed pracą plików raportów: **2095 sprawdzonych, 0 zmienionych, 0 brakujących**. Odrębna lista kontrolna bety istnieje, ale jej punkty dotyczące rzeczywistego Linux CI i projektu uczestnika bety wymagają wykonania przez właściciela; nie uznajemy ich za odhaczone na podstawie lokalnego Windows.
