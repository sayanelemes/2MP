# 2MP — Conversation Quality Analytics

ИИ оценивает диалог оператора по чек-листу, человек может оспорить оценку, проверяющий выносит решение, итог пересчитывается.
Бэкенд: FastAPI + SQLite. Сайт (`frontend/`) раздаётся сервером с `/`.

## Требования

Python 3.11+ (на Windows — с python.org, галочка «Add to PATH»). Интернет для импорта и записей звонков.

## Установка и запуск

Windows (PowerShell или cmd):
```
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env
.venv\Scripts\python -m uvicorn backend.main:app --port 8000
```
Linux / macOS:
```
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
.venv/bin/python -m uvicorn backend.main:app --port 8000
```
Сайт: http://localhost:8000, документация API: http://localhost:8000/docs.

## Сайт

Страницы `frontend/`: «Диалоги» (`index.html`), карточки чата и звонка (`dialog.html`, `call.html?id=...`), «Чек-листы»
(`checklist.html`), «Апелляции» (`appeals.html`), «Анализ разговора» (`analytics.html`) и «Оценка диалогов» (`run.html`).
Данные берутся из API (`frontend/js/api.js`, по странице — `frontend/js/pages/*.js`). В карточке видны баллы по критериям,
цитаты-доказательства, плеер звонка и блок «Надо было сказать» с готовой репликой оператора там, где он потерял баллы.

## `.env`

```
CQA_API_URL=<адрес из кнопки «Открыть GET для DEV» в Student Guide>
DB_PATH=cqa.db
```
В адресе есть подпись `sig=`. **`.env` не коммитить** (он в `.gitignore`). Параметр `group_id` сервер подставляет сам.

## Импорт

- DEV: на сайте или `POST /api/datasets/import` с `{"group_id": "DEV"}` → `{"imported": 65, "total": 65}`.
- Контрольный набор: то же самое с новым `group_id` от организаторов. Код менять не нужно.
- Из файла: `POST /api/conversations/upload?group_id=UPLOAD`, тело — одна запись, массив записей или полный ответ API.

Повторный импорт обновляет диалоги и не трогает оценки.

Через curl (Windows 10+ тоже есть curl):
```
curl -X POST http://localhost:8000/api/datasets/import -H "Content-Type: application/json" -d "{\"group_id\":\"DEV\"}"
```

## Чек-лист и замена критерия

`POST /api/checklists` создаёт версию 1, `PUT /api/checklists/{id}` — новую версию (старые и их оценки не меняются).
Чтобы заменить критерий: взять последнюю версию (`GET /api/checklists`), поменять критерий, отправить `PUT`, затем запустить оценку
`POST /api/evaluations` с `{"group_id": "...", "all": true, "checklist_id": "..."}` — берётся последняя версия.
При пустой базе загружается `backend/seed_checklist.json`, если он заполнен. Пример чек-листа: `tests/checklist_standard.json`.

## Тесты

```
.venv\Scripts\python -m pytest -q
```
(на Linux/macOS — `.venv/bin/python -m pytest -q`).

## Записи звонков

`GET /api/audio/{group_id}/{conversation_id}` — mp3 с перемоткой (Range → 206). Ссылка организаторов ведёт на HTML-плеер,
сервер достаёт из него временную ссылку на файл (кэш 30 минут) и проксирует её. Настоящий адрес наружу не отдаётся.
Время реплик `t` у звонков приблизительное: последние реплики на 6–29 с позже конца записи.

## Оценка через ИИ

Настройки в `.env` (смена провайдера — только здесь, код не трогается):
```
LLM_PROVIDER=gemini,groq   # gemini | groq | пусто = заглушка без сети; список — запасные при 429/5xx
LLM_MODEL=                 # пусто: gemini-3.6-flash / openai/gpt-oss-120b
GEMINI_API_KEY=            # Google AI Studio → Get API key; можно несколько через запятую (из разных проектов Google)
GROQ_API_KEY=
LLM_RPM=5                  # запросов в минуту
LLM_CONCURRENCY=1
LLM_ALLOW_VOICE=           # true — отправлять и звонки (только после разрешения организаторов)
```
Один запрос на диалог со всеми критериями, `temperature = 0`, ответ строго JSON. Ответ проверяется (`backend/validator.py`):
допустимые ответы, существующие id реплик, участок для «нет», реплика оператора для «да». Цитата сверяется с текстом реплики
(`verified`), неподтверждённая не считается ошибкой. Ошибка формата — один повтор с текстом ошибки, затем `needs_review`.
429 и 5xx — до 3 повторов с паузой. Без ключа и с пустым `LLM_PROVIDER` работает заглушка (`model = "mock"`).

Подсказка «как надо было сказать» (`suggestion`) приходит от ИИ только там, где ответ «нет» или балл частичный; `validator.py`
заменяет её пустой строкой, если она длиннее 25 слов, похожа на совет, на другом языке или повторяет реплику оператора.

Стартовый чек-лист `chat-quality` грузится из `backend/seed_checklist.json` при пустой базе.

## Переиграть разговор

В карточке потерянного критерия кнопка «Переиграть»: ИИ предлагает черновик лучшей реплики оператора, её можно изменить,
затем «Проверить ответ» — диалог заново оценивается с новой репликой и показывается, как изменился балл.
Это учебная симуляция: официальная оценка, итог и апелляции не меняются, результат хранится только в кэше `replays`.

- Тратит до 2 запросов к модели на одну переигровку (черновик + проверка). Повтор с тем же текстом берётся из кэша.
- Балл меняется, только если модель ссылается на изменённую реплику (правило шума), грубая ошибка ставит флаг и не меняет итог.
- API: `POST /api/evaluations/{id}/replay/suggest` `{criterion_id}`, `POST /api/evaluations/{id}/replay` `{criterion_id, turn_id, text}`.
- С заглушкой (`LLM_PROVIDER` пуст) переигровка недоступна: ответ 503.

## Модель и стоимость

Модель: `gemini-3.6-flash` (бесплатный тариф Google AI Studio), стоимость одной оценки $0. Лимиты бесплатного тарифа Gemini считаются на проект Google, а не на ключ: при 429 сервер берёт следующий ключ,
затем Groq (`openai/gpt-oss-120b`), поэтому в `results.json` в `model.name` могут быть обе модели. Точные суточные лимиты смотрите
в AI Studio → Usage.

## Выгрузка результатов

Формат сдачи — `results/<dev|prod>/results.json`, schema 1.0 (коды критериев `contact … critical`). В выгрузку попадает последняя
оценка каждого диалога по чек-листу `chat-quality` (`--checklist`, по умолчанию он); диалог без готовой оценки получает
`status: "error"` с причиной. Для «Нет» без цитаты номера реплик берутся из участка `checked_range` (до 5).

```
.venv/bin/python -m backend.export_results DEV dev "2MP"
.venv/bin/python -m backend.export_results <GROUP_ID> prod "2MP"
.venv/bin/python -m pytest tests/test_submission.py -q
```
Звонки уходят в ИИ только при `LLM_ALLOW_VOICE=true` в `.env` (после разрешения организаторов), иначе они в выгрузке — `error`.

Порядок на контрольном этапе: импорт prod (`POST /api/datasets/import` с новым `group_id`) → оценка (`POST /api/evaluations`,
дождаться `GET /api/jobs/{id}`) → выгрузка prod → `git push` → только после этого заменять критерий через интерфейс.
