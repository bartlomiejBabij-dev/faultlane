# Porównywanie przebiegów

Po dwóch przebiegach z tą samą konfiguracją podaj ich pliki JSON:

```sh
npm exec --no -- faultlane compare --base reports/IDENTYFIKATOR_1/results.json --head reports/IDENTYFIKATOR_2/results.json
```

Komenda nie modyfikuje wejścia. Tworzy nowy katalog `comparisons/comparison-<uuid>/` zawierający `comparison.json` i `comparison.md`. Katalog porównań jest ignorowany przez Git w repozytorium FaultLane. Domyślnie nie wysyłamy plików poza komputer. Nowe raporty zawierają skrót konfiguracji scenariusza; surowa konfiguracja nie jest kopiowana. Użyj tych samych adresów, ustawień, sekwencji i asercji w obu przebiegach. Zmiana aplikacji lub konfiguracji może uniemożliwić porównanie.

`REGRESSION` oznacza PASS → FAIL, `IMPROVEMENT` oznacza FAIL lub ERROR → PASS, a `UNCHANGED` zachowany status. `NEW` i `REMOVED` wskazują dodane lub brakujące scenariusze. `INCOMPARABLE` oznacza brak wystarczającej tożsamości, różnicę konfiguracji lub przejście związane z błędem wykonania, z którego nie da się wywnioskować regresji UI. Czas wykonania nie jest kryterium regresji. Liczby oczekiwanych i przechwyconych requestów endpointów są pokazane wyłącznie, gdy zapisano je w źródle.

Raporty historyczne v1–v3 nadal są czytane, lecz starsze raporty bez skrótu tożsamości dają `INCOMPARABLE`; nazwa scenariusza sama nie wystarcza. Stan dowodu opisuje chwilę oryginalnego testu. Porównanie dodatkowo sprawdza obecność zwykłego pliku i nagłówek PNG oraz zapisuje nazwę pliku tylko po takiej kontroli; nie gwarantuje, że plik pozostanie dostępny później ani że cały obraz jest poprawny. Nie tworzy odsyłaczy do niezweryfikowanych zrzutów.

Kody: `0` — bez potwierdzonej regresji, `1` — potwierdzona regresja, `2` — niepoprawne dane, nieporównywalny scenariusz albo nieudany lub niedostępny wymagany dowód. Przy mieszance regresji i błędu dowodów lub INCOMPARABLE pierwszeństwo ma kod 2, a lista nadal pokazuje regresję. Błąd odczytu, brak pliku i nieprawidłowy JSON również dają 2. `comparison.json` jest maszynowym wynikiem; własny czytnik musi sprawdzić, czy w katalogu nie ma `.faultlane-report-pending`. Standardowe wyjście CLI jest czytelne dla człowieka.
