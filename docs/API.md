# API и интеграционный контракт v1

Источник типов: `src/contracts/index.ts` (единственная точка импорта `@/contracts`). Запросы simulate и analyze одинаковы; структурная схема: `src/contracts/scenario-request.schema.json`. Все объекты запросов строгие; дополнительные поля запрещены. Максимум тела simulate/analyze — 16 KiB, optimize — 1 KiB. Только JSON, числа конечные. Непредусмотренные поля ответа не добавлять без согласования.

## GET /api/scenario

200: `ScenarioResponse`, без envelope. `datasetVersion` — `astana-s2-v1`; `datasetHash` — hex SHA-256 канонического JSON содержимого без datasetVersion/datasetHash. P03 фиксирует этот hash. Бюджет 100, горизонт 8, synthetic=true. Все массивы районов/показателей/мер имеют порядок констант контракта. Меры содержат полные эффекты до лага. Синергии и конфликты передаются в rules. Данные неизменяемы и одинаковы для всех сессий.

## POST /api/simulate

```json
{"datasetVersion":"astana-s2-v1","decisions":[{"measureId":"M7","districtId":"nura"},{"measureId":"M8","districtId":"nura"},{"measureId":"M10","districtId":"nura"},{"measureId":"M12"},{"measureId":"M5","districtId":"saryarka"}]}
```

200: `SimulationResponse`. Поля:

| Поле | Смысл |
|---|---|
| datasetVersion, scenarioId | Версия и идентичность сценария |
| decisions | Нормализованы по числовому порядку M1–M14; для города districtId отсутствует |
| cost, remainingBudget | Стоимость один раз за меру и 100−cost |
| baseline, result | `ScoreSnapshot` до/после: 5 районов × 10 показателей, score каждого района, weightedAverage, minimumDistrictScore, weakestDistrictIds, criticalIndicators, criticalCount, score |
| scoreDelta | result.score−baseline.score |
| ledger.measures | Отдельная запись для каждой затронутой пары район/показатель каждой меры; fullEffect, lagQuarters, realizedFraction, realizedEffect |
| ledger.synergies | По одной записи на сработавшую пару, целевой район и фиксированные effects |
| ledger.indicators | Все 50 пар: before, measureEffect, synergyEffect, unclipped, after, delta |

`scenarioId` = `${datasetVersion}:${JSON.stringify(sortedDecisions)}`. Решения сортируются по индексу в MEASURE_IDS; объекты создаются в порядке ключей measureId, districtId (второй отсутствует для города). Это стабильный идентификатор, не секрет и не hash. Клиент может воспроизвести его, перестановка мер не меняет идентичность. Версия данных обязана меняться вместе с каноническими данными.

Контрольный ответ: cost=95, remainingBudget=5, baseline.score=52.55768, result.score=56.54307, scoreDelta=3.98539 (IEEE-754, допуск 1e−8). Минимум Нура, критических значений после мер нет. UI округляет только отображение.

## POST /api/analyze

Тот же `ScenarioRequest`, только валидные пять мер. Сервер заново валидирует и рассчитывает сценарий; клиентский результат не принимается. 200: `AnalyzeResponse` с datasetVersion, scenarioId, provider, model, analysis, facts. analysis содержит summary, strengths[], risks[], consequences[], recommendation; каждая запись `{text, factIds}`. Массивы содержат 1–4 записи, text 1–1200 символов, factIds 1–8 существующих ID. Все перечисленные поля обязательны, лишние запрещены.

Текст русскоязычный. Для чисел модель предпочтительно возвращает шаблоны `{{score-after}}` и другие `{{ID_факта}}`: ID должен существовать и присутствовать в `factIds` того же утверждения. Сервер подставляет значение и единицу из факта; клиент получает готовый текст. Обычные числовые литералы также допустимы, если совпадают со значениями процитированных фактов и совместимы с распознанными единицами; баллы и проценты допускают округление. UI выводит связанные `facts` рядом с текстом: label, value, unit. Сервер проверяет структуру, ссылки, шаблоны, числовые значения и известные идентификаторы. Это не доказательство смысловой истинности: корректное число может сопровождаться ошибочным выводом или причинным объяснением. Содержание реального ответа проверяется отдельно при приёмке. Нельзя рендерить model text как HTML.

`AnalysisInput` — внутренний серверный контракт: scenario, selectedMeasures (цены, лаги, эффекты), facts, disclaimer. Провайдер отправляет модели `facts`, сокращённые `selectedMeasures` (ID, название, стоимость в млрд ₸, лаг) и disclaimer; весь `scenario` не передаётся. Facts формируются сервером: бюджет и районные суммы, Score до/после и дельта, районные баллы, слабейший район, количество критических показателей и порог, значения до/после и дельты изменившихся показателей, лаги и реализованные доли, синергии. P45 расширяет этот контекст фактами районных баллов до/после и дельты (`district-before-*`, `district-change-*`), всеми оставшимися критическими значениями (`critical-*`, включая неизменившиеся before/after/change) и вкладом каждой меры (`effect-<measure>-<district>-<indicator>`). Вклад взят из ledger с учётом лага, до ограничения шкалой; это не отдельный вклад в нелинейный городской Score. Наличие этих полей сверено с исходником P45; живой вызов P43 ниже в приёмке относится к прежнему контексту. Результат AI никогда не перезаписывает числовые поля SimulationResponse.

