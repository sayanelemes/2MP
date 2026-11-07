/* CQA · расчёт итога по правилам чек-листа.
 * 1. N/A ставится только там, где он разрешён.
 * 2. «Да» — полный вес, «Нет» — 0; шкала пересчитывается пропорционально весу (верхняя ступень = полный вес).
 * 3. Критерии с N/A исключаются, их вес пропорционально перераспределяется — максимум остаётся 100.
 * 4. Итог округляется до 2 знаков; если применимых критериев с весом нет — итог не рассчитывается (null).
 * 5. Флаги (грубые ошибки) в итог не входят и показываются отдельно. */
(function (CQA) {
  'use strict';

  const U = CQA.util;

  const TYPE_LABELS = { binary: 'Да / Нет', scale: 'Шкала', flag: 'Флаг без баллов' };

  function scaleSteps(c) {
    return (c.scale || [])
      .map((s) => Number(s.value))
      .filter((v) => isFinite(v))
      .sort((a, b) => b - a);
  }

  function scaleMax(c) {
    const s = scaleSteps(c);
    return s.length ? s[0] : 0;
  }

  function fraction(c, answer) {
    if (answer == null || answer === 'na') return null;
    if (c.type === 'binary') return answer === 'yes' ? 1 : 0;
    if (c.type === 'scale') {
      const max = scaleMax(c);
      const v = Number(answer);
      if (!isFinite(v) || max <= 0) return 0;
      return Math.min(1, Math.max(0, v / max));
    }
    return null;
  }

  /**
   * @param checklist снимок чек-листа: { criteria, sections }
   * @param answers   { [criterionId]: 'yes' | 'no' | 'na' | number }
   */
  function compute(checklist, answers) {
    const criteria = (checklist.criteria || []).filter((c) => c.enabled !== false);
    let applicable = 0;
    let earned = 0;
    let baseSum = 0;

    const items = criteria.map((c) => {
      const answer = answers ? answers[c.id] : undefined;
      if (c.type === 'flag') {
        return { id: c.id, criterion: c, answer, isFlag: true, flagged: answer === 'yes', pending: answer == null };
      }
      const pending = answer == null;
      const isNA = answer === 'na';
      const f = fraction(c, answer);
      const w = Math.max(0, Number(c.weight) || 0);
      baseSum += w;
      if (!pending && !isNA) {
        applicable += w;
        earned += w * f;
      }
      return { id: c.id, criterion: c, answer, isNA, pending, fraction: f, baseWeight: w };
    });

    const total = applicable > 0 ? U.round2((100 * earned) / applicable) : null;

    items.forEach((it) => {
      if (it.isFlag) return;
      if (it.isNA || it.pending || applicable <= 0) {
        it.effectiveWeight = 0;
        it.points = null;
        return;
      }
      it.effectiveWeight = (100 * it.baseWeight) / applicable;
      it.points = it.effectiveWeight * it.fraction;
    });

    const known = new Set((checklist.sections || []).map((s) => s.id));
    const sectionList = (checklist.sections || []).slice();
    if (items.some((it) => !known.has(it.criterion.sectionId))) {
      sectionList.push({ id: '__other', title: 'Без секции' });
    }
    const sections = sectionList
      .map((s) => {
        const own = items.filter((it) =>
          s.id === '__other' ? !known.has(it.criterion.sectionId) : it.criterion.sectionId === s.id);
        const scored = own.filter((it) => !it.isFlag && !it.isNA && !it.pending);
        const points = scored.length ? scored.reduce((a, it) => a + it.points, 0) : null;
        const max = scored.reduce((a, it) => a + it.effectiveWeight, 0);
        return {
          id: s.id,
          title: s.title,
          items: own,
          points,
          max,
          percent: points != null && max > 0 ? U.round2((100 * points) / max) : null,
          naCount: own.filter((it) => it.isNA).length,
          flagged: own.some((it) => it.isFlag && it.flagged),
          onlyFlags: own.length > 0 && own.every((it) => it.isFlag)
        };
      })
      .filter((s) => s.items.length);

    const flags = items.filter((it) => it.isFlag);
    return {
      total,
      applicableWeight: applicable,
      baseWeightSum: baseSum,
      items,
      sections,
      flags,
      hasGross: flags.some((f) => f.flagged)
    };
  }

  function answerLabel(c, answer) {
    if (answer == null) return '—';
    if (answer === 'na') return 'N/A';
    if (c.type === 'scale') return `${U.num(Number(answer))} из ${U.num(scaleMax(c))}`;
    return answer === 'yes' ? 'Да' : 'Нет';
  }

  /** Тон для бейджа: ok | bad | na | mid */
  function answerTone(c, answer) {
    if (answer == null) return 'na';
    if (answer === 'na') return 'na';
    if (c.type === 'flag') return answer === 'yes' ? 'bad' : 'ok';
    if (c.type === 'scale') {
      const f = fraction(c, answer);
      return f >= 0.999 ? 'ok' : f <= 0.001 ? 'bad' : 'mid';
    }
    return answer === 'yes' ? 'ok' : 'bad';
  }

  /** Варианты ответа для формы решения проверяющего. */
  function answerOptions(c) {
    const opts = [];
    if (c.type === 'scale') {
      scaleSteps(c).forEach((v) => {
        const step = (c.scale || []).find((s) => Number(s.value) === v);
        opts.push({ value: v, label: `${U.num(v)} — ${step && step.label ? step.label : ''}`.replace(/ — $/, '') });
      });
    } else {
      opts.push({ value: 'yes', label: 'Да' });
      opts.push({ value: 'no', label: 'Нет' });
    }
    if (c.allowNA && c.type !== 'flag') opts.push({ value: 'na', label: 'N/A — неприменимо' });
    return opts;
  }

  function sameAnswer(a, b) {
    if (a == null || b == null) return a == b; // eslint-disable-line eqeqeq
    return String(a) === String(b);
  }

  function scoreTone(total) {
    if (total == null) return 'na';
    if (total >= 85) return 'ok';
    if (total >= 60) return 'mid';
    return 'bad';
  }

  /** Проверка конфигурации перед сохранением. */
  function validateChecklist(cl) {
    const errors = [];
    const warnings = [];
    const enabled = (cl.criteria || []).filter((c) => c.enabled !== false);
    if (!String(cl.name || '').trim()) errors.push('Укажите название чек-листа.');
    if (!enabled.length) errors.push('Добавьте хотя бы один активный критерий.');
    if (!enabled.some((c) => c.type !== 'flag' && Number(c.weight) > 0)) {
      errors.push('Нужен хотя бы один критерий с баллами и весом больше 0.');
    }
    const codes = new Map();
    (cl.criteria || []).forEach((c) => {
      const name = `«${c.code || '?'} ${c.title || 'без названия'}»`;
      if (!String(c.title || '').trim()) errors.push(`Критерий ${c.code || '?'}: укажите название.`);
      if (c.type !== 'flag' && !(Number(c.weight) >= 0)) errors.push(`${name}: вес должен быть числом ≥ 0.`);
      if (c.type === 'scale') {
        const steps = scaleSteps(c);
        if (steps.length < 2) errors.push(`${name}: у шкалы должно быть минимум 2 ступени.`);
        if (new Set(steps).size !== steps.length) errors.push(`${name}: значения ступеней шкалы не должны повторяться.`);
        if (steps.length && steps[0] <= 0) errors.push(`${name}: верхняя ступень шкалы должна быть больше 0.`);
      }
      if (c.allowNA && !String(c.naCondition || '').trim()) warnings.push(`${name}: N/A разрешён, но условие N/A не описано.`);
      if (c.rule === 'keywords') {
        const kw = c.keywords || {};
        if (!String(kw.positive || '').trim() && !String(kw.negative || '').trim()) {
          warnings.push(`${name}: для локального движка не заданы фразы-признаки — без backend критерий не оценится.`);
        }
      }
      const code = String(c.code || '').trim();
      if (code) codes.set(code, (codes.get(code) || 0) + 1);
    });
    codes.forEach((n, code) => { if (n > 1) errors.push(`Код ${code} используется у нескольких критериев.`); });
    const sum = enabled.filter((c) => c.type !== 'flag').reduce((a, c) => a + (Number(c.weight) || 0), 0);
    if (enabled.length && Math.abs(sum - 100) > 1e-9) {
      warnings.push(`Сумма весов = ${U.num(sum)}, а не 100. Итог всё равно нормируется к 100 баллам.`);
    }
    return { errors, warnings, weightSum: sum };
  }

  CQA.scoring = {
    TYPE_LABELS,
    compute,
    fraction,
    scaleMax,
    scaleSteps,
    answerLabel,
    answerTone,
    answerOptions,
    sameAnswer,
    scoreTone,
    validateChecklist
  };
})(typeof window !== 'undefined' ? (window.CQA = window.CQA || {}) : (globalThis.CQA = globalThis.CQA || {}));
