"""Подсказка «как надо было сказать»: плохая фраза заменяется пустой строкой, оценка не страдает."""
import pytest

from backend import validator

YES_NO = {"id": "c07", "type": "yes_no"}
SCALE = {"id": "c04", "type": "scale", "steps": [{"value": 20}, {"value": 10}, {"value": 0}]}
CRITICAL = {"id": "c08", "type": "yes_no", "is_critical": True}
OPERATOR = [validator._plain("Название тарифа смотрите там же. Хорошего дня!")]
LONG = " ".join(["слово"] * 26)

CASES = [  # (критерий, ответ, язык, фраза, ожидаем непустую)
    (YES_NO, "no", "RU", "Итак, тариф нашли. Остались ещё вопросы? Хорошего дня!", True),
    (YES_NO, "yes", "RU", "Итак, тариф нашли. Остались ещё вопросы?", False),            # ответ yes
    (SCALE, 10, "RU", "Комиссия зависит от рынка, на какой площадке торгуете?", True),
    (SCALE, 20, "RU", "Комиссия зависит от рынка, на какой площадке торгуете?", False),   # полный балл
    (CRITICAL, "no", "RU", "Приношу извинения, давайте продолжим.", False),               # грубые ошибки
    (YES_NO, "no", "RU", LONG, False),                                                    # больше 25 слов
    (YES_NO, "no", "RU", "Уточните, остались ли у клиента вопросы", False),               # совет, а не фраза
    (YES_NO, "no", "EN", "Is there anything else I can help you with today?", True),
    (YES_NO, "no", "EN", "Остались ли вопросы?", False),                                  # не тот язык
    (YES_NO, "no", "KZ", "Басқа сұрағыңыз бар ма, көмектесуге қуаныштымын?", True),
    (YES_NO, "no", "KZ", "Is there anything else?", False),                               # нет кириллицы
    (YES_NO, "no", "RU", "Хорошего дня!", False),                                         # повтор реплики оператора
]


@pytest.mark.parametrize("criterion,answer,lang,text,keep", CASES)
def test_suggestion_filter(criterion, answer, lang, text, keep):
    out = validator._clean_suggestion(criterion, answer, text, lang, OPERATOR)
    assert bool(out) is keep