Рекомендованный UI lifecycle: idle → loading(scenarioId) → success(response) / error(scenarioId,error). Принимать ответ только для текущего scenarioId. Переключение режима город/отчёт не повторяет вызов. Ошибка и retry AI не сбрасывают математический результат. По умолчанию модель — `gpt-6-sol`; для OpenAI Sol используются `reasoning_effort: none` и `max_completion_tokens: 2500`. Настройки переопределяются серверными переменными окружения из `.env.example`. Провайдер допускает одну попытку исправить невалидный отчёт в пределах общего timeout (по умолчанию 30 секунд, `AI_TIMEOUT_MS` ограничен диапазоном 1–60 секунд). Текст JSON-ответа ограничен 30 000 символов; отсутствие ключа — явная ошибка, без fake-анализа. Ограничитель частоты хранится в памяти экземпляра сервера, поэтому не является общим лимитом для нескольких serverless-инстансов.

## POST /api/optimize

Строгий JSON `{ "datasetVersion": "astana-s2-v1", "datasetHash": "<hash из /api/scenario>" }`, максимум 1 KiB. Цены, решения и ограничения клиента не принимаются. Несовпадение версии или hash возвращает 409 `DATASET_VERSION_MISMATCH`.

200: `datasetVersion`, `datasetHash`, `method: "exhaustive"`, `checkedCandidates`, `simulation`. Сервер перебирает допустимые сценарии и возвращает результат канонического расчёта. Ответ переиспользуется в памяти экземпляра для той же версии/hash; неуспешный поиск можно повторить. Сам endpoint не вызывает LLM: UI отдельно запрашивает `/api/analyze` для найденного плана. Подробности, правила разрешения равенства и проверенный максимум — в [OPTIMIZER.md](OPTIMIZER.md).

## Ошибки

Все ошибки: `ErrorResponse` = `{error:{code,message,issues:[{code,message,measureIds?,districtId?,path?}]}}`. Score при ошибке отсутствует. message на русском без stack trace/ключей. Для нескольких правил верхний code равен code первой issue. Порядок: формат → версия → ID → количество/дубли/районы/бюджет/направления/конфликты.

| HTTP | code |
|---|---|
| 400 | INVALID_JSON, INVALID_FORMAT |
| 413 | REQUEST_TOO_LARGE |
| 409 | DATASET_VERSION_MISMATCH |
| 422 | UNKNOWN_MEASURE, UNKNOWN_DISTRICT, DECISION_COUNT, DUPLICATE_MEASURE, DISTRICT_REQUIRED, DISTRICT_FORBIDDEN, BUDGET_EXCEEDED, DIRECTION_LIMIT, INCOMPATIBLE_MEASURES |
| 429 | AI_RATE_LIMITED (Retry-After) |
| 503 | AI_NOT_CONFIGURED, AI_UNAVAILABLE |
| 504 | AI_TIMEOUT |
| 502 | AI_INVALID_RESPONSE |
| 500 | INTERNAL_ERROR |

Структурная схема допускает неизвестные строковые ID, чтобы domain вернул понятные UNKNOWN_* (422). 0/4/6 решений имеют корректную структуру, но нарушают финальные правила (422). null, лишние ключи, числа вместо строк — 400. districtId у города — 422. Произвольные поля цены/Score/бюджета — 400.

## Экспорты для UI и карты

P03: `@/data` экспортирует `scenario` (ScenarioResponse), `datasetVersion`, `datasetHash`. P04: `@/domain/validation` экспортирует `validateDecisions(decisions, {mode:'draft'|'final', scenario?}) → ValidationResult`, `parseScenarioRequest(input:unknown)`, `validateScenarioRequest(input:unknown, scenario?)`. Последние два возвращают discriminated union `{ok:true,request}` или `{ok:false,status,body:ErrorResponse}`. parse проверяет только форму; validate также версию и финальные правила. P04 `@/domain/simulation` экспортирует `simulate(request, scenario?) → SimulationResponse` (только после валидации), `calculateSnapshot(districts, scenario?) → ScoreSnapshot`, `scenarioId(request) → string`.

CityViewProps поддерживает selectedDistrictId, selectedMeasureId, decisions, preview, result, comparison, indicatorLayer, camera, active и callbacks. Карта не вычисляет бизнес-правила; для draft-подсказок применяется общий валидатор. Координаты не добавляются в Decision. Preview/result не подменяют друг друга: preview иллюстрирует выбор, result относится к полному валидному сценарию. P13 согласует подключение эффектов P14 в собственной области.

P02 app shell: стандартный default export Page из src/app/page.tsx, RootLayout из src/app/layout.tsx; импорт globals.css в layout. P09 заменяет начальный Page своей интеграцией. Общие команды: dev/build/start/lint/typecheck/test/test:e2e. Все frontend/map зависимости включаются в P02; дальнейшие изменения конфигов через владельца P09.
