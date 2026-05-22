import type { LeadStage } from "./types";

export const leadStages: LeadStage[] = ["new", "contacted", "qualified", "quoted", "negotiating", "booked", "lost", "not_lead"];

export const activeLeadStages: LeadStage[] = ["new", "contacted", "qualified", "quoted", "negotiating"];

export const leadStageMeta: Record<LeadStage, { ru: string; en: string; descRu: string; descEn: string; zoneRu: string; zoneEn: string; actionsRu: string[]; actionsEn: string[] }> = {
  new: {
    ru: "Новый лид",
    en: "New lead",
    descRu: "Лид только поступил. Источник, канал, кампания и текст запроса должны быть зафиксированы сразу.",
    descEn: "A lead has just arrived. Source, channel, campaign and request text should be captured immediately.",
    zoneRu: "Лидогенерация",
    zoneEn: "Lead generation",
    actionsRu: ["авто-запись", "уведомление", "SLA 60 мин"],
    actionsEn: ["auto-capture", "notification", "60 min SLA"]
  },
  contacted: {
    ru: "Контакт установлен",
    en: "Contacted",
    descRu: "Первый ответ отправлен. Диалог открыт, задача — перевести клиента к квалификации.",
    descEn: "First response sent. Conversation is open; move the customer toward qualification.",
    zoneRu: "Продажа",
    zoneEn: "Sales",
    actionsRu: ["первый ответ", "даты", "категория"],
    actionsEn: ["first reply", "dates", "category"]
  },
  qualified: {
    ru: "Квалифицирован",
    en: "Qualified",
    descRu: "Понятны даты, класс авто, бюджет и документы. Можно готовить конкретное предложение.",
    descEn: "Dates, car class, budget and documents are clear. A concrete offer can be prepared.",
    zoneRu: "Продажа",
    zoneEn: "Sales",
    actionsRu: ["IDP", "бюджет", "доступность"],
    actionsEn: ["IDP", "budget", "availability"]
  },
  quoted: {
    ru: "Предложение отправлено",
    en: "Quoted",
    descRu: "Клиент получил автомобиль, цену за период и условия депозита/доставки.",
    descEn: "Customer received vehicle, total period price and deposit/delivery terms.",
    zoneRu: "Продажа",
    zoneEn: "Sales",
    actionsRu: ["авто + номер", "цена за период", "условия"],
    actionsEn: ["car + plate", "period price", "terms"]
  },
  negotiating: {
    ru: "Обсуждение / дожим",
    en: "Negotiating",
    descRu: "Клиент думает, торгуется или задает вопросы. Нужны напоминания и следующий шаг.",
    descEn: "Customer is considering, bargaining or asking questions. Reminders and next action are required.",
    zoneRu: "Продажа",
    zoneEn: "Sales",
    actionsRu: ["возражения", "follow-up", "ограниченность"],
    actionsEn: ["objections", "follow-up", "scarcity"]
  },
  booked: {
    ru: "Бронь подтверждена",
    en: "Booked",
    descRu: "Авто закреплено за клиентом. Дальше бронь уходит в выдачу, оплату и календарь.",
    descEn: "Vehicle is reserved for the customer. The booking moves to handover, payment and calendar.",
    zoneRu: "Операции",
    zoneEn: "Operations",
    actionsRu: ["бронь", "предоплата", "календарь"],
    actionsEn: ["booking", "prepayment", "calendar"]
  },
  lost: {
    ru: "Потерян",
    en: "Lost",
    descRu: "Причина отказа фиксируется, клиент остается в базе для будущего ретеншн-касания.",
    descEn: "Loss reason is recorded; customer stays in the base for future retention.",
    zoneRu: "Ретеншн",
    zoneEn: "Retention",
    actionsRu: ["причина", "повторное касание", "промокод"],
    actionsEn: ["reason", "re-engage", "promo"]
  },
  not_lead: {
    ru: "Не лид",
    en: "Not a lead",
    descRu: "Сообщение не относится к аренде авто. Убирается из рабочей воронки, но остается в истории.",
    descEn: "Message is not related to car rental. It is removed from the sales pipeline but kept in history.",
    zoneRu: "Не продажи",
    zoneEn: "Non-sales",
    actionsRu: ["личное", "спам", "не про авто"],
    actionsEn: ["personal", "spam", "not cars"]
  }
};

export function leadStageLabel(stage: LeadStage, locale: "ru" | "en") {
  return locale === "en" ? leadStageMeta[stage].en : leadStageMeta[stage].ru;
}

export function isActiveLeadStage(stage: LeadStage) {
  return activeLeadStages.includes(stage);
}
