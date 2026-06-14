"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUserContext } from "./repository";
import { createTask, deleteTask, updateTask } from "./task-repository";
import type { TaskPriority, TaskStatus } from "./types";

export type ActionResult = {
  ok: boolean;
  message: string;
  id?: string;
};

function actionOk(message: string, id?: string): ActionResult {
  return { ok: true, message, id };
}

function actionError(message: string): ActionResult {
  return { ok: false, message };
}

async function requireOwnerRole() {
  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    return null;
  }
  if (user.role !== "owner") {
    return null;
  }
  return user;
}

const createTaskSchema = z.object({
  title: z.string().min(1, "Название задачи обязательно"),
  description: z.string().optional().nullable(),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  assigned_to: z.string().uuid().optional().nullable().or(z.literal("")),
  due_date: z.string().optional().nullable().or(z.literal(""))
});

export async function createTaskAction(formData: FormData): Promise<ActionResult> {
  const currentUser = await requireOwnerRole();
  if (!currentUser) return actionError("Только владелец может управлять задачами.");

  const rawAssigned = formData.get("assigned_to");
  const rawDueDate = formData.get("due_date");

  const parsed = createTaskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    status: formData.get("status") || "todo",
    priority: formData.get("priority") || "medium",
    assigned_to: rawAssigned === "unassigned" || rawAssigned === "" ? null : rawAssigned,
    due_date: rawDueDate === "" ? null : rawDueDate
  });

  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте правильность заполнения полей.");
  }

  const input = parsed.data;

  try {
    const created = await createTask(currentUser.tenantId, {
      title: input.title,
      description: input.description || null,
      status: input.status as TaskStatus,
      priority: input.priority as TaskPriority,
      assigned_to: input.assigned_to || null,
      created_by: currentUser.appUserId,
      due_date: input.due_date || null
    });

    revalidatePath("/users");

    if (input.assigned_to) {
      sendMessengerNotification(
        currentUser.tenantId,
        input.assigned_to,
        input.title,
        input.description || null,
        input.priority,
        input.due_date || null
      ).catch((err) => console.error("Notification trigger failed:", err));
    }

    return actionOk("Задача успешно создана.", created?.id);
  } catch (error: any) {
    return actionError(error.message || "Не удалось создать задачу.");
  }
}

const updateTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, "Название задачи обязательно"),
  description: z.string().optional().nullable(),
  status: z.enum(["todo", "in_progress", "done"]),
  priority: z.enum(["low", "medium", "high"]),
  assigned_to: z.string().uuid().optional().nullable().or(z.literal("")),
  due_date: z.string().optional().nullable().or(z.literal(""))
});

export async function updateTaskAction(formData: FormData): Promise<ActionResult> {
  const currentUser = await requireOwnerRole();
  if (!currentUser) return actionError("Только владелец может управлять задачами.");

  const rawAssigned = formData.get("assigned_to");
  const rawDueDate = formData.get("due_date");

  const parsed = updateTaskSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description"),
    status: formData.get("status"),
    priority: formData.get("priority"),
    assigned_to: rawAssigned === "unassigned" || rawAssigned === "" ? null : rawAssigned,
    due_date: rawDueDate === "" ? null : rawDueDate
  });

  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте правильность заполнения полей.");
  }

  const input = parsed.data;

  try {
    await updateTask(currentUser.tenantId, input.id, {
      title: input.title,
      description: input.description || null,
      status: input.status as TaskStatus,
      priority: input.priority as TaskPriority,
      assigned_to: input.assigned_to || null,
      due_date: input.due_date || null
    });

    revalidatePath("/users");

    if (input.assigned_to) {
      sendMessengerNotification(
        currentUser.tenantId,
        input.assigned_to,
        `[Обновлено] ${input.title}`,
        input.description || null,
        input.priority,
        input.due_date || null
      ).catch((err) => console.error("Notification trigger failed:", err));
    }

    return actionOk("Задача успешно обновлена.");
  } catch (error: any) {
    return actionError(error.message || "Не удалось обновить задачу.");
  }
}

const moveTaskSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["todo", "in_progress", "done"])
});

export async function moveTaskStatusAction(formData: FormData): Promise<ActionResult> {
  const currentUser = await requireOwnerRole();
  if (!currentUser) return actionError("Только владелец может управлять задачами.");

  const parsed = moveTaskSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status")
  });

  if (!parsed.success) {
    return actionError("Неверный формат идентификатора или статуса.");
  }

  const input = parsed.data;

  try {
    await updateTask(currentUser.tenantId, input.id, {
      status: input.status as TaskStatus
    });

    revalidatePath("/users");
    return actionOk("Статус задачи успешно обновлен.");
  } catch (error: any) {
    return actionError(error.message || "Не удалось переместить задачу.");
  }
}

