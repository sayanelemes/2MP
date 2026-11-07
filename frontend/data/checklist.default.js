/* Исходный чек-лист из CQA_Chat_Quality_Checklist.pdf — стартовая конфигурация оценки.
 * Поле rule — правило локального движка (js/core/engine.js). При подключении backend
 * модель получает формулировки description / naCondition / scale и оценивает по ним. */
(function (CQA) {
  'use strict';

  CQA.DEFAULT_CHECKLIST = {
    id: 'cl-chat-quality',
    name: 'Чек-лист качества чатов',
    version: 1,
    note: 'Исходная конфигурация из PDF организаторов',
    sections: [
      { id: 'start', title: 'Начало и понимание запроса' },
      { id: 'safety', title: 'Безопасность и решение' },
      { id: 'flow', title: 'Ведение и завершение диалога' },
      { id: 'critical', title: 'Грубые нарушения' }
    ],
    criteria: [
      {
        id: 'c01', code: '01', sectionId: 'start', enabled: true,
        title: 'Установление контакта',
        type: 'binary', weight: 10, allowNA: false,
        description: 'Да — оператор поздоровался на языке клиента и представился в первом ответе.',
        naCondition: '',
        rule: 'greeting'
      },
      {
        id: 'c02', code: '02', sectionId: 'start', enabled: true,
        title: 'Выявление потребности',
        type: 'binary', weight: 15, allowNA: true,
        description: 'Да — оператор учёл известные детали и уточнил недостающее до ответа.',
        naCondition: 'Данных для ответа хватало с самого начала.',
        rule: 'needs'
      },
      {
        id: 'c03', code: '03', sectionId: 'safety', enabled: true,
        title: 'Идентификация',
        type: 'binary', weight: 20, allowNA: true,
        description: 'Да — проверка личности подтверждена до раскрытия данных или защищённого действия.',
        naCondition: 'Запрос не требовал идентификации.',
        rule: 'identification'
      },
      {
        id: 'c04', code: '04', sectionId: 'safety', enabled: true,
        title: 'Корректная и полная консультация',
        type: 'scale', weight: 20, allowNA: true,
        description: 'Оцените ответ или следующий шаг по шкале.',
        naCondition: 'Чат закончился до того, как клиент сформулировал запрос.',
        rule: 'consultation',
        scale: [
          { value: 20, label: 'Все существенные вопросы закрыты или дан корректный следующий шаг.' },
          { value: 15, label: 'Основной вопрос решён, пропущена второстепенная деталь.' },
          { value: 10, label: 'Часть запроса закрыта, существенный вопрос остался открытым.' },
          { value: 5, label: 'Есть общая подсказка, но клиенту всё ещё непонятно, как действовать.' },
          { value: 0, label: 'Ответа по существу нет или ключевая рекомендация ошибочна.' }
        ]
      },
      {
        id: 'c05', code: '05', sectionId: 'flow', enabled: true,
        title: 'Эмпатия и клиентоориентированность',
        type: 'binary', weight: 15, allowNA: false,
        description: 'Да — оператор вежлив и, если клиент выразил недовольство или описал неудобство, отреагировал на конкретную проблему.',
        naCondition: '',
        rule: 'empathy'
      },
      {
        id: 'c06', code: '06', sectionId: 'flow', enabled: true,
        title: 'Управление диалогом, скорость и грамотность',
        type: 'scale', weight: 15, allowNA: false,
        description: 'Оцените ясность, порядок ответов и предупреждение об ожидании.',
        naCondition: '',
        rule: 'dialog',
        scale: [
          { value: 10, label: 'Ответы ясные и связные. Если было явное ожидание, оператор предупредил.' },
          { value: 7, label: 'Один заметный сбой, но клиент может понять ответ и продолжить.' },
          { value: 4, label: 'Клиенту приходится переспрашивать из-за формулировок или порядка ответов.' },
          { value: 0, label: 'Из-за бессвязных или противоречивых реплик ход диалога непонятен.' }
        ]
      },
      {
        id: 'c07', code: '07', sectionId: 'flow', enabled: true,
        title: 'Завершение',
        type: 'binary', weight: 5, allowNA: true,
        description: 'Да — оператор подвёл итог или предложил дальнейшую помощь и попрощался.',
        naCondition: 'Чат оборвался до возможности его завершить.',
        rule: 'closing'
      },
      {
        id: 'c08', code: '08', sectionId: 'critical', enabled: true,
        title: 'Грубые ошибки',
        type: 'flag', weight: 0, allowNA: false,
        description: 'Да — выявлено оскорбление клиента, предложение платной услуги в обход компании или раскрытие конфиденциальной информации. Нет — ни одно из трёх не выявлено.',
        naCondition: '',
        rule: 'gross'
      }
    ]
  };
})(typeof window !== 'undefined' ? (window.CQA = window.CQA || {}) : (globalThis.CQA = globalThis.CQA || {}));
