import { redirect } from "next/navigation";
import { getProtectedCrmPage, SimpleModulePage } from "@/app/components/CrmPages";
import { UsersAndTasksDashboard } from "@/app/components/UsersAndTasksDashboard";
import { getAppUsers } from "@/lib/repository";
import { getTasks } from "@/lib/task-repository";
import type { Role } from "@/lib/types";

export default async function Page() {
  const { user, locale } = await getProtectedCrmPage();
  
  if (user.role !== "owner") {
    redirect("/");
  }

  const users = await getAppUsers(user.tenantId);
  const tasks = await getTasks(user.tenantId);

  function t(ru: string, en: string) {
    return locale === "en" ? en : ru;
  }

  const activeUsers = users.filter((item) => item.active);
  const roleCounts = activeUsers.reduce<Record<Role, number>>(
    (acc, item) => {
      acc[item.role] = (acc[item.role] ?? 0) + 1;
      return acc;
    },
    {
      owner: 0,
      manager: 0,
      operator: 0,
      accountant: 0,
      marketer: 0,
      partner_view: 0
    }
  );

  const roleReadiness: Array<{
    role: Role;
    title: string;
    requiredForLaunch: boolean;
    ownerFallback: boolean;
    note: string;
  }> = [
    {
      role: "owner",
      title: t("Owner / владелец", "Owner"),
      requiredForLaunch: true,
      ownerFallback: true,
      note: t("Главный доступ, финансы, деплой, критичные решения.", "Primary access, finance, deploys, and critical decisions.")
    },
    {
      role: "manager",
      title: t("Manager / операционный контроль", "Manager / operations"),
      requiredForLaunch: false,
      ownerFallback: true,
      note: t("Можно подключить после старта; пока функции закрывает owner.", "Can be added after launch; owner covers this for now.")
    },
    {
      role: "operator",
      title: t("Operator / выдача и возврат", "Operator / handover and return"),
      requiredForLaunch: false,
      ownerFallback: true,
      note: t("Нужен при росте потока выдач; сейчас контроль через handover/return блоки.", "Needed when handover volume grows; current control is through handover/return blocks.")
    },
    {
      role: "accountant",
      title: t("Accountant / финансы", "Accountant / finance"),
      requiredForLaunch: false,
      ownerFallback: true,
      note: t("Роль уже предусмотрена. Когда найдем бухгалтера, включим его в /finance; сейчас все финансы на owner.", "Role is ready. When an accountant is available, connect them to /finance; finance stays with owner for now.")
    },
    {
      role: "marketer",
      title: t("Marketer / каталог и лиды", "Marketer / catalog and leads"),
      requiredForLaunch: false,
      ownerFallback: true,
      note: t("Можно добавить позже для фото, описаний машин и обработки лидов.", "Can be added later for photos, vehicle descriptions, and lead work.")
    }
  ];

  const blockingRoles = roleReadiness.filter((item) => item.requiredForLaunch && roleCounts[item.role] < 1);
  const roleLaunchReady = blockingRoles.length === 0;

  return (
    <SimpleModulePage
      title={t("Команда & Задачи", "Team & Tasks")}
      subtitle={t("Управление сотрудниками компании и интерактивная Kanban-доска для контроля задач каждого участника.", "Manage team members and oversee assignments on an interactive Kanban board.")}
      locale={locale}
      activePath="/users"
    >
      <section className="panel" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <p className="eyebrow">{t("Запуск CRM", "CRM launch")}</p>
            <h2 style={{ marginTop: 0 }}>{t("Готовность пользователей и ролей", "User and role readiness")}</h2>
            <p className="sub" style={{ maxWidth: "760px" }}>
              {t(
                "Для запуска обязателен owner. Остальные роли можно включать по мере найма: сейчас owner закрывает финансы, операции и контроль задач.",
                "Owner is required for launch. Other roles can be added as the team grows; owner currently covers finance, operations, and task control."
              )}
            </p>
          </div>
          <div className={`badge ${roleLaunchReady ? "ok" : "bad"}`}>
            {roleLaunchReady ? t("Готово к старту", "Ready to start") : t("Нужно исправить", "Needs fix")}
          </div>
        </div>

        <div className="kpi-grid" style={{ marginTop: "14px" }}>
          <div className="kpi">
            <span>{t("Активные пользователи", "Active users")}</span>
            <strong>{activeUsers.length}</strong>
          </div>
          <div className="kpi">
            <span>{t("Owner", "Owner")}</span>
            <strong>{roleCounts.owner}</strong>
          </div>
          <div className="kpi">
            <span>{t("Accountant", "Accountant")}</span>
            <strong>{roleCounts.accountant || t("позже", "later")}</strong>
          </div>
          <div className="kpi">
            <span>{t("Текущий ответственный", "Current owner")}</span>
            <strong style={{ fontSize: "1rem" }}>{user.fullName}</strong>
          </div>
        </div>

        <table style={{ marginTop: "16px" }}>
          <thead>
            <tr>
              <th>{t("Роль", "Role")}</th>
              <th>{t("Активно", "Active")}</th>
              <th>{t("Статус запуска", "Launch status")}</th>
              <th>{t("Что делаем", "Action")}</th>
            </tr>
          </thead>
          <tbody>
            {roleReadiness.map((item) => {
              const count = roleCounts[item.role] ?? 0;
              const isBlocking = item.requiredForLaunch && count < 1;
              const status = isBlocking
                ? t("Блокирует запуск", "Blocks launch")
                : item.requiredForLaunch
                  ? t("Закрыто", "Covered")
                  : item.ownerFallback
                    ? t("Закрывает owner", "Owner covers")
                    : t("Не требуется сейчас", "Not needed now");

              return (
                <tr key={item.role}>
                  <td>
                    <strong>{item.title}</strong>
                    <br />
                    <span className="muted">{item.requiredForLaunch ? t("обязательно", "required") : t("не блокирует запуск", "does not block launch")}</span>
                  </td>
                  <td>{count}</td>
                  <td><span className={`badge ${isBlocking ? "bad" : "ok"}`}>{status}</span></td>
                  <td>{item.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <UsersAndTasksDashboard
        users={users}
        tasks={tasks}
        locale={locale}
        currentUser={user}
      />
    </SimpleModulePage>
  );
}
