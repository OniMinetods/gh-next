# gh-next

## Изолированные проверки issue-comments

Запускайте тесты комментариев с отдельными PostgreSQL 12 и Webdis. Compose публикует их на `127.0.0.1:55433` и `127.0.0.1:56380`. E2E подготавливает только базу `gh_next_e2e`. Интеграционные тесты создают временную базу в том же тестовом экземпляре PostgreSQL.

```powershell
docker compose -p gh-next-e2e -f tests/e2e/compose.yaml up -d --wait
pnpm install --frozen-lockfile
pnpm exec playwright install chromium --only-shell
pnpm test
pnpm test:integration
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm dlx @fission-ai/openspec validate issue-comments --strict --type change
```

Тестовые сессии автора, владельца и читателя создаёт штатный OAuth callback. Playwright и тестовая подмена `fetch` предоставляют ответы GitHub. Переменные для браузерного набора заданы в `playwright.config.ts`. Для `pnpm lint` и `pnpm build` передавайте тестовые значения через окружение процесса. В Linux-контейнере сборки можно подключиться к сети `gh-next-e2e_default` и использовать адреса `db:5432` и `webdis:7379`.

## Результаты проверки issue-comments

| Команда | Результат |
| --- | --- |
| `pnpm test` | 18 unit и 13 Playwright, включая 6 исходных браузерных сценариев |
| `pnpm test:integration` | 11 тестов |
| `pnpm exec tsc --noEmit` | Прошёл с типами из production-сборки |
| `pnpm lint` | Прошёл без замечаний ESLint |
| `pnpm build` | Standalone-сборка прошла в Linux с Node.js 22 |
| `openspec validate issue-comments --strict --type change` | Прошла через `pnpm dlx @fission-ai/openspec` |

Windows завершила компиляцию и генерацию страниц, затем standalone-упаковка вернула `EPERM` при создании символических ссылок. Итоговую сборку и последующий запуск TypeScript проверили в Linux-контейнере.
