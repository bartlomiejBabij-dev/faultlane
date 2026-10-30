# Lista kontrolna prywatnej bety

- [ ] Zbuduj i zainstaluj lokalny tarball we własnym, oddzielnym projekcie; sprawdź `faultlane --version` i `--help`.
- [ ] Uruchom aplikację testową na loopback z danymi syntetycznymi. Sprawdź jawne asercje, endpointy, liczniki i limity.
- [ ] Uruchom `faultlane doctor`, a następnie `faultlane run`. Doctor nie jest certyfikatem UI.
- [ ] Obejrzyj JSON, Markdown i zapisane zrzuty; upewnij się, że nie zawierają prywatnych danych. `SAVED` dotyczy oryginalnego zapisu, `SKIPPED` braku próby, `FAILED` błędu dowodu.
- [ ] Sprawdź osobno `captureStatus` i `persistenceStatus` oraz brak `.faultlane-report-pending`. Własny odczyt JSON musi odrzucać katalog z tym znacznikiem.
- [ ] Wprowadź kontrolowany defekt fixture i potwierdź rzeczywisty FAIL oraz kod 1; po naprawie wykonaj kolejny przebieg.
- [ ] Porównaj dwa przebiegi o identycznej konfiguracji, sprawdź `REGRESSION`, `IMPROVEMENT` i kody procesu. Historyczne raporty bez tożsamości są nieporównywalne.
- [ ] Skonfiguruj CI zgodnie z [instrukcją](ci-integration.md), uruchom zaufaną paczkę lokalną i zweryfikuj zachowanie procesu w swoim repozytorium.
- [ ] Upewnij się, że backend nie łączy się z produkcją, a cross-origin API jest tylko mockowane na jawnej liście. Nie przekazuj żadnych kluczy produkcyjnych.
- [ ] Wyklucz `reports/`, `comparisons/`, `test-results/`, `playwright-report/`, `.env*` oraz prywatne PNG z Git i artefaktów CI.
- [ ] Przy `EVIDENCE_WRITE` lub `EVIDENCE_TIMEOUT` sprawdź etap i kod w raporcie, dostępność katalogu, miejsce na dysku oraz zamknięcie strony. `EVIDENCE_UNSUPPORTED` wymaga systemu plików z hard-linkami; brak PNG nigdy nie jest sukcesem. Po timeoutcie I/O może jeszcze trwać. Przy `BROWSER_LAUNCH` jawnie zainstaluj Chromium; przy `API_NOT_OBSERVED` sprawdź stronę, matcher i akcję.
- [ ] Potwierdź faktyczny przebieg GitHub Actions na Linuxie według [instrukcji](ci-integration.md); sama lokalna walidacja YAML nie wystarcza.

Pytania do użytkownika: Czy instalacja była jasna? Czy oczekiwania i polityka sieci dały się opisać bez zgadywania? Czy raport wskazał rzeczywisty problem? Czy porównanie i kod CI były zrozumiałe? Jakie dane lub kroki wymagały ręcznej pracy? Informacji zwrotnej nie zbieramy automatycznie.
