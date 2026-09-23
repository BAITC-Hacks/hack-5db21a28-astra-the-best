# Канонический набор S2

`canonical.ts` содержит точные числа локального `docs/sources/02-rules.txt`. Из `index.ts` импортируется глубоко замороженный `scenario`, а также `datasetVersion` и `datasetHash`. Нет случайных значений или зависимости от сессии.

Hash: SHA-256 UTF-8 строки `JSON.stringify(canonicalData)` без пробелов, в порядке полей исходного объекта canonical.ts; datasetVersion и datasetHash не включаются. Изменение любого канонического поля требует новой версии и hash, согласования контракта. Проверка hash входит в tests/data/data.test.ts.

Независимые таблицы S2 и два запроса-примера: tests/data/source-fixture.ts. Они доступны другим тестам и UI fixtures; production берёт данные из `@/data`.
