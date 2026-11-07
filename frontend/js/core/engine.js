/* CQA · локальный эвристический движок оценки (mock-провайдер, работает без backend).
 *
 * Для каждого критерия правило возвращает вердикт, объяснение со ссылками на реплики (#N)
 * и доказательства: support — подтверждает вывод, violation — нарушение,
 * expected — место, где ожидалось пропущенное действие, context — контекст.
 * Реплики бота и системные события используются только как контекст.
 *
 * Формат результата совпадает с ответом backend (см. README → «Контракт backend»),
 * поэтому движок можно заменить моделью, не трогая интерфейс. */
(function (CQA) {
  'use strict';

  const U = CQA.util;
  const ENGINE_ID = 'heuristic-v1';

  // ---------------------------------------------------------------------------
  // Лексикон RU / KZ / EN. Паттерны применяются к нормализованному тексту
  // (нижний регистр, ё → е).
  // ---------------------------------------------------------------------------
  const KZL = 'а-яәғқңөұүһі';
  const LEX = {
    greet: [
      'здравствуй', 'здраствуй', 'добрый (день|вечер)', 'доброе утро', 'доброго (дня|времени)', 'приветствую', '(^|[^а-я])привет',
      'сәлеметсіз', 'салеметсиз', `(^|[^${KZL}])сәлем`, 'қайырлы (күн|таң|кеш)', 'армысыз',
      '(^|[^a-z])(hi|hello|hey)([^a-z]|$)', 'good (morning|afternoon|evening)', 'greetings'
    ],
    genericHelpQ: [
      'чем (я )?(могу|можем) (вам |тебе )?помочь', 'с чем (вам )?помочь', 'чем помочь', 'остались (ли )?(еще |у вас )?(какие-то |какие-либо )?вопрос',
      'есть (ли )?(еще|другие) вопрос', 'чем (еще|ещ) (могу|можем)', 'дополнительные вопросы', 'вы на линии', 'меня слышно', 'вы меня слышите',
      'как (я могу )?к вам обращаться', 'каким .{0,20}обращаться', 'как вас зовут', 'чем могу быть полезен',
      'how (can|may) i help', 'anything else', 'what can i do for you', 'are you (still )?there',
      'қалай көмектесе', 'тағы (қандай )?сұрақ', 'не көмек'
    ],
    alreadySaid: [
      'я уже (писал|писала|говорил|говорила|сказал|сказала|написал|написала|указал|указала|объяснял|объясняла)',
      '(писал|писала|написал|написала|указал|указала) выше', 'я же (писал|писала|говорил|говорила|сказал|сказала)', 'выше (писал|написал|указал)',
      "already (said|told|wrote|mentioned|explained)", 'as i (said|mentioned|wrote)', 'i (said|wrote) (it )?(above|earlier)',
      'жоғарыда (жаздым|айттым|жазғанмын)', '(жаздым|айттым) ғой', 'бұрын айттым'
    ],
    contextCorrection: [
      'какое (еще )?приложение', 'я (же |вообще )?(на|с|за) (компьютер|ноутбук|пк)', 'я (же )?(на|в) (сайте|браузере|веб)', 'я (вообще )?не (в|на|через) (приложени|телефон)',
      'почему точно', 'я даже .{0,30}не (назвал|назвала|сказал|сказала|писал|писала)', 'я не про (это|то)', 'я про .{0,40}спрашивал', 'я спрашивал (про|о) ',
      "i'?m (on|using) (the |a )?(company |information )?(website|site|laptop|computer|browser)", 'settings where',
      "i (haven'?t|didn'?t|have not|did not) (even )?(say|said|mention|tell|told|name)", "i'?m only asking", "that'?s not what i (asked|meant)",
      'мен (компьютерде|сайтта|ноутбукта)', 'қай қосымша', 'мен ол туралы сұраған жоқпын'
    ],
    wrongAnswer: [
      'ондай (бөлім|батырма|мәзір) жоқ', 'нет такого (раздела|пункта|меню)', 'такого (раздела|пункта|меню) нет', 'кнопки входа нет', 'там (нет|ничего нет)',
      "there'?s no (such|login|sign|button)", "(it )?doesn'?t (exist|have)", 'не работает так', 'это не то'
    ],
    reAsk: [
      'в каком (меню|разделе|месте|окне)', 'где (именно|конкретно)', 'куда (именно )?(нажать|нажимать|заходить|идти)', 'какую кнопку', 'какое (еще )?приложение',
      'что (вы )?(имеете|имели) в виду', 'не (понял|поняла|понимаю)', '(не|мало) понятно', 'непонятно', '(скажите|напишите|объясните|повторите) еще раз', 'еще раз\\?',
      'повторите', 'что говорите', '^как\\?',
      'settings where', 'where exactly', 'which (one|button|menu|page)\\?', 'what do you mean', "i don'?t (understand|get it)", '^sorry\\?', 'pardon',
      'қай (жер|мәзір|бөлім|батырма)', 'қайда (екен|басамын)', 'түсінбедім', 'түсінбей тұрмын', 'қайталаңыз', 'нені айтып'
    ],
    verifiedSystem: [
      'личность (клиента )?подтвержд', 'идентификация (клиента )?(успешно )?пройден', 'клиент (успешно )?идентифицирован', 'жеке басы расталды', 'сәйкестендіру сәтті',
      'identity (has been |was )?(verified|confirmed)', 'customer (identity )?verified', 'verification (passed|successful|completed)'
    ],
    opVerified: [
      '(идентификац|личност)\\S* (успешно|пройден|подтвержд)', 'успешно (\\S+ )?(прош|пройд)', '(^|[^а-я])(вс[е]|все) верно', 'данные совпадают', 'расталды', 'identity (is )?verified'
    ],
    idRequest: [
      'идентификац', 'подтвер(дить|дим|ждения|ждение|дите) (вашу )?личност', 'провер(ить|им|ка|ки) личност', 'фамили[юяи]?,? имя', 'полное имя', ' иин', 'ваш ин[ .,]',
      'адрес .{0,25}регистрации', 'шестизначн', 'смс[ -]?код', 'код из смс', 'кодовое слово', 'дату рождения',
      'verify your identity', 'identity verification', 'confirm your identity', 'verification code', 'date of birth',
      'жеке басыңызды раста', 'растау қажет', 'сәйкестендір', 'тұлғаңызды раста'
    ],
    disclosure: [
      'на вашем (брокерском |торговом )?сч[е]т', 'по вашему (брокерскому )?сч[е]ту', 'у вас на сч[е]те', 'на сч[е]те (есть|имеется|стоит|установлен)',
      'ограничение на вывод', '(посмотрел|проверил|посмотрела|проверила)[:,]? (на |по )?(ваш|у вас)', 'вижу,? что (у вас|на вашем|вы )', 'наблюдаю,? что вы',
      'ваш (баланс|остаток) ', 'у вас (есть|имеется|стоит) (ограничение|блокировка|задолженность)',
      '(on|in) your account', 'i can see (a|an|the|your) ', 'your (account|balance) (has|shows|is) ',
      'шотыңызда', 'шотыңызға .{0,40}(шектеу|тыйым)', 'шектеу қойылған', 'көріп тұрмын'
    ],
    idProtest: [
      'не (подтверждал|подтверждала|проходил|проходила)', 'не подтвердил', 'это мой сч', "haven'?t verified", 'how do you know', "it'?s my account",
      'растаған жоқпын', 'расталған жоқ'
    ],
    accountRequest: [
      'мо(й|им|ем|его|ему) (брокерск\\S* )?сч[е]т', 'на моем сч', 'с моим сч', 'мо(й|ем|им) портфел', 'в портфеле', 'мо(е|й|его) (поручени|приказ|платеж|перевод|пополнени)',
      'деньги (не|еще не|так и не) (пришли|поступили|зачисл)', 'денег (все еще |еще )?нет', 'не вижу (бумаг|деньг|позици|средств)', 'вывод (огранич|заблок|не работает)',
      'проверьте .{0,20}(сч[е]т|платеж|перевод)', 'проверить сам сч', 'пополнял',
      'my (account|transfer|payment|deposit|position|portfolio|order)', "hasn'?t (shown|arrived|come)", 'withdrawals? (are |is )?(blocked|restricted)', 'check (my|the) (account|transfer|payment)',
      'шотым', 'менің шот', 'ақша (әлі )?(көрінбей|түспей|келмей)', 'аудардым', 'портфелім'
    ],
    deflection: [
      'я (уже )?указал', 'смотрите там же', 'вс[е] есть в приложении', 'тогда не знаю', '(^|[^а-я])не знаю', 'ничего не (сделать|поделать)', 'это не (ко мне|к нам)',
      "that'?s where", "i don'?t know", "can'?t help (you )?with that", 'we can skip that', 'nothing (i|we) can do',
      'білмеймін', 'бәрі қосымшада'
    ],
    dismissive: [
      'вс[е] есть в приложении', 'тогда не знаю', 'ничего не (сделать|поделать)', 'не мои проблемы', 'подтверждение (пока )?не нужно',
      "i don'?t know", 'we can skip that', 'not my problem',
      'білмеймін', 'растаудың қажеті жоқ', 'бәрі қосымшада'
    ],
    wrongAdvice: [
      'подтверждение (пока )?не нужно', 'идентификация (пока )?не нужна', 'растаудың қажеті жоқ', 'we can skip (that|verification)', 'no need to verify'
    ],
    insist: [
      'я спрашиваю', 'я же спросил', 'вы не ответили', 'а ответ', "i'?m asking", "you didn'?t answer", 'i asked', 'мен сұрап тұрмын', 'жауап бермедіңіз'
    ],
    satisfaction: [
      'спасибо', 'благодар', 'нашел', 'нашла', 'нашлось', 'вижу', 'получилось', 'скачал', 'скачалось', 'понял', 'поняла', 'понятно', 'ясно', 'вошел', 'вошла',
      'убрал', 'отлично', 'супер', '(^|[^а-я])ок([^а-я]|$)', 'хорошо', 'разобрал', 'хотел узнать', 'хотела узнать',
      'рақмет', 'рахмет', 'таптым', 'көрдім', 'түсіндім', 'түсінікті', 'дайын', 'ашылды', 'өшірдім', 'жүктелді', 'жақсы',
      'thank', 'found it', 'got (it|them)', 'that worked', 'it worked', 'works now', 'understood', 'i see', 'perfect', 'great', 'okay', '(^|[^a-z])ok([^a-z]|$)',
      'that helps', 'all set', 'makes sense', "that'?s all", "that'?s the page", 'got in'
    ],
    notSatisfied: [
      'не (вижу|понял|поняла|понятно|нашел|нашла|получилось|ясно|могу)', 'непонятно', "not (found|working|sure)", "didn'?t work", "(still )?(can'?t|cannot|don'?t) ",
      'таппадым', 'түсінбедім', 'көрінбей'
    ],
    emotion: [
      'переживаю', 'беспоко', 'волнуюсь', 'нервнич', 'нервн', 'надоело', 'возмущ', 'безобраз', 'ужасн', 'недовол', 'раздраж', 'со мной так', 'так говорить не надо',
      'неприятн', 'отфутбол', 'сколько можно', 'почему опять', 'издева', 'бесит', 'обидно',
      'nervous', 'worried', 'worry', 'frustrat', 'annoy', 'upset', 'angry', 'unacceptable', 'ridiculous', 'disappoint', 'fed up',
      'алаңда', 'уайымда', 'мазам', 'ренжі', 'ашуым', 'жалықтым', 'шаршадым', 'қашанға дейін'
    ],
    inconvenience: [
      'уже (второй|третий|который) (раз|день)', 'со вчерашнего дня', 'не могу постоянно', 'неудобно', 'долго',
      'takes (so )?long', 'again and again', 'every time', 'ұзақ', 'қолайсыз'
    ],
    empathy: [
      'понимаю', 'понимаем', 'понятно,? (что|почему)', 'сожалению', 'сожалеем', 'извините', 'прошу прощения', 'приношу (свои )?извинения',
      'спасибо,? что (подождали|дождались)', '(спасибо|благодарю) (вас )?за ожидание', 'рад(а)? помочь', 'не переживайте', 'не волнуйтесь', 'неудобств',
      'i understand', 'i see why', "i'?m sorry", 'sorry (for|about|to)', 'apolog', 'thanks for (waiting|your patience)', 'thank you for (waiting|your patience)',
      'happy to help', 'glad (to help|you)', 'i know (this|it) (can be|is)',
      'түсінікті', 'түсінемін', 'кешіріңіз', 'өкінішке (орай|қарай)', 'күткеніңіз(ге)? рақмет', 'қуаныштымын', 'алаңдайтын'
    ],
    rude: [
      'читать (не )?умеете', 'вы (вообще|что),? (не )?(читать|понимать)', 'не мои проблемы', 'ваши проблемы', 'сами виноваты', 'туп(ой|ая|ые|ица)', 'идиот', 'дура(к|ч)',
      'глуп(ый|ая|ые|о)', 'бестолк', 'отстаньте', 'не морочьте', 'достали',
      "can'?t you read", 'are you (blind|stupid)', 'stupid', 'idiot', 'dumb', 'not my problem', 'shut up',
      'оқи алмайсыз', 'оқу(ды)? білмейсіз', 'ақымақ', 'миың', 'мазамды алма'
    ],
    waitWarn: [
      'минут', 'секунд', 'сейчас (проверю|посмотрю|уточню|узнаю)', '(^|[^а-я])(уточню|проверю|посмотрю|узнаю)', 'ожидайте', 'подождите', 'на линии', 'нужно (немного )?времени',
      'let me check', 'one moment', 'just a (moment|minute|sec)', 'give me a (moment|minute|sec)', 'please (wait|hold)', 'bear with me', "i'?ll (check|look)",
      'қазір (тексер|қарап|нақтыла)', 'күте тұрыңыз', 'бір минут', 'сәл күтіңіз'
    ],
    farewell: [
      'до свидания', 'всего (доброго|хорошего)', 'хорошего (дня|вечера|утра|настроения)', 'удачного дня', 'до встречи', 'прощайте',
      '(спасибо|благодарю)( вас)? за (обращение|уделенное время|звонок)',
      'сау болыңыз', 'сау бол', 'күніңіз сәтті', 'көріскенше', 'қош болыңыз',
      'goodbye', 'good bye', '(^|[^a-z])bye', 'have a (good|great|nice|lovely) (day|evening|night|one|weekend)', 'take care', 'see you'
    ],
    closingFormula: [
      'если (вопрос|что-то|возникнут|появятся|останутся|понадобится|бумага)', 'обращайтесь', 'напишите (нам|в этот чат|сюда)', 'сообщите (в этом чате|нам)', 'рад(а)? (был(а)? )?помочь',
      'чем (еще|ещ) (могу|можем)', 'остались (ли )?(еще )?вопрос', 'дополнительные вопросы', '(спасибо|благодарю)( вас)? за (обращение|уделенное время|звонок)',
      'вопрос .{0,30}передан', 'передам', 'передал', 'мы сообщим', 'сообщим вам', 'перезвон', 'обратную связь', 'итак,', 'начните со', '^пожалуйста',
      'happy to help', 'glad (to help|you got|it worked|i could)', 'anything else', 'thanks for (reaching out|contacting|your call)', "(we'?ll|we will|i'?ll) follow up",
      'reach out', "you'?re welcome", 'let us know', 'feel free', 'of course',
      'тағы (сұра|сұрағыңыз)', 'көмегім тигеніне', 'хабарласыңыз', 'жауапты осында', 'оқасы жоқ', 'жазыңыз', 'тексеруге жібер', 'мамандарға',
      'когда будете готов', 'пришлите', "when you'?re ready", 'дайын болғанда', 'жіберіңіз'
    ],
    bypass: [
      '(мне|мою|свою) (личную )?(на )?карту', 'на (мою|личную) карту', 'скиньте .{0,25}мне', 'переведите .{0,25}(мне|лично)', 'лично (вам )?предлагаю',
      'через компанию .{0,20}не (надо|нужно)', 'в обход компании', 'личный (номер|телефон)', 'частн\\S* консультац', 'за (плату|отдельную плату|вознаграждение)',
      'платн\\S* консультац', 'мой (личный )?кошел',
      'personal (phone )?number', 'private (advice|consultation)', 'i charge', 'for a fee', 'send (me )?(the )?money (to me|directly)', 'to my (personal )?(card|account)',
      'transfer (it |the money )?to me', 'bypass(ing)? the company',
      'жеке нөмір', 'ақылы (түрде|кеңес)', 'маған (аударыңыз|жіберіңіз)', 'жеке картам', 'жеке кеңес'
    ],
    clientLeft: [
      'клиент (покинул|вышел|отключился|завершил)', 'соединение с клиентом (прервано|потеряно)', 'связь с клиентом (прервана|потеряна)', 'клиентпен байланыс үзілді',
      'клиент чаттан шықты', 'connection to (the )?customer (was )?lost', '(customer|client) (left|disconnected|ended|hung up)'
    ],
    operatorClosed: [
      'оператор (закрыл|завершил) (чат|диалог|разговор)', 'оператор чатты жапты', 'agent (closed|ended) (the )?(chat|conversation)'
    ],
    escalation: [
      'оператор', 'человек', 'специалист', 'сотрудник', 'соедин', 'подключ', 'позов', 'переключ',
      'agent', 'person', 'someone', 'support', 'операторға', 'адаммен', 'қосыңыз', 'жалғаңыз'
    ],
    hold: ['на удержании', 'on hold', 'ұстап тұр'],
    holdEnd: ['больше не находится на удержании', 'снят с удержания', 'no longer on hold', 'off hold'],
    domain: [
      'тариф', 'комисси', 'отчет', 'сч[е]т', 'вывод', 'вывест', 'пополн', 'реквизит', 'облигац', 'акци', 'бумаг', 'портфел', 'логин', 'вход', 'войти', 'не пускает',
      'кабинет', 'приложени', 'сайт', 'марж', 'приказ', 'поручени', 'форм[ауы]', 'перевод', 'деньг', 'платеж', 'данные', 'сведени', 'регистрац', 'бирж', 'тикер', 'налог',
      'plan', 'pricing', 'fee', 'commission', 'report', 'statement', 'account', 'withdraw', 'deposit', 'fund', 'transfer', 'bond', 'stock', 'share', 'login', 'sign',
      '(^|[^a-z])app', 'website', 'margin', 'order', 'form', 'money', 'ticker', 'exchange', 'details',
      'есеп', 'есеб', 'брокер', 'шот', 'ақша', 'акция', 'қағаз', 'қосымша', 'маржа', 'өтінім', 'нысан', 'аудар', 'деректеме', 'кір'
    ]
  };

  const RX = {};
  Object.keys(LEX).forEach((k) => { RX[k] = new RegExp(LEX[k].join('|'), 'u'); });

  // Представление по имени — по исходному тексту (нужен регистр букв).
  const INTRO = [
    /меня зовут/iu, /менің атым/iu, /my name is/i, /на связи/iu,
    /(^|[\s,.!:;—-])[яЯ]\s+[А-ЯЁ][а-яё]+/u,
    /(^|[\s,.!:;—-])[эЭ]то\s+[А-ЯЁ][а-яё]+/u,
    /(^|[\s,.!:;—-])[мМ]ен\s+(?!Сіз)[А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]+/u,
    /[А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]+(мын|мін|пын|пін|бын|бін)(?![а-яёәғқңөұүһі])/u,
    /\bI(?:'|’)m\s+[A-Z][a-z]+/, /\bI am\s+[A-Z][a-z]+/, /\b[Tt]his is\s+[A-Z][a-z]+/,
    /\[имя скрыто\]/iu
  ];

  const LANG_PREP = { RU: 'русском', KZ: 'казахском', EN: 'английском' };
  const WAIT_LIMIT_SEC = 120; // «явное ожидание» в чате без предупреждения

  // ---------------------------------------------------------------------------
  // Подготовка диалога
  // ---------------------------------------------------------------------------
  function normSpeaker(s) {
    const v = String(s || '').toLowerCase();
    if (/operator|agent|оператор|агент/.test(v)) return 'operator';
    if (/client|customer|user|клиент/.test(v)) return 'client';
    if (/bot|бот|ivr|assistant/.test(v)) return 'bot';
    if (/system|систем/.test(v)) return 'system';
    return v || 'system';
  }

  function normLang(l) {
    const v = String(l || '').toUpperCase();
    if (v.startsWith('RU')) return 'RU';
    if (v.startsWith('KZ') || v.startsWith('KK')) return 'KZ';
    if (v.startsWith('EN')) return 'EN';
    return null;
  }

  function detectLang(text) {
    const t = String(text || '').replace(/«[^»]*»/g, ' ').replace(/"[^"]*"/g, ' ').toLowerCase();
    const words = t.split(/[^a-zа-яёәғқңөұүһі]+/).filter(Boolean);
    const cyr = words.filter((w) => /[а-яёәғқңөұүһі]/.test(w));
    const lat = words.filter((w) => /[a-z]/.test(w)).length;
    if (!cyr.length && !lat) return null;
    if (cyr.length * 2 > lat) return cyr.some((w) => /[әғқңөұүһі]/.test(w)) ? 'KZ' : 'RU';
    return 'EN';
  }

  function prepare(dialog) {
    const raw = Array.isArray(dialog && dialog.transcript) ? dialog.transcript : [];
    const isCall = /voice|call|звон/i.test(String((dialog && dialog.channel) || '')) || !!(dialog && dialog.audio_url);
    const absolute = raw.some((t) => U.isIsoTs(t && t.timestamp));
    let t0 = null;
    const turns = raw.map((t, i) => {
      const text = String(t && t.text != null ? t.text : '');
      const abs = U.parseTs(t && t.timestamp);
      if (t0 == null && abs != null) t0 = abs;
      return { i, speaker: normSpeaker(t && t.speaker), text, n: U.norm(text), ts: t && t.timestamp, abs };
    });
    turns.forEach((t) => {
      t.sec = t.abs == null ? null : absolute ? t.abs - t0 : t.abs;
      t.isQ = t.text.includes('?');
      t.wc = U.words(t.text).length;
    });

    const opIdx = turns.filter((t) => t.speaker === 'operator').map((t) => t.i);
    const firstOp = opIdx.length ? opIdx[0] : -1;
    const clientText = turns.filter((t) => t.speaker === 'client').map((t) => t.text).join(' ');
    const clientLang = normLang(dialog && dialog.language) || detectLang(clientText);
    const requestKnown = turns.some((t) => t.speaker === 'client' && (firstOp < 0 || t.i < firstOp) &&
      (RX.domain.test(t.n) || (t.wc >= 5 && !RX.escalation.test(t.n))));

    let end = { type: 'open', index: -1 };
    for (let k = turns.length - 1; k >= 0 && k >= turns.length - 4; k--) {
      const t = turns[k];
      if (t.speaker !== 'system') continue;
      if (RX.clientLeft.test(t.n)) { end = { type: 'client_left', index: k }; break; }
      if (RX.operatorClosed.test(t.n)) { end = { type: 'operator_closed', index: k }; break; }
    }

    return { dialog, isCall, turns, opIdx, firstOp, clientLang, requestKnown, end, cache: {} };
  }

  // ---------------------------------------------------------------------------
  // Помощники
  // ---------------------------------------------------------------------------
  const ref = (i) => `#${i + 1}`;
  const quote = (t, max) => `«${U.truncate(t.text, max || 110)}»`;
  const ev = (turn, kind, note) => ({ turn, kind, note });

  function prevOf(ctx, i, speaker) {
    for (let k = i - 1; k >= 0; k--) if (ctx.turns[k].speaker === speaker) return ctx.turns[k];
    return null;
  }

  function nextOf(ctx, i, speaker) {
    for (let k = i + 1; k < ctx.turns.length; k++) if (ctx.turns[k].speaker === speaker) return ctx.turns[k];
    return null;
  }

  /** Следующий ответ на реплику клиента: реплика оператора или системное закрытие диалога. */
  function nextReply(ctx, i) {
    for (let k = i + 1; k < ctx.turns.length; k++) {
      const t = ctx.turns[k];
      if (t.speaker === 'operator') return t;
      if (t.speaker === 'system' && (RX.operatorClosed.test(t.n) || RX.clientLeft.test(t.n))) return t;
    }
    return null;
  }

  function sentences(text) {
    return String(text).split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
  }

  /** Реплика оператора содержит ответ по существу (инструкцию, факт, следующий шаг). */
  function hasSubstance(t) {
    if (!t || t.speaker !== 'operator') return false;
    if (RX.rude.test(t.n) || RX.bypass.test(t.n) || RX.dismissive.test(t.n)) return false;
    const rest = sentences(t.text).filter((s) => {
      const n = U.norm(s);
      const wc = U.words(s).length;
      if (s.includes('?')) return false;
      if ((RX.greet.test(n) || INTRO.some((r) => r.test(s))) && wc <= 7) return false;
      if (RX.farewell.test(n) && wc <= 5) return false;
      if (RX.empathy.test(n) && wc <= 12 && !/открой|выбер|нажм|перейд|open|select|go to|ашыңыз|таңдаңыз/.test(n)) return false;
      if (RX.deflection.test(n)) return false;
      return true;
    });
    return rest.reduce((a, s) => a + U.words(s).length, 0) >= 4;
  }

  function isClarifyingQ(t) {
    if (!t || t.speaker !== 'operator' || !t.isQ || RX.rude.test(t.n) || RX.bypass.test(t.n)) return false;
    return sentences(t.text).filter((s) => s.includes('?')).some((s) => {
      const n = U.norm(s);
      return U.words(s).length >= 3 && !RX.genericHelpQ.test(n) && !RX.idRequest.test(n) && !RX.farewell.test(n);
    });
  }

  function isFarewellOnly(t) {
    return !!t && t.speaker === 'operator' && RX.farewell.test(t.n) && t.wc <= 4;
  }

  function isSatisfied(t) {
    return !!t && RX.satisfaction.test(t.n) && !RX.notSatisfied.test(t.n) && !RX.emotion.test(t.n);
  }

  /** Предыдущая реплика оператора — ответ (а не вопрос). */
  function prevOpAnswered(ctx, i) {
    const p = prevOf(ctx, i, 'operator');
    return !!p && p.i >= ctx.firstOp && !p.isQ;
  }

  /** Клиент поправляет ответ оператора (а не подтверждает результат). */
  function isCorrection(ctx, t, rxs) {
    if (t.speaker !== 'client' || !rxs.some((r) => r.test(t.n)) || isSatisfied(t) || !prevOpAnswered(ctx, t.i)) return false;
    const op = prevOf(ctx, t.i, 'operator');
    if (RX.bypass.test(op.n) || RX.rude.test(op.n)) {
      // Реакция на грубость или предложение «в обход» относится к другим критериям,
      // если основной запрос клиента к этому моменту уже был решён.
      const solvedBefore = ctx.turns.some((x) => x.speaker === 'client' && x.i > ctx.firstOp && x.i < t.i && isSatisfied(x));
      if (solvedBefore) return false;
    }
    return true;
  }

  function firstClientRequest(ctx) {
    const clients = ctx.turns.filter((t) => t.speaker === 'client');
    return clients.find((t) => RX.domain.test(t.n)) || clients[0] || null;
  }

  function firstReply(ctx) {
    const T = ctx.turns;
    const out = [];
    if (ctx.firstOp < 0) return out;
    out.push(ctx.firstOp);
    if (ctx.isCall) {
      const s0 = T[ctx.firstOp].sec;
      for (let k = ctx.firstOp + 1; k < T.length && out.length < 3; k++) {
        const t = T[k];
        if (t.speaker === 'client') break;
        if (t.speaker !== 'operator') continue;
        if (s0 != null && t.sec != null && t.sec - s0 > 20) break;
        out.push(k);
      }
    }
    return out;
  }

  function noOperator() {
    return {
      verdict: 'na', forceNA: true, confidence: 0.95,
      explanation: 'В диалоге нет реплик оператора — критерий оценить нельзя.',
      naReason: 'Оператор не участвовал в диалоге.', evidence: []
    };
  }

  const asrNote = (ctx) => (ctx.isCall ? ' Звонок: транскрипт получен ASR — формулировки могут быть искажены, сверьте с записью.' : '');

  // ---------------------------------------------------------------------------
  // 01 · Установление контакта
  // ---------------------------------------------------------------------------
  function ruleGreeting(ctx) {
    if (ctx.firstOp < 0) return noOperator();
    const T = ctx.turns;
    const idx = firstReply(ctx);
    const text = idx.map((i) => T[i].text).join(' ');
    const n = U.norm(text);
    const greet = RX.greet.test(n);
    const intro = INTRO.some((r) => r.test(text));
    const opLang = detectLang(text);
    const langOk = !opLang || !ctx.clientLang || opLang === ctx.clientLang;
    const first = T[idx[0]];

    if (greet && intro && langOk) {
      return {
        verdict: 'yes', confidence: ctx.isCall ? 0.8 : 0.92,
        explanation: `В первом ответе (${ref(first.i)}) оператор поздоровался и представился` +
          `${ctx.clientLang ? ' на языке клиента' : ''}: ${quote(first)}.`,
        evidence: [ev(first.i, 'support', 'Приветствие и представление')]
      };
    }
    const miss = [];
    if (!greet) miss.push('нет приветствия');
    if (!intro) miss.push('оператор не представился');
    if (!langOk) miss.push(`ответ на ${LANG_PREP[opLang] || opLang}, а клиент пишет на ${LANG_PREP[ctx.clientLang] || ctx.clientLang}`);
    return {
      verdict: 'no', confidence: ctx.isCall ? 0.6 : 0.88,
      explanation: `Первый ответ оператора (${ref(first.i)}): ${quote(first)} — ${miss.join('; ')}.` +
        (ctx.isCall && !intro ? ' Имя могло потеряться при распознавании речи — стоит прослушать фрагмент.' : ''),
      evidence: [ev(first.i, 'expected', 'Здесь ожидались приветствие и представление')]
    };
  }

  // ---------------------------------------------------------------------------
  // 02 · Выявление потребности
  // ---------------------------------------------------------------------------
  function ruleNeeds(ctx) {
    if (ctx.firstOp < 0) return noOperator();
    const T = ctx.turns;
    const after = T.slice(ctx.firstOp);
    const clientsAfter = after.filter((t) => t.speaker === 'client');

    const already = clientsAfter.find((t) => RX.alreadySaid.test(t.n));
    if (already) {
      const op = prevOf(ctx, already.i, 'operator');
      return {
        verdict: 'no', confidence: 0.85,
        explanation: `Оператор не учёл уже известные детали: после ${op ? `${ref(op.i)} ${quote(op, 90)}` : 'ответа оператора'} ` +
          `клиенту пришлось напомнить, что он это уже сообщал — ${ref(already.i)} ${quote(already, 90)}.`,
        evidence: [op && ev(op.i, 'violation', 'Вопрос без учёта сказанного ранее'), ev(already.i, 'support', 'Клиент повторяет уже сказанное')].filter(Boolean)
      };
    }

    const first = T[ctx.firstOp];
    if (!ctx.isCall && ctx.requestKnown && RX.genericHelpQ.test(first.n) && !hasSubstance(first)) {
      const req = firstClientRequest(ctx);
      return {
        verdict: 'no', confidence: 0.75,
        explanation: `Запрос клиента был известен до подключения оператора${req ? ` (${ref(req.i)} ${quote(req, 90)})` : ''}, ` +
          `но оператор начал с общего вопроса ${quote(first, 80)} вместо уточнения деталей.`,
        evidence: [ev(first.i, 'violation', 'Общий вопрос вместо уточнения'), req && ev(req.i, 'context', 'Запрос уже сформулирован')].filter(Boolean)
      };
    }

    const corr = clientsAfter.find((t) => isCorrection(ctx, t, [RX.contextCorrection]));
    if (corr) {
      const op = prevOf(ctx, corr.i, 'operator');
      return {
        verdict: 'no', confidence: 0.8,
        explanation: `Оператор ответил, не уточнив недостающие детали: ${ref(op.i)} ${quote(op, 90)}. ` +
          `Клиенту пришлось поправить его — ${ref(corr.i)} ${quote(corr, 90)}. Уточняющий вопрос ожидался до ответа.`,
        evidence: [ev(op.i, 'expected', 'До этого ответа ожидался уточняющий вопрос'), ev(corr.i, 'support', 'Клиент поправляет оператора')]
      };
    }

    const q = after.find((t) => isClarifyingQ(t));
    if (q) {
      return {
        verdict: 'yes', confidence: ctx.isCall ? 0.65 : 0.82,
        explanation: `Оператор уточнил недостающие детали до ответа: ${ref(q.i)} ${quote(q)}.`,
        evidence: [ev(q.i, 'support', 'Уточняющий вопрос')]
      };
    }

    if (!ctx.requestKnown && !clientsAfter.length) {
      return {
        verdict: 'na', confidence: 0.85,
        explanation: 'Клиент покинул диалог, не описав вопрос, — выявлять потребность было не на чем.',
        naReason: 'Запрос так и не прозвучал; уточнять было нечего.',
        evidence: ctx.end.index >= 0 ? [ev(ctx.end.index, 'context', 'Завершение диалога')] : []
      };
    }

    const req = firstClientRequest(ctx);
    return {
      verdict: 'na', confidence: 0.7,
      explanation: `Клиент сразу описал запрос${req ? ` (${ref(req.i)} ${quote(req, 90)})` : ''}; оператор ответил без уточнений, ` +
        'и клиенту не пришлось ничего поправлять или повторять.',
      naReason: 'Данных для ответа хватало с самого начала.',
      evidence: req ? [ev(req.i, 'context', 'Исходный запрос клиента')] : []
    };
  }

  // ---------------------------------------------------------------------------
  // 03 · Идентификация
  // ---------------------------------------------------------------------------
  function analyzeIdentification(ctx) {
    if (ctx.cache.id) return ctx.cache.id;
    const T = ctx.turns;
    let idReq = -1;
    let verified = -1;
    T.forEach((t) => {
      if (t.speaker === 'operator' && idReq < 0 && RX.idRequest.test(t.n)) idReq = t.i;
      if (verified >= 0) return;
      if (t.speaker === 'system' && RX.verifiedSystem.test(t.n)) verified = t.i;
      else if (t.speaker === 'operator' && idReq >= 0 && t.i > idReq && RX.opVerified.test(t.n)) verified = t.i;
    });
    const disclosures = T.filter((t) => t.speaker === 'operator' && RX.disclosure.test(t.n) && !RX.idRequest.test(t.n)).map((t) => t.i);
    const early = disclosures.find((i) => verified < 0 || i < verified);
    const accountReq = T.find((t) => t.speaker === 'client' && RX.accountRequest.test(t.n));
    ctx.cache.id = { idReq, verified, disclosures, early: early == null ? -1 : early, accountReq: accountReq ? accountReq.i : -1 };
    return ctx.cache.id;
  }

  function ruleIdentification(ctx) {
    if (ctx.firstOp < 0) return noOperator();
    const T = ctx.turns;
    const a = analyzeIdentification(ctx);

    if (a.early >= 0) {
      const d = T[a.early];
      const protest = T.find((t) => t.speaker === 'client' && t.i > d.i && RX.idProtest.test(t.n));
      const evidence = [];
      if (a.accountReq >= 0) evidence.push(ev(a.accountReq, 'context', 'Запрос по конкретному счёту'));
      evidence.push(ev(d.i, 'violation', 'Сведения о счёте раскрыты без подтверждения личности'));
      if (protest) evidence.push(ev(protest.i, 'support', 'Клиент указывает, что не проходил проверку'));
      return {
        verdict: 'no', confidence: 0.85,
        explanation: `Запрос касался конкретного счёта${a.accountReq >= 0 ? ` (${ref(a.accountReq)})` : ''}, но оператор раскрыл сведения о нём ` +
          `(${ref(d.i)} ${quote(d, 100)}) ` +
          (a.verified >= 0 ? `до подтверждения личности (${ref(a.verified)}).` : 'без подтверждения личности — в диалоге его нет.') +
          (protest ? ` Клиент сам обратил на это внимание: ${ref(protest.i)} ${quote(protest, 80)}.` : ''),
        evidence
      };
    }

    if (a.verified >= 0) {
      const v = T[a.verified];
      const evidence = [];
      if (a.idReq >= 0 && a.idReq !== a.verified) evidence.push(ev(a.idReq, 'support', 'Оператор запросил идентификацию'));
      evidence.push(ev(v.i, 'support', 'Личность подтверждена'));
      const after = a.disclosures.find((i) => i >= a.verified);
      return {
        verdict: 'yes', confidence: ctx.isCall ? 0.75 : 0.92,
        explanation: `Личность клиента подтверждена (${ref(v.i)} ${quote(v, 80)})` +
          `${a.idReq >= 0 && a.idReq !== a.verified ? ` после запроса оператора (${ref(a.idReq)})` : ''}` +
          ` — до раскрытия данных и действий по счёту${after != null ? ` (сведения сообщены позже, в ${ref(after)})` : ''}.`,
        evidence
      };
    }

    if (a.idReq >= 0) {
      return {
        verdict: 'na', confidence: 0.7,
        explanation: `Оператор предупредил, что для проверки счёта нужна идентификация (${ref(a.idReq)} ${quote(T[a.idReq], 100)}), ` +
          'но проверка не проводилась и сведения о счёте не раскрывались.',
        naReason: 'Защищённого действия не было — идентификация не потребовалась.',
        evidence: [ev(a.idReq, 'context', 'Оператор предупредил об идентификации')]
      };
    }

    return {
      verdict: 'na', confidence: ctx.isCall ? 0.6 : 0.78,
      explanation: 'Клиент задавал общий вопрос (инструкция или справка). Оператор не раскрывал сведения о счёте и не выполнял действий по нему.',
      naReason: 'Запрос не требовал идентификации.',
      evidence: []
    };
  }

  // ---------------------------------------------------------------------------
  // 04 · Корректная и полная консультация (шкала)
  // ---------------------------------------------------------------------------
  function ruleConsultation(ctx) {
    if (ctx.firstOp < 0) return noOperator();
    const T = ctx.turns;
    const after = T.slice(ctx.firstOp);
    const clientsAfter = after.filter((t) => t.speaker === 'client');

    if (!ctx.requestKnown && !clientsAfter.some((t) => RX.domain.test(t.n) || t.wc >= 5)) {
      const endT = ctx.end.index >= 0 ? T[ctx.end.index] : null;
      return {
        verdict: 'na', confidence: 0.85,
        explanation: 'Клиент не сформулировал запрос: до оператора — только просьба соединить с человеком' +
          (endT ? `, затем диалог завершился (${ref(endT.i)} ${quote(endT, 60)}).` : '.'),
        naReason: 'Чат закончился до того, как клиент сформулировал запрос.',
        evidence: endT ? [ev(endT.i, 'context', 'Завершение диалога')] : []
      };
    }

    const ops = after.filter((t) => t.speaker === 'operator');
    const substantive = ops.filter(hasSubstance);
    if (!substantive.length) {
      const bad = ops.filter((t) => RX.deflection.test(t.n) || RX.dismissive.test(t.n) || RX.bypass.test(t.n) || RX.rude.test(t.n));
      return {
        verdict: 0, confidence: 0.75,
        explanation: 'Ответа по существу нет: ' +
          (bad.length ? bad.map((t) => `${ref(t.i)} ${quote(t, 70)}`).join('; ') : 'оператор не дал ни инструкции, ни следующего шага') + '.',
        evidence: bad.length
          ? bad.map((t) => ev(t.i, 'violation', 'Нет ответа по существу'))
          : [ev(ctx.firstOp, 'expected', 'Здесь ожидался ответ по существу')]
      };
    }

    const unanswered = [];
    clientsAfter.forEach((c) => {
      if (!c.isQ && !RX.insist.test(c.n)) return;
      const reply = nextReply(ctx, c.i);
      if (!reply) return;
      if (reply.speaker === 'system') {
        if (RX.operatorClosed.test(reply.n)) unanswered.push({ q: c, a: reply });
        return;
      }
      if (RX.deflection.test(reply.n) || RX.wrongAdvice.test(reply.n) || isFarewellOnly(reply)) unanswered.push({ q: c, a: reply });
    });

    const corrections = clientsAfter.filter((c) => isCorrection(ctx, c, [RX.contextCorrection, RX.wrongAnswer]));
    const lastCorr = corrections[corrections.length - 1];
    const fixed = !!lastCorr && substantive.some((t) => t.i > lastCorr.i);
    const wrongAdv = ops.filter((t) => RX.wrongAdvice.test(t.n) && !unanswered.some((u) => u.a === t));
    const sat = clientsAfter.slice(-2).filter(isSatisfied).pop();
    const lastC = clientsAfter[clientsAfter.length - 1];
    const leftOpen = !sat && lastC && (lastC.isQ || RX.emotion.test(lastC.n) || RX.insist.test(lastC.n)) && !unanswered.some((u) => u.q === lastC);

    let score = 1;
    if (unanswered.length) score -= 0.5 + 0.25 * (unanswered.length - 1);
    if (corrections.length) score -= fixed ? 0.25 : 0.5;
    if (wrongAdv.length) score -= 0.25;
    if (leftOpen) score -= 0.25;
    score = Math.max(0, Math.floor(score * 4 + 1e-9) / 4);

    const main = substantive[0];
    const evidence = [ev(main.i, 'support', 'Ответ по существу')];
    const parts = [];
    unanswered.forEach((u) => {
      parts.push(`без ответа остался вопрос ${ref(u.q.i)} ${quote(u.q, 80)} — ` +
        (u.a.speaker === 'system' ? `оператор закрыл диалог (${ref(u.a.i)})` : `в ответ ${ref(u.a.i)} ${quote(u.a, 70)}`));
      evidence.push(ev(u.q.i, 'context', 'Вопрос клиента'));
      evidence.push(ev(u.a.i, 'violation', 'Вопрос остался без ответа'));
    });
    if (corrections.length) {
      parts.push(`рекомендация не подошла клиенту (${ref(lastCorr.i)} ${quote(lastCorr, 80)})` + (fixed ? ', позже оператор её исправил' : ' и не была исправлена'));
      evidence.push(ev(lastCorr.i, 'violation', 'Клиент сообщает, что ответ не подходит'));
    }
    wrongAdv.forEach((t) => {
      parts.push(`ошибочная рекомендация: ${ref(t.i)} ${quote(t, 80)}`);
      evidence.push(ev(t.i, 'violation', 'Ошибочная рекомендация'));
    });
    if (leftOpen) {
      parts.push(`клиент остался с открытым вопросом: ${ref(lastC.i)} ${quote(lastC, 80)}`);
      evidence.push(ev(lastC.i, 'context', 'Вопрос остался открытым'));
    }
    if (sat) evidence.push(ev(sat.i, 'support', 'Клиент подтверждает результат'));

    const explanation = score >= 1
      ? `Запрос закрыт: ${ref(main.i)} ${quote(main, 100)}` + (sat ? `; клиент подтвердил результат — ${ref(sat.i)} ${quote(sat, 60)}.` : '.')
      : `Ответ по существу есть (${ref(main.i)} ${quote(main, 80)}), но ${parts.join('; ')}.`;

    return { verdict: score, confidence: ctx.isCall ? 0.55 : 0.72, explanation: explanation + asrNote(ctx), evidence };
  }

  // ---------------------------------------------------------------------------
  // 05 · Эмпатия и клиентоориентированность
  // ---------------------------------------------------------------------------
  function ruleEmpathy(ctx) {
    if (ctx.firstOp < 0) return noOperator();
    const T = ctx.turns;
    const ops = T.filter((t) => t.speaker === 'operator');

    const rude = ops.find((t) => RX.rude.test(t.n));
    if (rude) {
      return {
        verdict: 'no', confidence: 0.92,
        explanation: `Оператор невежлив: ${ref(rude.i)} ${quote(rude, 100)}.`,
        evidence: [ev(rude.i, 'violation', 'Невежливая реплика')]
      };
    }

    const dismiss = ops.find((t) => RX.dismissive.test(t.n));
    if (dismiss) {
      const c = prevOf(ctx, dismiss.i, 'client');
      return {
        verdict: 'no', confidence: 0.75,
        explanation: `Оператор отмахнулся от проблемы клиента: ${ref(dismiss.i)} ${quote(dismiss, 100)}` +
          (c ? ` — в ответ на ${ref(c.i)} ${quote(c, 80)}.` : '.'),
        evidence: [ev(dismiss.i, 'violation', 'Формальный ответ без реакции на проблему'), c && ev(c.i, 'context', 'Проблема клиента')].filter(Boolean)
      };
    }

    const empathyTurns = ops.filter((t) => RX.empathy.test(t.n));
    const emotions = T.filter((t) => t.speaker === 'client' && (RX.emotion.test(t.n) || RX.inconvenience.test(t.n)));
    for (const e of emotions) {
      const strong = RX.emotion.test(e.n);
      const nx = nextOf(ctx, e.i, 'operator');
      // Сильная эмоция требует явной реакции; на неудобство достаточно предметного решения.
      const reacted = empathyTurns.some((t) => t.i > e.i) || (!strong && !!nx && hasSubstance(nx));
      if (!reacted) {
        return {
          verdict: 'no', confidence: 0.72,
          explanation: `Клиент выразил недовольство (${ref(e.i)} ${quote(e, 90)}), но оператор не отреагировал на это` +
            (nx ? ` — следующий ответ: ${ref(nx.i)} ${quote(nx, 80)}.` : '.'),
          evidence: [ev(e.i, 'context', 'Недовольство клиента'), nx && ev(nx.i, 'expected', 'Здесь ожидалась реакция на проблему')].filter(Boolean)
        };
      }
    }

    const bare = ops.find((t) => {
      if (!isFarewellOnly(t)) return false;
      const c = prevOf(ctx, t.i, 'client');
      const o = prevOf(ctx, t.i, 'operator');
      return !!c && (!o || c.i > o.i) && (c.isQ || RX.insist.test(c.n));
    });
    if (bare) {
      const c = prevOf(ctx, bare.i, 'client');
      return {
        verdict: 'no', confidence: 0.7,
        explanation: `На вопрос клиента ${ref(c.i)} ${quote(c, 80)} оператор ответил только сухим прощанием — ${ref(bare.i)} ${quote(bare, 40)}.`,
        evidence: [ev(c.i, 'context', 'Вопрос клиента'), ev(bare.i, 'violation', 'Вопрос проигнорирован')]
      };
    }

    const emp = empathyTurns[0];
    return {
      verdict: 'yes', confidence: emp ? 0.85 : 0.7,
      explanation: emp
        ? `Оператор вежлив и реагирует на ситуацию клиента: ${ref(emp.i)} ${quote(emp)}.`
        : 'Оператор общается вежливо, грубых или формальных отписок нет; явного недовольства клиент не выражал.',
      evidence: emp ? [ev(emp.i, 'support', 'Проявление участия')] : [ev(ctx.firstOp, 'context', 'Тон общения оператора')]
    };
  }

  // ---------------------------------------------------------------------------
  // 06 · Управление диалогом, скорость и грамотность (шкала)
  // ---------------------------------------------------------------------------
  function ruleDialog(ctx) {
    if (ctx.firstOp < 0) return noOperator();
    const T = ctx.turns;
    const issues = [];
    const good = [];

    T.filter((t) => t.speaker === 'client' && t.i > ctx.firstOp && RX.reAsk.test(t.n) && prevOpAnswered(ctx, t.i)).forEach((c) => {
      const op = prevOf(ctx, c.i, 'operator');
      issues.push({
        kind: 'reask', weight: ctx.isCall ? 0.5 : 1,
        text: `клиенту пришлось переспросить (${ref(c.i)} ${quote(c, 60)}) после ${ref(op.i)} ${quote(op, 60)}`,
        evidence: [ev(op.i, 'violation', 'Неясная формулировка'), ev(c.i, 'support', 'Клиент переспрашивает')]
      });
    });

    if (!ctx.isCall) {
      T.forEach((o) => {
        if (o.speaker !== 'operator' || o.i <= ctx.firstOp) return;
        const prevOp = prevOf(ctx, o.i, 'operator');
        if (!prevOp) return;
        const firstClient = T.slice(prevOp.i + 1, o.i).find((t) => t.speaker === 'client');
        if (!firstClient || firstClient.sec == null || o.sec == null) return;
        const gap = o.sec - firstClient.sec;
        if (gap < WAIT_LIMIT_SEC) return;
        if (RX.waitWarn.test(prevOp.n)) {
          good.push({ text: `оператор предупредил об ожидании (${ref(prevOp.i)}) перед паузой ${U.clock(gap)}`, evidence: [ev(prevOp.i, 'support', 'Предупреждение об ожидании')] });
        } else {
          issues.push({
            kind: 'wait', weight: 1,
            text: `пауза ${U.clock(gap)} без предупреждения (${ref(firstClient.i)} → ${ref(o.i)})`,
            evidence: [ev(firstClient.i, 'context', 'Клиент ждёт ответа'), ev(o.i, 'violation', `Ответ через ${U.clock(gap)} без предупреждения`)]
          });
        }
      });
    } else {
      T.filter((t) => t.speaker === 'system' && RX.hold.test(t.n) && !RX.holdEnd.test(t.n)).forEach((h) => {
        const recent = T.slice(Math.max(0, h.i - 6), h.i).filter((t) => t.speaker === 'operator');
        const warn = recent.find((t) => RX.waitWarn.test(t.n));
        if (warn) {
          good.push({ text: `перед удержанием оператор предупредил клиента (${ref(warn.i)})`, evidence: [ev(warn.i, 'support', 'Предупреждение об ожидании'), ev(h.i, 'context', 'Удержание')] });
        } else {
          issues.push({ kind: 'hold', weight: 1, text: `клиента поставили на удержание без предупреждения (${ref(h.i)})`, evidence: [ev(h.i, 'violation', 'Удержание без предупреждения')] });
        }
      });
    }

    const load = Math.ceil(issues.reduce((a, x) => a + x.weight, 0) - 1e-9);
    const frac = [1, 0.7, 0.4, 0][Math.min(3, load)];
    const evidence = [].concat(...issues.map((x) => x.evidence), ...good.map((x) => x.evidence));
    if (!evidence.length) evidence.push(ev(ctx.firstOp, 'context', 'Начало ответа оператора'));

    let explanation;
    if (!issues.length) {
      explanation = 'Ответы ясные и последовательные, клиенту не пришлось переспрашивать' +
        (good.length ? `; ${good.map((g) => g.text).join('; ')}.` : '; долгих пауз без предупреждения нет.');
    } else {
      explanation = `Замечено сбоев: ${issues.length} — ${issues.map((x) => x.text).join('; ')}` +
        (good.length ? `. Плюс: ${good.map((g) => g.text).join('; ')}.` : '.');
    }
    return { verdict: frac, confidence: ctx.isCall ? 0.55 : 0.72, explanation: explanation + asrNote(ctx), evidence };
  }

  // ---------------------------------------------------------------------------
  // 07 · Завершение
  // ---------------------------------------------------------------------------
  function ruleClosing(ctx) {
    if (ctx.firstOp < 0) return noOperator();
    const T = ctx.turns;
    const ops = T.filter((t) => t.speaker === 'operator');
    const lastOps = ops.slice(-2);
    const lastOp = ops[ops.length - 1];
    const byeTurn = lastOps.slice().reverse().find((t) => RX.farewell.test(t.n));
    const summaryTurn = lastOps.slice().reverse().find((t) => RX.closingFormula.test(t.n));
    const endT = ctx.end.index >= 0 ? T[ctx.end.index] : null;

    if (!byeTurn && ctx.end.type === 'client_left') {
      return {
        verdict: 'na', confidence: 0.8,
        explanation: `Диалог прервался по инициативе клиента (${ref(endT.i)} ${quote(endT, 60)}) раньше, чем оператор мог его завершить.`,
        naReason: 'Чат оборвался до возможности его завершить.',
        evidence: [ev(endT.i, 'context', 'Обрыв диалога')]
      };
    }
    if (!byeTurn && ctx.end.type === 'operator_closed') {
      return {
        verdict: 'no', confidence: 0.9,
        explanation: `Оператор закрыл чат без прощания и итога: последняя реплика ${ref(lastOp.i)} ${quote(lastOp, 80)}, затем ${ref(endT.i)} ${quote(endT, 50)}.`,
        evidence: [ev(lastOp.i, 'expected', 'Здесь ожидались итог и прощание'), ev(endT.i, 'violation', 'Чат закрыт оператором')]
      };
    }
    if (!byeTurn) {
      const tail = T.slice(lastOp.i + 1).filter((t) => t.speaker === 'client');
      return {
        verdict: 'no', confidence: 0.82,
        explanation: tail.length
          ? `Последнее сообщение клиента (${ref(tail[tail.length - 1].i)} ${quote(tail[tail.length - 1], 70)}) осталось без ответа: оператор не подвёл итог и не попрощался.`
          : `Оператор не попрощался: последняя реплика ${ref(lastOp.i)} ${quote(lastOp, 80)}.`,
        evidence: [ev(lastOp.i, 'expected', 'Здесь ожидались итог и прощание')]
      };
    }

    const lastClient = prevOf(ctx, byeTurn.i, 'client');
    const satisfied = isSatisfied(lastClient);
    if (summaryTurn || satisfied) {
      return {
        verdict: 'yes', confidence: 0.85,
        explanation: (summaryTurn
          ? `Оператор подвёл итог / предложил помощь и попрощался: ${ref(summaryTurn.i)} ${quote(summaryTurn, 100)}`
          : `Клиент подтвердил результат (${ref(lastClient.i)} ${quote(lastClient, 60)}), оператор вежливо попрощался: ${ref(byeTurn.i)} ${quote(byeTurn, 80)}`) + '.',
        evidence: [summaryTurn && ev(summaryTurn.i, 'support', 'Итог / предложение помощи'), byeTurn !== summaryTurn && ev(byeTurn.i, 'support', 'Прощание')].filter(Boolean)
      };
    }
    return {
      verdict: 'no', confidence: 0.72,
      explanation: `Оператор попрощался (${ref(byeTurn.i)} ${quote(byeTurn, 60)}), но не подвёл итог и не предложил помощь` +
        (lastClient ? `, хотя клиент ещё ждал ответа: ${ref(lastClient.i)} ${quote(lastClient, 70)}.` : '.'),
      evidence: [lastClient && ev(lastClient.i, 'context', 'Последняя реплика клиента'), ev(byeTurn.i, 'expected', 'Здесь ожидались итог или предложение помощи')].filter(Boolean)
    };
  }

  // ---------------------------------------------------------------------------
  // 08 · Грубые ошибки (флаг)
  // ---------------------------------------------------------------------------
  function ruleGross(ctx) {
    const T = ctx.turns;
    const found = [];
    T.forEach((t) => {
      if (t.speaker !== 'operator') return;
      if (RX.rude.test(t.n)) found.push({ t, type: 'Оскорбление клиента' });
      if (RX.bypass.test(t.n)) found.push({ t, type: 'Предложение платной услуги в обход компании' });
    });
    const a = analyzeIdentification(ctx);
    if (a.early >= 0) found.push({ t: T[a.early], type: 'Раскрытие конфиденциальной информации без идентификации' });

    if (found.length) {
      return {
        verdict: 'yes', confidence: 0.85,
        explanation: 'Выявлено: ' + found.map((f) => `${f.type.toLowerCase()} — ${ref(f.t.i)} ${quote(f.t, 90)}`).join('; ') + '.',
        evidence: found.map((f) => ev(f.t.i, 'violation', f.type)),
        tags: Array.from(new Set(found.map((f) => f.type)))
      };
    }
    const n = T.filter((t) => t.speaker === 'operator').length;
    return {
      verdict: 'no', confidence: 0.8,
      explanation: `Оскорблений, предложений платных услуг в обход компании и раскрытия конфиденциальной информации не выявлено (проверено ${n} ${U.plural(n, 'реплика', 'реплики', 'реплик')} оператора).`,
      evidence: []
    };
  }

  // ---------------------------------------------------------------------------
  // Настраиваемый критерий: фразы-признаки
  // ---------------------------------------------------------------------------
  function phraseList(v) {
    return (Array.isArray(v) ? v : String(v || '').split(/[\n;]/)).map((x) => U.norm(x)).filter(Boolean);
  }

  function ruleKeywords(ctx, c) {
    const T = ctx.turns;
    const kw = c.keywords || {};
    const speaker = kw.speaker || 'operator';
    const trig = phraseList(kw.trigger);
    const pos = phraseList(kw.positive);
    const neg = phraseList(kw.negative);
    const who = speaker === 'client' ? 'клиента' : 'оператора';

    if (!pos.length && !neg.length) {
      return {
        verdict: 'na', forceNA: !c.allowNA, confidence: 0.1, needsModel: true,
        explanation: 'Для критерия не заданы фразы-признаки. Локальный движок не может его оценить — заполните признаки в конструкторе или подключите backend-модель.',
        naReason: 'Нет правил для локальной оценки.', evidence: []
      };
    }

    let trigger = null;
    if (trig.length) {
      trigger = T.find((t) => t.speaker === 'client' && trig.some((k) => t.n.includes(k)));
      if (!trigger) {
        return {
          verdict: 'na', confidence: 0.7,
          explanation: `Условие применимости не выполнено: в репликах клиента нет признаков (${trig.join(', ')}).`,
          naReason: c.naCondition || 'Условие применимости не выполнено.', evidence: []
        };
      }
    }
    const from = trigger ? trigger.i : 0;
    const scope = T.filter((t) => t.speaker === speaker && t.i >= from);
    const negHit = scope.find((t) => neg.some((k) => t.n.includes(k)));
    if (negHit) {
      const k = neg.find((x) => negHit.n.includes(x));
      return {
        verdict: c.type === 'flag' ? 'no' : 'no', confidence: 0.75,
        explanation: `Найден признак нарушения «${k}» в реплике ${who}: ${ref(negHit.i)} ${quote(negHit, 100)}.`,
        evidence: [trigger && ev(trigger.i, 'context', 'Условие применимости'), ev(negHit.i, 'violation', `Признак нарушения: «${k}»`)].filter(Boolean)
      };
    }
    const posHit = scope.find((t) => pos.some((k) => t.n.includes(k)));
    if (posHit) {
      const k = pos.find((x) => posHit.n.includes(x));
      return {
        verdict: 'yes', confidence: 0.75,
        explanation: `Найден признак выполнения «${k}» в реплике ${who}: ${ref(posHit.i)} ${quote(posHit, 100)}.`,
        evidence: [trigger && ev(trigger.i, 'context', 'Условие применимости'), ev(posHit.i, 'support', `Признак: «${k}»`)].filter(Boolean)
      };
    }
    const expectedAt = trigger ? nextOf(ctx, trigger.i, 'operator') : T[ctx.opIdx[ctx.opIdx.length - 1]];
    return {
      verdict: 'no', confidence: 0.6,
      explanation: pos.length
        ? `В репликах ${who} не найдено ни одного признака выполнения (${pos.join(', ')})` + (trigger ? ` после ${ref(trigger.i)}.` : '.')
        : 'Признаков нарушения не найдено.',
      evidence: [trigger && ev(trigger.i, 'context', 'Условие применимости'), expectedAt && ev(expectedAt.i, 'expected', 'Здесь ожидалось действие')].filter(Boolean)
    };
  }

  // ---------------------------------------------------------------------------
  // Реестр правил и сборка результата
  // ---------------------------------------------------------------------------
  const RULES = {
    greeting: { fn: ruleGreeting, label: 'Приветствие и представление в первом ответе', kind: 'binary' },
    needs: { fn: ruleNeeds, label: 'Уточнение недостающих деталей до ответа', kind: 'binary' },
    identification: { fn: ruleIdentification, label: 'Идентификация до раскрытия данных', kind: 'binary' },
    consultation: { fn: ruleConsultation, label: 'Полнота и корректность ответа', kind: 'scale' },
    empathy: { fn: ruleEmpathy, label: 'Вежливость и реакция на проблему', kind: 'binary' },
    dialog: { fn: ruleDialog, label: 'Ясность, порядок ответов, ожидание', kind: 'scale' },
    closing: { fn: ruleClosing, label: 'Итог / предложение помощи и прощание', kind: 'binary' },
    gross: { fn: ruleGross, label: 'Оскорбление, услуги в обход компании, раскрытие данных', kind: 'flag' },
    keywords: { fn: ruleKeywords, label: 'По фразам-признакам (настраиваемый)', kind: 'any' }
  };

  /** Вердикт правила → ответ в формате критерия (с учётом типа, шкалы и N/A). */
  function toAnswer(c, r) {
    const v = r.verdict;
    if (v === 'na') {
      if (c.allowNA || r.forceNA) return { answer: 'na' };
      return {
        answer: c.type === 'scale' ? CQA.scoring.scaleMax(c) : c.type === 'flag' ? 'no' : 'yes',
        note: 'N/A для критерия не разрешён настройками — засчитано как выполнено.'
      };
    }
    const frac = typeof v === 'number' ? Math.max(0, Math.min(1, v)) : v === 'yes' ? 1 : 0;
    if (c.type === 'scale') {
      const steps = CQA.scoring.scaleSteps(c);
      if (!steps.length) return { answer: 0 };
      const max = steps[0];
      const target = frac * max;
      let best = steps[steps.length - 1];
      steps.forEach((s) => { if (Math.abs(s - target) < Math.abs(best - target) - 1e-9) best = s; });
      return { answer: best };
    }
    return { answer: frac >= 0.5 ? 'yes' : 'no' };
  }

  function evaluateCriterion(ctx, c) {
    const rule = RULES[c.rule] || RULES.keywords;
    let r;
    try {
      r = rule.fn(ctx, c);
    } catch (e) {
      r = { verdict: 'na', forceNA: true, confidence: 0, explanation: `Ошибка правила: ${e.message}`, evidence: [] };
    }
    const mapped = toAnswer(c, r);
    return {
      criterionId: c.id,
      answer: mapped.answer,
      explanation: r.explanation + (mapped.note ? ` ${mapped.note}` : ''),
      naReason: mapped.answer === 'na' ? r.naReason || c.naCondition || '' : '',
      evidence: (r.evidence || []).filter((e) => e && e.turn >= 0 && e.turn < ctx.turns.length),
      confidence: r.confidence == null ? null : U.round2(r.confidence),
      tags: r.tags || []
    };
  }

  /**
   * Оценка диалога по чек-листу.
   * @returns {{ results: Array, meta: Object }}
   */
  function evaluate(dialog, checklist) {
    const ctx = prepare(dialog);
    const results = (checklist.criteria || [])
      .filter((c) => c.enabled !== false)
      .map((c) => evaluateCriterion(ctx, c));
    return {
      results,
      meta: {
        engine: ENGINE_ID,
        language: ctx.clientLang,
        channel: ctx.isCall ? 'voice call' : 'agent chat',
        turns: ctx.turns.length,
        operatorTurns: ctx.opIdx.length
      }
    };
  }

  /** Смещение реплик звонка относительно начала записи (с учётом пауз записи). */
  function audioOffsets(dialog) {
    const raw = Array.isArray(dialog && dialog.transcript) ? dialog.transcript : [];
    const abs = raw.map((t) => U.parseTs(t && t.timestamp));
    const startIdx = raw.findIndex((t) => /запись и транскрибирование запущены|жазу және транскрипция басталды|recording (and transcription )?started/i.test(String(t && t.text)));
    const base = startIdx >= 0 && abs[startIdx] != null ? abs[startIdx] : abs.find((x) => x != null);
    let paused = 0;
    let pauseAt = null;
    return raw.map((t, i) => {
      const txt = U.norm(t && t.text);
      const a = abs[i];
      if (a == null || base == null) return null;
      if (/приостановлены|recording (and transcription )?paused|тоқтатылды/.test(txt) && pauseAt == null) pauseAt = a;
      if (/возобновлены|recording (and transcription )?resumed|жалғасты/.test(txt) && pauseAt != null) {
        paused += Math.max(0, a - pauseAt);
        pauseAt = null;
      }
      const inPause = pauseAt != null ? a - pauseAt : 0;
      return Math.max(0, a - base - paused - inPause);
    });
  }

  CQA.engine = {
    ID: ENGINE_ID,
    RULES: Object.keys(RULES).map((id) => ({ id, label: RULES[id].label, kind: RULES[id].kind })),
    evaluate,
    prepare,
    detectLang,
    audioOffsets,
    _rx: RX
  };
})(typeof window !== 'undefined' ? (window.CQA = window.CQA || {}) : (globalThis.CQA = globalThis.CQA || {}));
