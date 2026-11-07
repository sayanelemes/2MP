/* CQA · общие утилиты. Без DOM — файл загружается и в браузере, и в Node (tests/). */
(function (CQA) {
  'use strict';

  const util = {};

  util.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  };

  /** Округление до 2 знаков «как на бумаге»: 1.005 → 1.01, 66.666… → 66.67. */
  util.round2 = function (x) {
    if (x == null || !isFinite(x)) return x;
    if (Math.abs(x) < 1e-9) return 0;
    if (String(x).includes('e')) return Math.round(x * 100) / 100;
    return Number(Math.round(Number(x + 'e2')) + 'e-2');
  };

  /** 87.5 → "87,5"; 70 → "70"; null → "—" */
  util.num = function (x, digits) {
    if (x == null || !isFinite(x)) return '—';
    const d = digits == null ? 2 : digits;
    return Number(x).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: d });
  };

  util.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  /** Нормализация для поиска фраз: нижний регистр, ё→е, единые апострофы и пробелы. */
  util.norm = function (s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[’‘`ʼ]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  };

  util.words = function (s) {
    return util.norm(s).split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  };

  /**
   * Метка времени реплики → секунды.
   * Чаты: "MM:SS" или "HH:MM:SS" (секунды от начала чата).
   * Звонки: ISO 8601 с часовым поясом (абсолютное время, мс → с).
   */
  util.parseTs = function (ts) {
    if (ts == null) return null;
    const s = String(ts).trim();
    const m = s.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      return m[3] != null
        ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        : Number(m[1]) * 60 + Number(m[2]);
    }
    const ms = Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
    return isNaN(ms) ? null : ms / 1000;
  };

  util.isIsoTs = function (ts) {
    return /^\d{4}-\d{2}-\d{2}T/.test(String(ts || ''));
  };

  /** 75 → "1:15", 3725 → "1:02:05" */
  util.clock = function (sec) {
    if (sec == null || !isFinite(sec)) return '—';
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  };

  util.dateTime = function (iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  util.truncate = function (s, max) {
    const str = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return str.length > max ? str.slice(0, max - 1).trimEnd() + '…' : str;
  };

  util.clone = function (o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  };

  util.debounce = function (fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  util.sleep = function (ms) {
    return new Promise((r) => setTimeout(r, ms));
  };

  util.plural = function (n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };

  util.LANG_NAMES = { RU: 'русский', KZ: 'казахский', EN: 'английский' };
  util.SPEAKERS = { client: 'Клиент', operator: 'Оператор', bot: 'Бот', system: 'Система' };

  CQA.util = util;
})(typeof window !== 'undefined' ? (window.CQA = window.CQA || {}) : (globalThis.CQA = globalThis.CQA || {}));
