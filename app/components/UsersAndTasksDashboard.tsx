"use client";

import React, { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { formatDisplayDate } from "@/lib/i18n";
import type { AppUser, CrmTask, TaskPriority, TaskStatus } from "@/lib/types";
import {
  createTaskAction,
  updateTaskAction,
  moveTaskStatusAction,
  deleteTaskAction
} from "@/lib/task-actions";
import {
  createAppUserAction,
  updateAppUserAction,
  changeUserPasswordAction,
  deleteUserWithTransferAction,
  uploadAvatarAction
} from "@/lib/actions";

type UsersAndTasksDashboardProps = {
  users: AppUser[];
  tasks: CrmTask[];
  locale: Locale;
  currentUser: any;
};

export function UsersAndTasksDashboard({ users, tasks, locale, currentUser }: UsersAndTasksDashboardProps) {
  const [activeTab, setActiveTab] = useState<"team" | "tasks">("tasks");

  // Task Filter States
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [groupingMode, setGroupingMode] = useState<"status" | "assignee">("status");

  // Modals & Active Edit States
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [changingPasswordUser, setChangingPasswordUser] = useState<AppUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<AppUser | null>(null);

  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [editingTask, setEditingTask] = useState<CrmTask | null>(null);

  // Form result banners
  const [actionFeedback, setActionFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingUserId, setUploadingUserId] = useState<string | null>(null);

  const handleEditAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>, userId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingUserId(userId);
    try {
      const fd = new FormData();
      fd.append("user_id", userId);
      fd.append("file", file);

      const res = await uploadAvatarAction(fd);
      if (res && res.ok) {
        alert(tx("Фотография обновлена!", "Photo updated!"));
        window.location.reload();
      } else {
        alert(res?.message || tx("Ошибка загрузки", "Upload failed"));
      }
    } catch (err: any) {
      alert(err.message || tx("Ошибка загрузки", "Upload failed"));
    } finally {
      setUploadingUserId(null);
    }
  };

  const tx = (ru: string, en: string) => (locale === "en" ? en : ru);

  const handleAction = async (actionFn: (fd: FormData) => Promise<any>, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    setActionFeedback(null);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await actionFn(fd);
      if (res && res.ok) {
        setActionFeedback({ ok: true, message: res.message });
        setTimeout(() => {
          setActionFeedback(null);
          // Close modals
          setIsCreatingUser(false);
          setEditingUser(null);
          setChangingPasswordUser(null);
          setDeletingUser(null);
          setIsCreatingTask(false);
          setEditingTask(null);
          window.location.reload();
        }, 1500);
      } else {
        setActionFeedback({ ok: false, message: res?.message || "Ошибка выполнения действия." });
      }
    } catch (err: any) {
      setActionFeedback({ ok: false, message: err.message || "Системная ошибка." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickMove = async (taskId: string, newStatus: TaskStatus) => {
    try {
      const fd = new FormData();
      fd.append("id", taskId);
      fd.append("status", newStatus);
      const res = await moveTaskStatusAction(fd);
      if (res.ok) {
        window.location.reload();
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert("Не удалось обновить статус: " + err.message);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm(tx("Вы уверены, что хотите удалить эту задачу?", "Are you sure you want to delete this task?"))) return;
    try {
      const fd = new FormData();
      fd.append("id", taskId);
      const res = await deleteTaskAction(fd);
      if (res.ok) {
        window.location.reload();
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert("Не удалось удалить задачу: " + err.message);
    }
  };

  // Filter Tasks
  const filteredTasks = tasks.filter((t) => {
    if (assigneeFilter === "all") return true;
    if (assigneeFilter === "unassigned") return t.assigned_to === null;
    return t.assigned_to === assigneeFilter;
  });

  const getInitials = (name: string) => {
    if (!name) return "?";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const getUserColor = (userId: string | null) => {
    if (!userId) return "#6c757d";
    const colors = ["#005f73", "#0a9396", "#94d2bd", "#ee9b00", "#ca6702", "#bb3e03", "#ae2012", "#9b2226"];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getUserName = (userId: string | null) => {
    if (!userId) return tx("Не назначено", "Unassigned");
    const user = users.find(u => u.id === userId);
    return user ? user.full_name : tx("Неизвестный сотрудник", "Unknown Employee");
  };

  const renderUserAvatar = (userId: string | null, size: number = 24) => {
    if (!userId) {
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: "50%",
          backgroundColor: "#475569",
          color: "#fff",
          fontWeight: "bold",
          fontSize: `${size * 0.4}px`
        }}>
          ?
        </span>
      );
    }

    const u = users.find(user => user.id === userId);
    if (u && u.avatar_url) {
      return (
        <img
          src={u.avatar_url}
          alt={u.full_name}
          style={{
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: "50%",
            objectFit: "cover",
            border: "1px solid rgba(255, 255, 255, 0.1)"
          }}
        />
      );
    }

    return (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        backgroundColor: getUserColor(userId),
        color: "#fff",
        fontWeight: "bold",
        fontSize: `${size * 0.4}px`
      }}>
        {getInitials(u ? u.full_name : "?")}
      </span>
    );
  };

  function TaskCard({ task }: { task: CrmTask }) {
    const priorityLabels = {
      low: tx("Низкий", "Low"),
      medium: tx("Средний", "Medium"),
      high: tx("Высокий", "High")
    };
    const priorityColors = {
      low: "#00a699",
      medium: "#ffb400",
      high: "#ff5a5f"
    };

    const isOverdue = task.due_date && task.status !== "done" && new Date(task.due_date) < new Date(new Date().toISOString().slice(0, 10));

    return (
      <div className="card" style={{
        padding: "16px",
        background: "rgba(15, 23, 42, 0.4)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "10px",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
        transition: "transform 0.2s, box-shadow 0.2s",
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }}>
        {/* Card Head */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
          <span className="badge" style={{
            backgroundColor: priorityColors[task.priority],
            color: "#fff",
            fontSize: "0.75rem",
            padding: "2px 8px",
            fontWeight: "bold"
          }}>
            {priorityLabels[task.priority]}
          </span>
          <div style={{ display: "flex", gap: "4px" }}>
            <button className="chip" style={{ padding: "2px 6px", fontSize: "0.75rem" }} onClick={() => setEditingTask(task)}>✏️</button>
            <button className="chip danger" style={{ padding: "2px 6px", fontSize: "0.75rem" }} onClick={() => handleDeleteTask(task.id)}>🗑️</button>
          </div>
        </div>

        {/* Title & Description */}
        <div>
          <h4 style={{ margin: "0 0 6px 0", fontSize: "0.95rem", fontWeight: "bold", color: "#f8fafc", lineHeight: "1.4" }}>
            {task.title}
          </h4>
          {task.description && (
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#94a3b8", lineHeight: "1.4", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
              {task.description}
            </p>
          )}
        </div>

        {/* Info row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px", fontSize: "0.8rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {task.due_date ? (
              <span style={{ color: isOverdue ? "#ff5a5f" : "#94a3b8", fontWeight: isOverdue ? "bold" : "normal" }}>
                📅 {formatDisplayDate(task.due_date)} {isOverdue && `(${tx("просрочено", "overdue")})`}
              </span>
            ) : (
              <span style={{ color: "#475569" }}>📅 {tx("без срока", "no due date")}</span>
            )}
          </div>
          
          {groupingMode === "status" ? (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ color: "#94a3b8" }}>{getUserName(task.assigned_to)}</span>
              {renderUserAvatar(task.assigned_to, 22)}
            </div>
          ) : (
            <span className="badge" style={{ backgroundColor: "#334155", color: "#cbd5e1" }}>
              {task.status.toUpperCase()}
            </span>
          )}
        </div>

        {/* Status Move Controls */}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: "8px", marginTop: "4px" }}>
          {task.status === "todo" && (
            <>
              <span />
              <button className="chip" style={{ display: "flex", alignItems: "center", gap: "4px" }} onClick={() => handleQuickMove(task.id, "in_progress")}>
                {tx("В работу", "In Progress")} ⚡
              </button>
            </>
          )}
          {task.status === "in_progress" && (
            <>
              <button className="chip" style={{ display: "flex", alignItems: "center", gap: "4px" }} onClick={() => handleQuickMove(task.id, "todo")}>
                ↩️ {tx("Вернуть", "Reset")}
              </button>
              <button className="chip" style={{ display: "flex", alignItems: "center", gap: "4px" }} onClick={() => handleQuickMove(task.id, "done")}>
                {tx("Выполнить", "Complete")} ✅
              </button>
            </>
          )}
          {task.status === "done" && (
            <>
              <button className="chip" style={{ display: "flex", alignItems: "center", gap: "4px" }} onClick={() => handleQuickMove(task.id, "in_progress")}>
                ↩️ {tx("В работу", "Reopen")}
              </button>
              <span />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="users-dashboard">
      {/* TABS MENU */}
      <div className="filters" style={{ marginBottom: "2rem" }}>
        <button className={`chip ${activeTab === "tasks" ? "active" : ""}`} onClick={() => setActiveTab("tasks")}>
          📋 {tx("Доска задач", "Task Board")}
        </button>
        <button className={`chip ${activeTab === "team" ? "active" : ""}`} onClick={() => setActiveTab("team")}>
          👥 {tx("Список команды", "Team Directory")}
        </button>
      </div>

      {/* FEEDBACK BANNER */}
      {actionFeedback && (
        <div className={`badge ${actionFeedback.ok ? "ok" : "danger"}`} style={{ display: "block", padding: "12px", marginBottom: "1.5rem", borderRadius: "8px", fontSize: "0.95rem" }}>
          {actionFeedback.ok ? "✓ " : "✗ "} {actionFeedback.message}
        </div>
      )}

      {/* --- TAB: TEAM DIRECTORY --- */}
      {activeTab === "team" && (
        <section className="panel" style={{ borderLeft: "4px solid #005f73" }}>
          <div className="panel-head">
            <div>
              <h2>{tx("Управление командой", "Team Management")}</h2>
              <p className="sub">{tx("Создавайте учетные записи для сотрудников, изменяйте пароли и назначайте роли в CRM.", "Manage system user profiles, set credentials, and assign administrative roles.")}</p>
            </div>
            <button className="primary" onClick={() => setIsCreatingUser(true)}>
              ➕ {tx("Добавить сотрудника", "Invite Member")}
            </button>
          </div>
          <div className="panel-body table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tx("Имя", "Name")}</th>
                  <th>Email</th>
                  <th>{tx("Роль", "Role")}</th>
                  <th>{tx("Контакты", "Contacts")}</th>
                  <th>{tx("Статус", "Status")}</th>
                  <th>{tx("Действия", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {renderUserAvatar(user.id, 36)}
                        <strong>{user.full_name}</strong>
                      </div>
                    </td>
                    <td>{user.email ?? "-"}</td>
                    <td>
                      <span className="badge info">{user.role.toUpperCase()}</span>
                    </td>
                    <td>
                      {user.phone && <div>📞 {user.phone}</div>}
                      {user.telegram_username && <div>✈️ @{user.telegram_username}</div>}
                      {!user.phone && !user.telegram_username && <span className="muted">-</span>}
                    </td>
                    <td>
                      <span className={`badge ${user.active ? "ok" : "danger"}`}>
                        {user.active ? tx("Активен", "Active") : tx("Заблокирован", "Inactive")}
                      </span>
                    </td>
                    <td>
                      <div className="action-stack" style={{ display: "flex", gap: "8px" }}>
                        <button className="chip" onClick={() => setEditingUser(user)}>⚙️ {tx("Редактировать", "Edit")}</button>
                        <button className="chip" onClick={() => setChangingPasswordUser(user)}>🔑 {tx("Пароль", "Password")}</button>
                        {user.id !== currentUser.authUserId && (
                          <button className="chip danger" onClick={() => setDeletingUser(user)}>🗑️ {tx("Удалить", "Delete")}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* --- TAB: KANBAN TASK BOARD --- */}
      {activeTab === "tasks" && (
        <div>
          {/* BOARD FILTERS */}
          <section className="panel" style={{ borderLeft: "4px solid #ee9b00", marginBottom: "2rem" }}>
            <div className="panel-body form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem", alignItems: "center" }}>
              <div className="field">
                <label>👤 {tx("Фильтр исполнителя", "Assignee Filter")}</label>
                <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
                  <option value="all">{tx("Все исполнители", "All Team Members")}</option>
                  <option value="unassigned">{tx("Не назначено", "Unassigned Tasks")}</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>🗂️ {tx("Группировка задач", "Group Tasks By")}</label>
                <select value={groupingMode} onChange={(e) => setGroupingMode(e.target.value as any)}>
                  <option value="status">{tx("По статусу (Kanban To Do/In Progress/Done)", "By Status (To Do / In Progress / Done)")}</option>
                  <option value="assignee">{tx("По сотрудникам команды", "By Team Member Columns")}</option>
                </select>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", height: "100%", alignItems: "flex-end" }}>
                <button className="primary" style={{ width: "100%" }} onClick={() => setIsCreatingTask(true)}>
                  ➕ {tx("Создать задачу", "Create Task")}
                </button>
              </div>
            </div>
          </section>

          {/* KANBAN BOARD */}
          {groupingMode === "status" ? (
            /* --- GROUP BY STATUS --- */
            <div className="grid-3" style={{ gap: "1.5rem", alignItems: "start" }}>
              {/* todo column */}
              <div className="panel" style={{ borderTop: "4px solid #6c757d", minHeight: "60vh", background: "rgba(30, 41, 59, 0.3)", backdropFilter: "blur(8px)" }}>
                <div className="panel-head" style={{ padding: "12px 16px" }}>
                  <h3 style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: "1.1rem" }}>
                    <span>📝 {tx("К выполнению", "To Do")}</span>
                    <span className="badge" style={{ backgroundColor: "#6c757d", color: "#fff" }}>
                      {filteredTasks.filter(t => t.status === "todo").length}
                    </span>
                  </h3>
                </div>
                <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px" }}>
                  {filteredTasks.filter(t => t.status === "todo").map(task => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                  {filteredTasks.filter(t => t.status === "todo").length === 0 && (
                    <div className="empty-state" style={{ padding: "2rem 1rem", fontSize: "0.85rem" }}>{tx("Нет задач", "No tasks")}</div>
                  )}
                </div>
              </div>

              {/* in_progress column */}
              <div className="panel" style={{ borderTop: "4px solid #005f73", minHeight: "60vh", background: "rgba(30, 41, 59, 0.3)", backdropFilter: "blur(8px)" }}>
                <div className="panel-head" style={{ padding: "12px 16px" }}>
                  <h3 style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: "1.1rem" }}>
                    <span>⚡ {tx("В работе", "In Progress")}</span>
                    <span className="badge" style={{ backgroundColor: "#005f73", color: "#fff" }}>
                      {filteredTasks.filter(t => t.status === "in_progress").length}
                    </span>
                  </h3>
                </div>
                <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px" }}>
                  {filteredTasks.filter(t => t.status === "in_progress").map(task => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                  {filteredTasks.filter(t => t.status === "in_progress").length === 0 && (
                    <div className="empty-state" style={{ padding: "2rem 1rem", fontSize: "0.85rem" }}>{tx("Нет активных задач", "No active tasks")}</div>
                  )}
                </div>
              </div>

              {/* done column */}
              <div className="panel" style={{ borderTop: "4px solid #2b9348", minHeight: "60vh", background: "rgba(30, 41, 59, 0.3)", backdropFilter: "blur(8px)" }}>
                <div className="panel-head" style={{ padding: "12px 16px" }}>
                  <h3 style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: "1.1rem" }}>
                    <span>✅ {tx("Выполнено", "Done")}</span>
                    <span className="badge" style={{ backgroundColor: "#2b9348", color: "#fff" }}>
                      {filteredTasks.filter(t => t.status === "done").length}
                    </span>
                  </h3>
                </div>
                <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px" }}>
                  {filteredTasks.filter(t => t.status === "done").map(task => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                  {filteredTasks.filter(t => t.status === "done").length === 0 && (
                    <div className="empty-state" style={{ padding: "2rem 1rem", fontSize: "0.85rem" }}>{tx("Нет выполненных задач", "No completed tasks")}</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* --- GROUP BY ASSIGNEE --- */
            <div style={{ display: "flex", gap: "1.5rem", overflowX: "auto", paddingBottom: "1rem" }}>
              {/* Unassigned column */}
              <div className="panel" style={{ borderTop: "4px solid #6c757d", minWidth: "300px", width: "320px", flexShrink: 0, minHeight: "60vh", background: "rgba(30, 41, 59, 0.3)", backdropFilter: "blur(8px)" }}>
                <div className="panel-head" style={{ padding: "12px 16px" }}>
                  <h3 style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: "1.1rem" }}>
                    <span>📂 {tx("Не назначено", "Unassigned")}</span>
                    <span className="badge" style={{ backgroundColor: "#6c757d", color: "#fff" }}>
                      {tasks.filter(t => t.assigned_to === null).length}
                    </span>
                  </h3>
                </div>
                <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px" }}>
                  {tasks.filter(t => t.assigned_to === null).map(task => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                  {tasks.filter(t => t.assigned_to === null).length === 0 && (
                    <div className="empty-state" style={{ padding: "2rem 1rem", fontSize: "0.85rem" }}>{tx("Свободно", "Clean")}</div>
                  )}
                </div>
              </div>

              {/* User columns */}
              {users.map(u => (
                <div className="panel" key={u.id} style={{ borderTop: `4px solid ${getUserColor(u.id)}`, minWidth: "300px", width: "320px", flexShrink: 0, minHeight: "60vh", background: "rgba(30, 41, 59, 0.3)", backdropFilter: "blur(8px)" }}>
                  <div className="panel-head" style={{ padding: "12px 16px" }}>
                    <h3 style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: "1.1rem", alignItems: "center", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {renderUserAvatar(u.id, 24)}
                        <span style={{ fontSize: "1rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.full_name}</span>
                      </div>
                      <span className="badge" style={{ backgroundColor: getUserColor(u.id), color: "#fff", flexShrink: 0 }}>
                        {tasks.filter(t => t.assigned_to === u.id).length}
                      </span>
                    </h3>
                  </div>
                  <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px" }}>
                    {tasks.filter(t => t.assigned_to === u.id).map(task => (
                      <TaskCard key={task.id} task={task} />
                    ))}
                    {tasks.filter(t => t.assigned_to === u.id).length === 0 && (
                      <div className="empty-state" style={{ padding: "2rem 1rem", fontSize: "0.85rem" }}>{tx("Нет задач", "No tasks")}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}



      {/* ==================================================== */}
      {/* ==================== MODALS LAYERS ================= */}
      {/* ==================================================== */}

      {/* --- MODAL: CREATE USER --- */}
      {isCreatingUser && (
        <div className="modal-overlay" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="panel" style={{ width: "100%", maxWidth: "500px", margin: "16px" }}>
            <div className="panel-head">
              <h2>{tx("Создать учетную запись", "Create Team Member")}</h2>
              <button className="chip" onClick={() => setIsCreatingUser(false)}>✕</button>
            </div>
            <div className="panel-body">
              <form onSubmit={(e) => handleAction(createAppUserAction, e)} className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                <input type="hidden" name="tenant_id" value={currentUser.tenantId} />
                <div className="field">
                  <label>{tx("ФИО", "Full Name")}</label>
                  <input name="full_name" required placeholder="Иван Иванов" />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input name="email" type="email" required placeholder="example@mail.com" />
                </div>
                <div className="field">
                  <label>{tx("Пароль", "Password")}</label>
                  <input name="password" type="password" required minLength={6} placeholder="••••••" />
                </div>
                <div className="field">
                  <label>{tx("Телефон", "Phone")}</label>
                  <input name="phone" placeholder="+66..." />
                </div>
                <div className="field">
                  <label>Telegram username (без @)</label>
                  <input name="telegram_username" placeholder="tg_username" />
                </div>
                <div className="field">
                  <label>{tx("Роль", "Role")}</label>
                  <select name="role">
                    <option value="manager">{tx("Manager (Менеджер)", "Manager")}</option>
                    <option value="operator">{tx("Operator (Менеджер выдачи)", "Operator")}</option>
                    <option value="accountant">{tx("Accountant (Бухгалтер)", "Accountant")}</option>
                    <option value="marketer">{tx("Marketer (Маркетолог)", "Marketer")}</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: "10px", marginTop: "1rem" }}>
                  <button className="primary" type="submit" disabled={isSaving}>
                    {isSaving ? tx("Сохранение...", "Saving...") : tx("Создать", "Create")}
                  </button>
                  <button className="button" type="button" onClick={() => setIsCreatingUser(false)}>{tx("Отмена", "Cancel")}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: EDIT USER --- */}
      {editingUser && (
        <div className="modal-overlay" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="panel" style={{ width: "100%", maxWidth: "500px", margin: "16px" }}>
            <div className="panel-head">
              <h2>{tx("Редактировать сотрудника", "Edit Team Member")}</h2>
              <button className="chip" onClick={() => setEditingUser(null)}>✕</button>
            </div>
            <div className="panel-body">
              {/* Photo Upload for Owner */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", marginBottom: "1.5rem", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "1.5rem" }}>
                <div style={{ width: "80px", height: "80px", borderRadius: "50%", overflow: "hidden", position: "relative", border: "2px solid #005f73" }}>
                  {editingUser.avatar_url ? (
                    <img src={editingUser.avatar_url} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: getUserColor(editingUser.id), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "1.8rem" }}>
                      {getInitials(editingUser.full_name)}
                    </div>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  id="edit-user-avatar-input"
                  onChange={(e) => handleEditAvatarUpload(e, editingUser.id)}
                />
                <button
                  type="button"
                  className="chip"
                  onClick={() => document.getElementById("edit-user-avatar-input")?.click()}
                  disabled={uploadingUserId === editingUser.id}
                >
                  {uploadingUserId === editingUser.id ? tx("Загрузка...", "Uploading...") : tx("📷 Изменить фотографию", "📷 Change Photo")}
                </button>
              </div>

              <form onSubmit={(e) => handleAction(updateAppUserAction, e)} className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                <input type="hidden" name="id" value={editingUser.id} />
                <div className="field">
                  <label>{tx("ФИО", "Full Name")}</label>
                  <input name="full_name" required defaultValue={editingUser.full_name} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input name="email" type="email" required defaultValue={editingUser.email || ""} />
                </div>
                <div className="field">
                  <label>{tx("Телефон", "Phone")}</label>
                  <input name="phone" defaultValue={editingUser.phone || ""} />
                </div>
                <div className="field">
                  <label>Telegram username</label>
                  <input name="telegram_username" defaultValue={editingUser.telegram_username || ""} />
                </div>
                <div className="field">
                  <label>{tx("Роль", "Role")}</label>
                  <select name="role" defaultValue={editingUser.role}>
                    <option value="owner">Owner</option>
                    <option value="manager">Manager</option>
                    <option value="operator">Operator</option>
                    <option value="accountant">Accountant</option>
                    <option value="marketer">Marketer</option>
                  </select>
                </div>
                <div className="field">
                  <label>{tx("Активен", "Status")}</label>
                  <select name="active" defaultValue={String(editingUser.active)}>
                    <option value="true">{tx("Да (Активен)", "Active")}</option>
                    <option value="false">{tx("Нет (Заблокирован)", "Inactive")}</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: "10px", marginTop: "1rem" }}>
                  <button className="primary" type="submit" disabled={isSaving}>
                    {isSaving ? tx("Сохранение...", "Saving...") : tx("Сохранить", "Save")}
                  </button>
                  <button className="button" type="button" onClick={() => setEditingUser(null)}>{tx("Отмена", "Cancel")}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: CHANGE PASSWORD --- */}
      {changingPasswordUser && (
        <div className="modal-overlay" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="panel" style={{ width: "100%", maxWidth: "450px", margin: "16px" }}>
            <div className="panel-head">
              <h2>{tx("Сброс пароля", "Change Password")}</h2>
              <button className="chip" onClick={() => setChangingPasswordUser(null)}>✕</button>
            </div>
            <div className="panel-body">
              <p className="sub">{tx("Новый пароль для", "New password for")} <strong>{changingPasswordUser.full_name}</strong></p>
              <form onSubmit={(e) => handleAction(changeUserPasswordAction, e)} className="form-grid" style={{ gridTemplateColumns: "1fr", marginTop: "1rem" }}>
                <input type="hidden" name="user_id" value={changingPasswordUser.id} />
                <div className="field">
                  <label>{tx("Новый пароль", "New Password")}</label>
                  <input name="new_password" type="password" required minLength={6} placeholder="••••••" />
                </div>
                <div style={{ display: "flex", gap: "10px", marginTop: "1rem" }}>
                  <button className="primary" type="submit" disabled={isSaving}>
                    {isSaving ? tx("Сброс...", "Changing...") : tx("Сменить пароль", "Change")}
                  </button>
                  <button className="button" type="button" onClick={() => setChangingPasswordUser(null)}>{tx("Отмена", "Cancel")}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: DELETE USER --- */}
      {deletingUser && (
        <div className="modal-overlay" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="panel" style={{ width: "100%", maxWidth: "450px", margin: "16px" }}>
            <div className="panel-head">
              <h2 className="danger">{tx("Удалить пользователя", "Delete User")}</h2>
              <button className="chip" onClick={() => setDeletingUser(null)}>✕</button>
            </div>
            <div className="panel-body">
              <p style={{ marginBottom: "1rem" }}>
                {tx("Вы собираетесь полностью удалить сотрудника", "You are deleting employee")} <strong>{deletingUser.full_name}</strong>.
              </p>
              <form onSubmit={(e) => handleAction(deleteUserWithTransferAction, e)} className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                <input type="hidden" name="user_id" value={deletingUser.id} />
                <div className="field">
                  <label>{tx("Передать его чаты и переписку другому сотруднику (опционально)", "Transfer conversations to another member (optional)")}</label>
                  <select name="transfer_to_user_id">
                    <option value="">{tx("Не передавать", "Do not transfer")}</option>
                    {users.filter(u => u.id !== deletingUser.id).map(u => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", gap: "10px", marginTop: "1.5rem" }}>
                  <button className="primary danger" type="submit" disabled={isSaving}>
                    {isSaving ? tx("Удаление...", "Deleting...") : tx("Удалить навсегда", "Delete Permanently")}
                  </button>
                  <button className="button" type="button" onClick={() => setDeletingUser(null)}>{tx("Отмена", "Cancel")}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: CREATE TASK --- */}
      {isCreatingTask && (
        <div className="modal-overlay" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="panel" style={{ width: "100%", maxWidth: "500px", margin: "16px" }}>
            <div className="panel-head">
              <h2>{tx("Создать новую задачу", "Create New Task")}</h2>
              <button className="chip" onClick={() => setIsCreatingTask(false)}>✕</button>
            </div>
            <div className="panel-body">
              <form onSubmit={(e) => handleAction(createTaskAction, e)} className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                <div className="field">
                  <label>{tx("Название задачи", "Task Title")}</label>
                  <input name="title" required placeholder="Например: Помыть Pajero Sport перед выдачей" />
                </div>
                <div className="field">
                  <label>{tx("Описание / Детали", "Description / Details")}</label>
                  <textarea name="description" placeholder="Детали задачи, адреса, номера контактов..." style={{ minHeight: "100px" }} />
                </div>
                <div className="field">
                  <label>{tx("Приоритет", "Priority")}</label>
                  <select name="priority" defaultValue="medium">
                    <option value="low">{tx("Низкий (Low)", "Low")}</option>
                    <option value="medium">{tx("Средний (Medium)", "Medium")}</option>
                    <option value="high">{tx("Высокий (High)", "High")}</option>
                  </select>
                </div>
                <div className="field">
                  <label>{tx("Назначить сотруднику", "Assign To")}</label>
                  <select name="assigned_to" defaultValue="unassigned">
                    <option value="unassigned">{tx("Не назначать (В общий пул)", "Unassigned")}</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>{tx("Срок выполнения (Дедлайн)", "Due Date")}</label>
                  <input name="due_date" type="date" />
                </div>
                <div className="field">
                  <label>{tx("Статус", "Status")}</label>
                  <select name="status" defaultValue="todo">
                    <option value="todo">{tx("К выполнению (To Do)", "To Do")}</option>
                    <option value="in_progress">{tx("В работе (In Progress)", "In Progress")}</option>
                    <option value="done">{tx("Выполнено (Done)", "Done")}</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: "10px", marginTop: "1rem" }}>
                  <button className="primary" type="submit" disabled={isSaving}>
                    {isSaving ? tx("Создание...", "Creating...") : tx("Создать задачу", "Create Task")}
                  </button>
                  <button className="button" type="button" onClick={() => setIsCreatingTask(false)}>{tx("Отмена", "Cancel")}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: EDIT TASK --- */}
      {editingTask && (
        <div className="modal-overlay" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="panel" style={{ width: "100%", maxWidth: "500px", margin: "16px" }}>
            <div className="panel-head">
              <h2>{tx("Редактировать задачу", "Edit Task")}</h2>
              <button className="chip" onClick={() => setEditingTask(null)}>✕</button>
            </div>
            <div className="panel-body">
              <form onSubmit={(e) => handleAction(updateTaskAction, e)} className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                <input type="hidden" name="id" value={editingTask.id} />
                <div className="field">
                  <label>{tx("Название задачи", "Task Title")}</label>
                  <input name="title" required defaultValue={editingTask.title} />
                </div>
                <div className="field">
                  <label>{tx("Описание / Детали", "Description / Details")}</label>
                  <textarea name="description" defaultValue={editingTask.description || ""} style={{ minHeight: "100px" }} />
                </div>
                <div className="field">
                  <label>{tx("Приоритет", "Priority")}</label>
                  <select name="priority" defaultValue={editingTask.priority}>
                    <option value="low">{tx("Низкий (Low)", "Low")}</option>
                    <option value="medium">{tx("Средний (Medium)", "Medium")}</option>
                    <option value="high">{tx("Высокий (High)", "High")}</option>
                  </select>
                </div>
                <div className="field">
                  <label>{tx("Назначить сотруднику", "Assign To")}</label>
                  <select name="assigned_to" defaultValue={editingTask.assigned_to || "unassigned"}>
                    <option value="unassigned">{tx("Не назначать", "Unassigned")}</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>{tx("Срок выполнения (Дедлайн)", "Due Date")}</label>
                  <input name="due_date" type="date" defaultValue={editingTask.due_date || ""} />
                </div>
                <div className="field">
                  <label>{tx("Статус", "Status")}</label>
                  <select name="status" defaultValue={editingTask.status}>
                    <option value="todo">{tx("К выполнению (To Do)", "To Do")}</option>
                    <option value="in_progress">{tx("В работе (In Progress)", "In Progress")}</option>
                    <option value="done">{tx("Выполнено (Done)", "Done")}</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: "10px", marginTop: "1rem" }}>
                  <button className="primary" type="submit" disabled={isSaving}>
                    {isSaving ? tx("Сохранение...", "Saving...") : tx("Сохранить изменения", "Save Changes")}
                  </button>
                  <button className="button" type="button" onClick={() => setEditingTask(null)}>{tx("Отмена", "Cancel")}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
