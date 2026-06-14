import { unstable_noStore as noStore } from "next/cache";
import { createServiceSupabaseClient, hasSupabaseEnv } from "./supabase";
import type { CrmTask } from "./types";

export async function getTasks(tenantId: string): Promise<CrmTask[]> {
  noStore();
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("crm_tasks")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching tasks:", error.message);
    return [];
  }

  return (data || []) as CrmTask[];
}

export async function createTask(tenantId: string, task: Omit<CrmTask, "id" | "tenant_id" | "created_at" | "updated_at">): Promise<CrmTask | null> {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("crm_tasks")
    .insert({
      tenant_id: tenantId,
      title: task.title,
      description: task.description || null,
      status: task.status || "todo",
      priority: task.priority || "medium",
      assigned_to: task.assigned_to || null,
      created_by: task.created_by || null,
      due_date: task.due_date || null
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating task:", error.message);
    throw new Error(error.message);
  }

  return data as CrmTask;
}

export async function updateTask(tenantId: string, taskId: string, task: Partial<Omit<CrmTask, "id" | "tenant_id" | "created_at" | "updated_at">>): Promise<void> {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("crm_tasks")
    .update({
      ...task,
      updated_at: new Date().toISOString()
    })
    .eq("id", taskId)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("Error updating task:", error.message);
    throw new Error(error.message);
  }
}

export async function deleteTask(tenantId: string, taskId: string): Promise<void> {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("crm_tasks")
    .delete()
    .eq("id", taskId)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("Error deleting task:", error.message);
    throw new Error(error.message);
  }
}
