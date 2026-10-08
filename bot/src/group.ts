import { env } from './config.js';

// Темы группы «Pattern_analyst 🧮» (форум-режим Telegram).
//
// Зачем (аудит 07.10.2026): в группу каждый день падают два файла бэкапа, и
// лента сводок и заказов тонет в них. Темы разводят потоки: «📊 Сводки»,
// «🗄 Бэкапы», «📥 Заказы» — история чата по-прежнему архив, но читаемый.
//
// Темы НЕОБЯЗАТЕЛЬНЫ. Пока номера тем не заданы в env, всё уходит в группу
// как раньше. Ответы на команды grammY сам отправляет в ту же тему, где
// команду написали, — здесь только сообщения, которые бот шлёт сам.

export type GroupTopic = 'summary' | 'backup' | 'orders';

const TOPIC_ID: Record<GroupTopic, string> = {
  summary: env.topicSummary, // ежедневная сводка, /report, итоги циклов
  backup: env.topicBackup, // backup-full-*.json и purchases-*.csv
  orders: env.topicOrders, // посты о новых заказах
};

/** Опции отправки в нужную тему; пусто, если темы не настроены. */
export function inTopic(kind: GroupTopic): { message_thread_id?: number } {
  const id = Number(TOPIC_ID[kind]);
  return Number.isInteger(id) && id > 0 ? { message_thread_id: id } : {};
}