const deleteTaskSchema = z.object({
  id: z.string().uuid()
});

export async function deleteTaskAction(formData: FormData): Promise<ActionResult> {
  const currentUser = await requireOwnerRole();
  if (!currentUser) return actionError("Только владелец может управлять задачами.");

  const parsed = deleteTaskSchema.safeParse({
    id: formData.get("id")
  });

  if (!parsed.success) {
    return actionError("Неверный идентификатор задачи.");
  }

  const input = parsed.data;

  try {
    await deleteTask(currentUser.tenantId, input.id);

    revalidatePath("/users");
    return actionOk("Задача успешно удалена.");
  } catch (error: any) {
    return actionError(error.message || "Не удалось удалить задачу.");
  }
}

async function sendMessengerNotification(
  tenantId: string,
  assigneeId: string,
  taskTitle: string,
  taskDescription: string | null,
  priority: string,
  dueDate: string | null
) {
  const { createServiceSupabaseClient } = await import("./supabase");
  const supabase = createServiceSupabaseClient();
  
  // 1. Fetch user contact details
  const { data: user, error } = await supabase
    .from("app_users")
    .select("full_name, phone, telegram_username")
    .eq("id", assigneeId)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();

  if (error || !user) {
    console.error("Failed to fetch assignee details for notification:", error?.message);
    return;
  }

  const priorityLabel = priority === "high" ? "🔴 Высокий" : priority === "medium" ? "🟡 Средний" : "🟢 Низкий";
  const dateStr = dueDate ? new Date(dueDate).toLocaleDateString("ru-RU") : "Не указан";
  
  // WhatsApp uses asterisks for bolding
  const whatsappMessage = `📋 *Назначена задача!*\n\n` +
    `📌 *Название:* ${taskTitle}\n` +
    `${taskDescription ? `📖 *Описание:* ${taskDescription}\n` : ""}` +
    `⚡ *Приоритет:* ${priorityLabel}\n` +
    `📅 *Срок:* ${dateStr}\n\n` +
    `Пожалуйста, проверьте доску задач в CRM.`;

  // Telegram uses ALL CAPS for bold headers to stay clean if parse_mode is not enabled
  const telegramMessage = `📋 НАЗНАЧЕНА ЗАДАЧА!\n\n` +
    `📌 Название: ${taskTitle}\n` +
    `${taskDescription ? `📖 Описание: ${taskDescription}\n` : ""}` +
    `⚡ Приоритет: ${priorityLabel}\n` +
    `📅 Срок: ${dateStr}\n\n` +
    `Пожалуйста, проверьте доску задач в CRM.`;

  // 2. Send push notification via ntfy.sh (fallback/push)
  if (process.env.NTFY_TOPIC) {
    fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: "POST",
      body: `Новая задача для ${user.full_name}: ${taskTitle} (Приоритет: ${priorityLabel}, Срок: ${dateStr})`,
      headers: {
        Title: "CRM: Назначена Задача!",
        Priority: "high"
      }
    }).catch(() => undefined);
  }

  // 3. Send direct messenger messages if secret is configured
  const messagingSecret = process.env.EPICENTER_MESSAGING_SECRET || "00d57c65010537e2d52f8979d0ef8c88204410a4dcf7b6b36187879c08a05034";

  // Telegram direct message
  if (user.telegram_username) {
    let cleanedTg = user.telegram_username.trim();
    cleanedTg = cleanedTg.replace(/^(https?:\/\/)?(www\.)?t\.me\//i, "");
    cleanedTg = cleanedTg.replace(/^@/, "");

    if (cleanedTg) {
      const tgUsername = `@${cleanedTg}`;
      fetch(process.env.TELEGRAM_SEND_URL || "https://n8nx.pro/epicenter-messaging/telegram/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-epicenter-messaging-secret": messagingSecret
        },
        body: JSON.stringify({
          TelegramUsername: tgUsername,
          messageText: telegramMessage
        })
      }).catch(() => undefined);
    }
  }

  // WhatsApp direct message
  if (user.phone) {
    fetch(process.env.WHATSAPP_SEND_URL || "https://n8nx.pro/webhook/whatsappOutboundWfCR/webhook/epicenter-messaging/whatsapp/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-epicenter-messaging-secret": messagingSecret
      },
      body: JSON.stringify({
        phoneNumber: user.phone,
        messageText: whatsappMessage
      })
    }).catch(() => undefined);
  }
}
