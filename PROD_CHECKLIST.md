# Контрольный набор (prod): что делать по шагам

Срок: набор приходит через 23 часа после старта, результаты должны быть запушены до стоп-кода (24 часа). Локального commit недостаточно.

## 0. Заранее
- Сервер запущен локально (`.venv/bin/python -m uvicorn backend.main:app --port 8000`), в `.env` есть ключ модели (`ANTHROPIC_API_KEY`) и `LLM_PROVIDER`.
- Репозиторий открытый, ссылка передана организаторам: https://github.com/sayanelemes/2MP
- `.venv/bin/python -m pytest -q` проходит.

## 1. Загрузить набор
Новый `group_id` от организаторов (ниже `PROD`; если другой, везде подставьте его).
- По API: сайт → «Оценка диалогов» → «Загрузить другой набор» → `PROD` → «Загрузить по API». Нужен `CQA_API_URL` в `.env`.
- Или файлом: сохранить ответ API в `prod.json` и «Импорт JSON» (в поле group_id указать `PROD`).
- Проверить: `curl -s "http://localhost:8000/api/conversations?group_id=PROD"` возвращает ровно 10 диалогов.

## 2. Заменить критерий (если организаторы просят)
Сайт → «Чек-листы»: правка одного критерия, сохранение новой версии. Код менять не нужно. Оценка берёт последнюю версию.

## 3. Оценить
Сайт → «Оценка диалогов» (`?g=PROD`) → «Оценить», или:
```bash
curl -s -X POST http://localhost:8000/api/evaluations -H "Content-Type: application/json" -d '{"group_id":"PROD","all":true,"checklist_id":"chat-quality"}'
```
Все 10 должны быть в статусе `done`. Ошибки и `needs_review` смотреть на странице «Оценка» (причина написана); при 429 подождать и запустить снова.

## 4. Выгрузить
```bash
.venv/bin/python -m backend.export_results PROD prod "2MP"
```
Файл: `results/prod/results.json`.

## 5. Проверить перед push
- Ровно 10 записей, ID точно как в API, без повторов.
- `model.name` — реально использованная модель.
- Ошибочные диалоги: `status: "error"`, `criteria: []`, `score: null`, причина в `error` (нулём не подменять).
- JSON в UTF-8 (команда выше так и пишет).
```bash
.venv/bin/python -c "import json;d=json.load(open('results/prod/results.json',encoding='utf-8'));r=d['results'];print(len(r),len({x['conversation_id'] for x in r}),[x['status'] for x in r])"
```

## 6. Commit и push
```bash
git add results/prod/results.json
git commit -m "Результаты prod"
git push origin master
git log origin/master --oneline -1   # убедиться, что коммит на GitHub
```
Открыть https://github.com/sayanelemes/2MP/blob/master/results/prod/results.json и убедиться, что файл виден без входа.
