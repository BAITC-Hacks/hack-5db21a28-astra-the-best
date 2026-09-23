# Работа агентов в HackAlem

Перед работой прочитай `PLAN.md` и `docs/AGENT_PROTOCOL.md`.

## Обязательное правило владения задачей

**До изменения файлов по любому пункту плана агент обязан взять этот пункт и подписаться:** создать запись через `scripts/claim-task.ps1` со своим именем, уникальным ID сессии и временем. Сообщение только в чате не заменяет запись. Без успешного захвата работать над пунктом запрещено.

Единый реестр: `D:\HackAlem\coordination\claims\<ID>.json`. Перед началом прочитай записи зависимостей и занятых задач. Не изменяй чужие файлы и записи; соблюдай области владения из плана. Не перехватывай задачу по таймауту. При блокировке запиши причину и передай контекст по протоколу.

Claude должен также прочитать `CLAUDE.md`. Разные worktree обязаны пользоваться этим же абсолютным реестром; отдельные копии реестра не координируют агентов.

Статусы выполнения находятся в реестре, а не в копиях таблицы плана. `done` ставится только с результатами проверок. Изменения плана и контрактов сначала согласуются с владельцами затронутых задач.

## Контекст Octarin

Для нетривиальной работы в незнакомой области используй доступный `memory_recall`; перед изменением существующих незнакомых файлов — `memory_for_file`, при необходимости `file_history`. Поиск должен относиться к этому проекту: память других проектов не является его требованиями. Если инструмент недоступен или нет релевантных записей, продолжай по локальным документам. Долговременные решения записывай с привязкой к репозиторию и файлам. Не отправляй секреты в память.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
