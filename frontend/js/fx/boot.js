/* CQA · запускается в <head> до первой отрисовки: тема, закреплённая панель и признак эффектов.
   Только оформление — к логике приложения не относится. */
(function () {
  var root = document.documentElement;
  try {
    // ?theme=light|dark в адресе — удобно для показа; выбор запоминается
    var forced = (location.search.match(/[?&]theme=(light|dark)/) || [])[1];
    if (forced) localStorage.setItem('cqa-theme', forced);
    var theme = forced || localStorage.getItem('cqa-theme');
    // По умолчанию — светлая тема (как в примере организаторов); тёмная — по кнопке в панели
    root.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    if (localStorage.getItem('cqa-rail') === 'pinned') root.classList.add('rail-pinned');
    // Панель «въезжает» только при первом открытии за сессию
    if (!sessionStorage.getItem('cqa-visited')) { root.classList.add('first-visit'); sessionStorage.setItem('cqa-visited', '1'); }
  } catch (e) { /* хранилище может быть недоступно — оставляем значения по умолчанию */ }
  // Шрифты подключаем из скрипта: такой стиль не блокирует остальные скрипты,
  // поэтому при медленной сети интерфейс и эффекты не ждут Google Fonts.
  var fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  // Вариативные шрифты: по одному файлу на набор символов вместо файла на каждое начертание
  fonts.href = 'https://fonts.googleapis.com/css2?family=Geologica:wght@300..800&family=Unbounded:wght@500..800&display=swap';
  document.head.appendChild(fonts);

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) root.classList.add('fx');
})();
