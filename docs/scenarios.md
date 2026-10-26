# Scenariusze i oczekiwania

MVP zawiera dokładnie pięć typów awarii i baseline. Można skonfigurować podzbiór awarii, ale baseline jest obowiązkowy i uruchamia się jako pierwszy, również z `--scenario`.

| ID | Mechanizm | Domyślny kontrakt UI |
| --- | --- | --- |
| `baseline` | Prawdziwa odpowiedź lokalnego API | Widoczny Atlas API, dokładnie 3 projekty, brak error/loading |
| `http-500` | `route.fulfill`, status 500, JSON | Komunikat błędu serwera, Retry, loading ukryty |
| `http-429` | `route.fulfill`, 429, JSON, Retry-After | Komunikat limitu, Retry, loading ukryty |
| `slow` | Opóźnienie przed pobraniem prawdziwej odpowiedzi | Loading widoczny jeszcze podczas opóźnienia, następnie dane i brak error/loading |
| `network` | `route.abort("failed")` | Komunikat utraty połączenia, Retry, loading ukryty |
| `empty` | `route.fulfill`, 200, dokładnie `[]` | Pusty stan, brak error/loading |

`delayMs` ma zakres 500–10000 ms, a `retryAfterSeconds` 1–300. Wszystkie pasujące żądania w danym kontekście otrzymują ten sam rodzaj awarii. Retry w czasie symulacji nie wyłącza automatycznie awarii. Osobny test E2E sprawdza odzyskanie danych po usunięciu przechwycenia HTTP 500.

## Asercje

Każda asercja używa `page.getByTestId()`. `visible` sprawdza widoczność, `hidden` ukrycie lub nieobecność, `text` widoczność i zawieranie tekstu, a `count` dokładną liczbę elementów. `count` nie dowodzi widoczności; jeśli to istotne, dodaj osobną asercję. Dla `visible`/`text` identyfikator powinien wskazywać jeden element.

Konfiguracja bez asercji lub zawierająca wyłącznie negatywne oczekiwania jest odrzucana. Asercje końcowe startują po wykonaniu symulacji. Brak przechwycenia to ERROR nawet wtedy, kiedy widoczna strona wygląda poprawnie. Brak dowodu ładowania przed końcem opóźnienia to FAIL, nawet jeśli później dane się pojawiły.

## Celowy defekt

`faultlane.broken.config.ts` zmienia wyłącznie ścieżkę na `/demo?broken=http-500` i wybiera scenariusz 500. Demo zachowuje komunikat błędu oraz Retry, ale pozostawia spinner. W ten sposób narzędzie musi odróżnić częściowo poprawną obsługę błędu od spełnienia całego kontraktu. Test E2E uruchamia osobny proces CLI, sprawdza kod 1, parsuje JSON i sprawdza istnienie zrzutu błędu.
