import { NextRequest, NextResponse } from "next/server";

export const revalidate = 300;

function widgetScript(baseUrl: string) {
  return `
(function () {
  function money(value) {
    return new Intl.NumberFormat("ru-RU").format(Math.round(Number(value || 0))) + " THB";
  }

  function statusLabel(status, lang) {
    var ru = { available: "Доступна", reserved: "Забронирована", handed_over: "В аренде", in_use: "В аренде", returning: "Возврат", maintenance: "На сервисе" };
    var en = { available: "Available", reserved: "Reserved", handed_over: "Rented", in_use: "Rented", returning: "Returning", maintenance: "Service" };
    return (lang === "en" ? en : ru)[status] || status;
  }

  function pricingLine(car, lang) {
    var rules = Array.isArray(car.pricing) ? car.pricing : [];
    var highDay = rules.find(function (rule) { return rule.season === "high" && rule.bucket === "1_day"; });
    var mediumDay = rules.find(function (rule) { return rule.season === "medium" && rule.bucket === "1_day"; });
    var mediumMonth = rules.find(function (rule) { return rule.season === "medium" && rule.bucket === "1_month"; });

    if (!rules.length) {
      return lang === "en"
        ? "from " + money(car.daily_rate_long_term) + "/day for 30+ days"
        : "от " + money(car.daily_rate_long_term) + "/день при 30+ днях";
    }

    var parts = [];
    if (mediumDay && mediumDay.daily_rate_thb) {
      parts.push((lang === "en" ? "Apr-Oct: " : "Апр-окт: ") + money(mediumDay.daily_rate_thb) + (lang === "en" ? "/day" : "/день"));
    }
    if (highDay && highDay.daily_rate_thb) {
      parts.push((lang === "en" ? "Nov-Mar: " : "Ноя-мар: ") + money(highDay.daily_rate_thb) + (lang === "en" ? "/day" : "/день"));
    }
    if (mediumMonth && mediumMonth.monthly_rate_thb) {
      parts.push((lang === "en" ? "month: " : "месяц: ") + money(mediumMonth.monthly_rate_thb));
    }
    return parts.join(" · ");
  }

  function render(target, payload, lang) {
    var vehicles = payload.vehicles || [];
    if (!vehicles.length) {
      target.innerHTML = '<div class="epc-empty">' + (lang === "en" ? "No cars to show yet." : "Пока нет машин для показа.") + '</div>';
      return;
    }

    target.innerHTML = vehicles.map(function (car) {
      var img = car.photo_url
        ? '<img class="epc-card-img" src="' + car.photo_url + '" alt="' + car.title.replace(/"/g, "&quot;") + '" loading="lazy">'
        : '<div class="epc-card-img epc-card-img-empty">' + car.title + '</div>';
      var price = pricingLine(car, lang);
      var cta = lang === "en" ? "Book in WhatsApp" : "Забронировать в WhatsApp";
      return '<article class="epc-card">' +
        img +
        '<div class="epc-card-body">' +
          '<div class="epc-card-top"><h3>' + car.title + '</h3><span>' + statusLabel(car.status, lang) + '</span></div>' +
          '<p class="epc-meta">' + car.year + ' · ' + car.category + (car.seats ? ' · ' + car.seats + ' seats' : '') + '</p>' +
          '<p class="epc-desc">' + car.description + '</p>' +
          '<div class="epc-card-bottom"><strong>' + price + '</strong><a href="' + car.whatsapp_url + '" target="_blank" rel="noopener">' + cta + '</a></div>' +
        '</div>' +
      '</article>';
    }).join("");
  }

  function injectStyles() {
    if (document.getElementById("epicenter-tilda-widget-style")) return;
    var style = document.createElement("style");
    style.id = "epicenter-tilda-widget-style";
    style.textContent = '.epc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;font-family:Inter,Arial,sans-serif}.epc-card{overflow:hidden;border:1px solid #cce9eb;border-radius:12px;background:#fff;box-shadow:0 14px 36px rgba(6,79,88,.12)}.epc-card-img{width:100%;aspect-ratio:4/3;object-fit:cover;background:#d9fbfc;color:#057f8b;display:grid;place-items:center;font-weight:800}.epc-card-body{padding:16px;display:grid;gap:10px}.epc-card-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.epc-card h3{margin:0;font-size:20px;line-height:1.15;color:#14363a}.epc-card-top span{padding:6px 9px;border-radius:999px;background:#dcf5ec;color:#168866;font-size:12px;font-weight:800;white-space:nowrap}.epc-meta,.epc-desc{margin:0;color:#5f7f83;font-size:14px;line-height:1.45}.epc-card-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.epc-card-bottom strong{color:#14363a}.epc-card-bottom a{display:inline-flex;align-items:center;min-height:42px;padding:0 14px;border-radius:8px;background:#ffd923;color:#3a3300;text-decoration:none;font-weight:900}.epc-empty{padding:20px;border:1px solid #cce9eb;border-radius:12px;color:#5f7f83;background:#fff}@media(max-width:640px){.epc-card-bottom{align-items:stretch}.epc-card-bottom a{justify-content:center;width:100%}}';
    document.head.appendChild(style);
  }

  function boot() {
    injectStyles();
    var scripts = document.querySelectorAll('script[data-epicenter-catalog]');
    scripts.forEach(function (script) {
      var targetSelector = script.getAttribute("data-target") || "#epicenter-catalog";
      var target = document.querySelector(targetSelector);
      if (!target) return;
      var lang = script.getAttribute("data-lang") || "ru";
      var category = script.getAttribute("data-category") || "all";
      target.classList.add("epc-grid");
      target.innerHTML = '<div class="epc-empty">' + (lang === "en" ? "Loading cars..." : "Загружаем автомобили...") + '</div>';
      fetch("${baseUrl}/api/tilda/vehicles?lang=" + encodeURIComponent(lang) + "&category=" + encodeURIComponent(category))
        .then(function (response) { return response.json(); })
        .then(function (payload) { render(target, payload, lang); })
        .catch(function () {
          target.innerHTML = '<div class="epc-empty">' + (lang === "en" ? "Catalog is temporarily unavailable." : "Каталог временно недоступен.") + '</div>';
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
`;
}

export async function GET(request: NextRequest) {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_APP_URL;
  const requestBaseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const baseUrl = (configuredBaseUrl || requestBaseUrl).replace(/\/$/, "");

  return new NextResponse(widgetScript(baseUrl), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      "Access-Control-Allow-Origin": process.env.TILDA_ALLOWED_ORIGIN || "*"
    }
  });
}
