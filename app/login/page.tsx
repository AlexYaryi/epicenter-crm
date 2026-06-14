import Image from "next/image";
import { LanguageSwitch } from "@/app/components/LanguageSwitch";
import { signInAction } from "@/lib/auth-actions";
import { getLocale } from "@/lib/i18n";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const locale = await getLocale();
  const en = locale === "en";

  return (
    <main className="grid-2" style={{ minHeight: "100vh", padding: 28, alignItems: "center" }}>
      <section>
        <Image src="/assets/epicenter-fullcolor.png" alt="Epicenter" width={220} height={320} priority style={{ height: "auto" }} />
        <h1>{en ? "Login to Epicenter Rental OS" : "Вход в Epicenter Rental OS"}</h1>
        <p className="sub">{en ? "Supabase Auth is used here: email/password, magic link, MFA and role-based access." : "Здесь работает Supabase Auth: email/password, magic link, MFA и роли доступа."}</p>
        <LanguageSwitch locale={locale} />
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{en ? "Authorization" : "Авторизация"}</h2>
            <div className="muted">{en ? "Use your Supabase Auth email and password." : "Используйте email и пароль Supabase Auth."}</div>
          </div>
        </div>
        <div className="panel-body">
          <form action={signInAction} className="form-grid">
            {params.error ? <div className="field wide"><span className="badge danger">{params.error}</span></div> : null}
            <div className="field wide"><label>Email</label><input name="email" autoComplete="email" /></div>
            <div className="field wide"><label>{en ? "Password" : "Пароль"}</label><input name="password" type="password" autoComplete="current-password" /></div>
            <button className="primary">{en ? "Log in to CRM" : "Войти в CRM"}</button>
          </form>
        </div>
      </section>
    </main>
  );
}
