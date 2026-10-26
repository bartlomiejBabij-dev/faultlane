# FaultLane — zasady pracy

- Projekt jest lokalnym narzędziem developerskim. Zachowaj ograniczenie HTTP(S) loopback i brak integracji chmurowych.
- Runner znajduje się w `src/runner`, demo w `src/app/demo`, panel w `src/app/results`, bezpieczny odczyt plików w `src/lib/report-store.ts`.
- Zod waliduje konfigurację i odczytywane raporty. Zachowaj strict TypeScript i jawne typy wyników.
- PASS wymaga przechwyconego API, wykonanej symulacji i wszystkich jawnych asercji UI. Nie zastępuj ich samą nawigacją ani brakiem błędów.
- Każdy scenariusz używa świeżego kontekstu Chromium; interceptory rejestruj przed nawigacją. Zachowaj skończone limity czasu.
- Nie zapisuj surowych logów, treści żądań, cookies, nagłówków ani stack trace z aplikacji. Zrzuty testuj na danych syntetycznych.
- `broken=http-500` jest wyłącznie jawnym demonstracyjnym przełącznikiem. Nie włączaj go domyślnie.
- Przy zmianach runnera wykonaj `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`. Przy zmianach aplikacji sprawdź również `npm run build`.
- Nie dodawaj testów pozorujących sukces. Test błędnego demo musi weryfikować rzeczywisty FAIL i niezerowy kod CLI.
- Dokumentacja i podsumowania dla właściciela projektu są po polsku. Komunikaty produktu mogą pozostać po angielsku.
