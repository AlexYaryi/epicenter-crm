import { NextRequest, NextResponse } from "next/server";

export const revalidate = 300;

function widgetScript(baseUrl: string) {
  return `
(function () {
  function money(value) {
    return new Intl.NumberFormat("ru-RU").format(Math.round(Number(value || 0))) + " THB";
  }

  function statusLabel(status, lang) {
    var ru = { available: "Доступна", reserved: "Забронирована", handed_over: "В аренде", in_use: "В аренде", returning: "Возврат", maintenance: "На сервисе", repair: "Ремонт", retired: "Неактивна" };
    var en = { available: "Available", reserved: "Reserved", handed_over: "Rented", in_use: "Rented", returning: "Returning", maintenance: "Service", repair: "Repair", retired: "Inactive" };
    return (lang === "en" ? en : ru)[status] || status;
  }

  function pricingLine(car, lang) {
    var rules = Array.isArray(car.pricing) ? car.pricing : [];
    var highDay = rules.find(function (rule) { return rule.season === "high" && rule.bucket === "1_day"; });
    var mediumDay = rules.find(function (rule) { return rule.season === "medium" && rule.bucket === "1_day"; });
    var mediumMonth = rules.find(function (rule) { return rule.season === "medium" && rule.bucket === "1_month"; });

    if (!rules.length) {
      return '<span>' + (lang === "en"
        ? "from " + money(car.daily_rate_long_term) + "/day for 30+ days"
        : "от " + money(car.daily_rate_long_term) + "/день при 30+ днях") + '</span>';
    }

    var parts = [];
    if (mediumDay && mediumDay.daily_rate_thb) {
      parts.push('<span>' + (lang === "en" ? "Apr-Oct: " : "Апр-окт: ") + '<strong>' + money(mediumDay.daily_rate_thb) + (lang === "en" ? "/day" : "/день") + '</strong></span>');
    }
    if (highDay && highDay.daily_rate_thb) {
      parts.push('<span>' + (lang === "en" ? "Nov-Mar: " : "Ноя-мар: ") + '<strong>' + money(highDay.daily_rate_thb) + (lang === "en" ? "/day" : "/день") + '</strong></span>');
    }
    if (mediumMonth && mediumMonth.monthly_rate_thb) {
      parts.push('<span>' + (lang === "en" ? "Month (30+ days): " : "Месяц (30+ дней): ") + '<strong>' + money(mediumMonth.monthly_rate_thb) + '</strong></span>');
    }
    return parts.join("");
  }

  var currentLightboxIndex = 0;
  var currentLightboxPhotos = [];

  function openLightbox(photos, startIndex) {
    if (!photos || !photos.length) return;
    currentLightboxPhotos = photos;
    currentLightboxIndex = startIndex || 0;
    
    var modal = document.getElementById("epicenter-lightbox-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "epicenter-lightbox-modal";
      modal.innerHTML = 
        '<div class="epc-lightbox-overlay"></div>' +
        '<div class="epc-lightbox-content">' +
          '<button class="epc-lightbox-close" aria-label="Close">&times;</button>' +
          '<button class="epc-lightbox-prev" aria-label="Previous">&#10094;</button>' +
          '<div class="epc-lightbox-img-wrap"><img id="epc-lightbox-main-img" src="" alt="Car Photo"></div>' +
          '<button class="epc-lightbox-next" aria-label="Next">&#10095;</button>' +
          '<div class="epc-lightbox-counter">1 / 1</div>' +
        '</div>';
      document.body.appendChild(modal);

      modal.querySelector(".epc-lightbox-close").addEventListener("click", closeLightbox);
      modal.querySelector(".epc-lightbox-overlay").addEventListener("click", closeLightbox);
      modal.querySelector(".epc-lightbox-prev").addEventListener("click", prevLightbox);
      modal.querySelector(".epc-lightbox-next").addEventListener("click", nextLightbox);
      
      document.addEventListener("keydown", function(e) {
        if (!modal.classList.contains("epc-lightbox-active")) return;
        if (e.key === "Escape") closeLightbox();
        if (e.key === "ArrowLeft") prevLightbox();
        if (e.key === "ArrowRight") nextLightbox();
      });
    }

    modal.classList.add("epc-lightbox-active");
    document.body.style.overflow = "hidden";
    updateLightbox();
  }

  function closeLightbox() {
    var modal = document.getElementById("epicenter-lightbox-modal");
    if (modal) {
      modal.classList.remove("epc-lightbox-active");
      document.body.style.overflow = "";
    }
  }

  function updateLightbox() {
    var img = document.getElementById("epc-lightbox-main-img");
    var counter = document.querySelector(".epc-lightbox-counter");
    if (img && counter) {
      img.src = currentLightboxPhotos[currentLightboxIndex];
      counter.textContent = (currentLightboxIndex + 1) + " / " + currentLightboxPhotos.length;
    }
  }

  function prevLightbox() {
    currentLightboxIndex = (currentLightboxIndex - 1 + currentLightboxPhotos.length) % currentLightboxPhotos.length;
    updateLightbox();
  }

  function nextLightbox() {
    currentLightboxIndex = (currentLightboxIndex + 1) % currentLightboxPhotos.length;
    updateLightbox();
  }

  // Filter state
  var state = {
    lang: "ru",
    category: "all",
    start_date: "",
    end_date: ""
  };

  function fetchVehicles(targetGrid, baseUrl) {
    targetGrid.innerHTML = '<div class="epc-empty">' + (state.lang === "en" ? "Loading cars..." : "Загружаем автомобили...") + '</div>';
    
    var url = baseUrl + "/api/tilda/vehicles?lang=" + encodeURIComponent(state.lang);
    if (state.category && state.category !== "all") {
      url += "&category=" + encodeURIComponent(state.category);
    }
    if (state.start_date && state.end_date) {
      url += "&start_date=" + encodeURIComponent(state.start_date) + "&end_date=" + encodeURIComponent(state.end_date);
    }
    
    fetch(url)
      .then(function (response) { return response.json(); })
      .then(function (payload) { render(targetGrid, payload, state.lang); })
      .catch(function () {
        targetGrid.innerHTML = '<div class="epc-empty">' + (state.lang === "en" ? "Catalog is temporarily unavailable." : "Каталог временно недоступен.") + '</div>';
      });
  }

  function renderSearchBar(targetContainer, targetGrid, baseUrl, initialCategory) {
    state.category = initialCategory || "all";
    
    var categories = [
      { key: "all", ru: "Все", en: "All" },
      { key: "economy", ru: "Эконом", en: "Economy" },
      { key: "comfort", ru: "Комфорт", en: "Comfort" },
      { key: "suv", ru: "SUV", en: "SUV" },
      { key: "pickup", ru: "Пикапы", en: "Pickups" },
      { key: "convertible", ru: "Кабриолеты", en: "Convertibles" },
      { key: "7seater", ru: "7 мест", en: "7-seater" }
    ];
    
    var labelStart = state.lang === "en" ? "Rental Start" : "Начало аренды";
    var labelEnd = state.lang === "en" ? "Rental End" : "Окончание аренды";
    var labelSearch = state.lang === "en" ? "Search" : "Найти";
    var labelCategory = state.lang === "en" ? "Category" : "Категория";
    
    var searchBarHtml = 
      '<div class="epc-search-bar">' +
        '<div class="epc-search-row">' +
          '<div class="epc-search-field">' +
            '<label>' + labelStart + '</label>' +
            '<input type="date" id="epc-start-date" value="' + state.start_date + '">' +
          '</div>' +
          '<div class="epc-search-field">' +
            '<label>' + labelEnd + '</label>' +
            '<input type="date" id="epc-end-date" value="' + state.end_date + '">' +
          '</div>' +
          '<button class="epc-btn-search" id="epc-search-btn">' + labelSearch + '</button>' +
        '</div>' +
        '<div class="epc-search-field epc-category-field" style="margin-top: 10px;">' +
          '<label>' + labelCategory + '</label>' +
          '<div class="epc-chips-container">' +
            categories.map(function (cat) {
              var activeClass = cat.key === state.category ? " epc-chip-active" : "";
              return '<button class="epc-chip-btn' + activeClass + '" data-category="' + cat.key + '">' + (state.lang === "en" ? cat.en : cat.ru) + '</button>';
            }).join("") +
          '</div>' +
        '</div>' +
      '</div>';
      
    var searchBarContainer = document.createElement("div");
    searchBarContainer.innerHTML = searchBarHtml;
    targetContainer.insertBefore(searchBarContainer.firstChild, targetGrid);
    
    // Add event listeners
    var startInput = targetContainer.querySelector("#epc-start-date");
    var endInput = targetContainer.querySelector("#epc-end-date");
    var searchBtn = targetContainer.querySelector("#epc-search-btn");
    
    searchBtn.addEventListener("click", function () {
      if ((startInput.value && !endInput.value) || (!startInput.value && endInput.value)) {
        alert(state.lang === "en" ? "Please select both start and end dates." : "Пожалуйста, выберите обе даты (начала и окончания).");
        return;
      }
      state.start_date = startInput.value;
      state.end_date = endInput.value;
      fetchVehicles(targetGrid, baseUrl);
    });
    
    var chipBtns = targetContainer.querySelectorAll(".epc-chip-btn");
    chipBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        chipBtns.forEach(function (b) { b.classList.remove("epc-chip-active"); });
        btn.classList.add("epc-chip-active");
        state.category = btn.getAttribute("data-category");
        fetchVehicles(targetGrid, baseUrl);
      });
    });
  }

  function render(target, payload, lang) {
    var vehicles = payload.vehicles || [];
    if (!vehicles.length) {
      target.innerHTML = '<div class="epc-empty">' + (lang === "en" ? "No cars available for the selected dates/category." : "Нет свободных машин на выбранные даты/категорию.") + '</div>';
      return;
    }

    target.innerHTML = vehicles.map(function (car) {
      var photoUrlsAttr = car.photos && car.photos.length ? " data-photos='" + encodeURIComponent(JSON.stringify(car.photos)) + "'" : "";
      var img = car.photo_url
        ? '<img class="epc-card-img" src="' + car.photo_url + '" alt="' + car.title.replace(/"/g, "&quot;") + '" loading="lazy"' + photoUrlsAttr + ' style="cursor: pointer;" title="' + (lang === "en" ? "Click to view gallery" : "Нажмите для просмотра фотогалереи") + '">'
        : '<div class="epc-card-img epc-card-img-empty">' + car.title + '</div>';
      var price = pricingLine(car, lang);
      
      // Customize WhatsApp text with booking dates if selected
      var title = car.title;
      var licensePlate = car.license_plate;
      var text = lang === "en"
        ? "Hello! I want to rent " + title + " (" + licensePlate + ")"
        : "Здравствуйте! Хочу арендовать " + title + " (" + licensePlate + ")";
        
      if (state.start_date && state.end_date) {
        text += lang === "en"
          ? " from " + state.start_date + " to " + state.end_date + "."
          : " с " + state.start_date + " по " + state.end_date + ".";
      } else {
        text += ".";
      }
      var whatsappUrl = "https://wa.me/" + ("${process.env.NEXT_PUBLIC_WHATSAPP_PHONE || '+66827474212'}").replace(/[^\d]/g, "") + "?text=" + encodeURIComponent(text);

      var cta = lang === "en" ? "Book in WhatsApp" : "Забронировать в WhatsApp";
      var statusClass = car.status === "available" ? "epc-status-available" : "epc-status-busy";
      return '<article class="epc-card">' +
        img +
        '<div class="epc-card-body">' +
          '<div class="epc-card-top"><h3>' + car.title + '</h3><span class="epc-status ' + statusClass + '">' + statusLabel(car.status, lang) + '</span></div>' +
          '<p class="epc-meta">' + car.year + ' · ' + car.category + (car.seats ? ' · ' + car.seats + (lang === "en" ? " seats" : " мест") : "") + '</p>' +
          '<p class="epc-desc">' + car.description + '</p>' +
          '<div class="epc-card-bottom"><div class="epc-pricing">' + price + '</div><a href="' + whatsappUrl + '" target="_blank" rel="noopener">' + cta + '</a></div>' +
        '</div>' +
      '</article>';
    }).join("");
  }

  function injectStyles() {
    if (document.getElementById("epicenter-tilda-widget-style")) return;
    var style = document.createElement("style");
    style.id = "epicenter-tilda-widget-style";
    style.textContent = '.epc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px;font-family:Inter,Arial,sans-serif;justify-content:center}.epc-card{overflow:hidden;border:none;border-radius:16px;background:#fff;box-shadow:0 10px 30px rgba(19,163,176,0.08);transition:all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);display:flex;flex-direction:column;max-width:360px;width:100%}.epc-card:hover{transform:translateY(-6px);box-shadow:0 20px 40px rgba(19,163,176,0.15)}.epc-card-img{width:100%;aspect-ratio:4/3;object-fit:cover;background:#e8f8f9;color:#13a3b0;display:grid;place-items:center;font-weight:800;transition:opacity 0.2s}.epc-card-img:hover{opacity:0.9}.epc-card-body{padding:20px;display:flex;flex-direction:column;flex-grow:1;gap:12px}.epc-card-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.epc-card h3{margin:0;font-size:20px;line-height:1.2;color:#112a2d;font-weight:700}.epc-status{padding:5px 10px;border-radius:12px;font-size:11px;font-weight:800;letter-spacing:0.3px;white-space:nowrap;text-transform:uppercase}.epc-status-available{background:#e6fcf5;color:#0ca678}.epc-status-busy{background:#fff4e6;color:#d9480f}.epc-meta{margin:0;color:#5c7d81;font-size:13px;font-weight:500}.epc-desc{margin:0;color:#7e9c9f;font-size:14px;line-height:1.5;flex-grow:1}.epc-card-bottom{display:flex;flex-direction:column;align-items:stretch;gap:14px;margin-top:auto}.epc-pricing{display:flex;flex-direction:column;gap:5px;font-size:13px;color:#5c7d81;background:#f5fcfc;padding:12px 14px;border-radius:12px;border:1px dashed #b5e2e5}.epc-pricing span{display:flex;justify-content:space-between;gap:10px;align-items:center}.epc-pricing span strong{color:#112a2d;font-weight:700}.epc-card-bottom a{display:inline-flex;align-items:center;justify-content:center;text-align:center;min-height:48px;padding:0 24px;border-radius:24px;background:#13a3b0;color:#ffffff !important;text-decoration:none;font-weight:800;font-size:14px;transition:all 0.25s ease;box-shadow:0 4px 12px rgba(19, 163, 176, 0.25);border:none}.epc-card-bottom a:hover{background:#0e848f;transform:translateY(-1px);box-shadow:0 6px 16px rgba(19, 163, 176, 0.35)}#epicenter-lightbox-modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;align-items:center;justify-content:center}#epicenter-lightbox-modal.epc-lightbox-active{display:flex}.epc-lightbox-overlay{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(10,27,29,0.9);backdrop-filter:blur(8px)}.epc-lightbox-content{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;width:90%;max-width:900px}.epc-lightbox-img-wrap{width:100%;aspect-ratio:4/3;max-height:75vh;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,0.5);background:#000}.epc-lightbox-img-wrap img{max-width:100%;max-height:100%;object-fit:contain}.epc-lightbox-close{position:absolute;top:-50px;right:0;background:none;border:none;color:#fff;font-size:36px;cursor:pointer;line-height:1;transition:color 0.2s}.epc-lightbox-close:hover{color:#13a3b0}.epc-lightbox-prev,.epc-lightbox-next{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:28px;width:50px;height:50px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;backdrop-filter:blur(4px)}.epc-lightbox-prev:hover,.epc-lightbox-next:hover{background:#13a3b0;color:#fff}.epc-lightbox-prev{left:-70px}.epc-lightbox-next{right:-70px}.epc-lightbox-counter{margin-top:14px;color:#a5c0c3;font-size:14px;font-weight:600}.epc-empty{padding:30px;border:1px dashed #b5e2e5;border-radius:16px;color:#5c7d81;background:#f5fcfc;text-align:center;font-weight:500}.epc-search-bar{display:flex;flex-direction:column;gap:12px;background:rgba(255,255,255,0.85);backdrop-filter:blur(10px);padding:20px;border-radius:16px;box-shadow:0 10px 30px rgba(19,163,176,0.06);border:1px solid rgba(19,163,176,0.15);margin-bottom:12px;font-family:Inter,Arial,sans-serif}.epc-search-row{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end}.epc-search-field{display:flex;flex-direction:column;gap:6px;flex:1 1 180px}.epc-search-field label{font-size:12px;font-weight:700;color:#112a2d;text-transform:uppercase;letter-spacing:0.5px}.epc-search-field input{width:100%;padding:10px 14px;border-radius:10px;border:1px solid #b5e2e5;font-size:14px;outline:none;transition:all 0.2s;background:#fff;color:#112a2d;height:42px;box-sizing:border-box}.epc-search-field input:focus{border-color:#13a3b0;box-shadow:0 0 0 3px rgba(19,163,176,0.15)}.epc-btn-search{padding:0 24px;border-radius:10px;background:#13a3b0;color:#fff;border:none;font-weight:800;font-size:14px;cursor:pointer;transition:all 0.2s;height:42px;box-shadow:0 4px 12px rgba(19,163,176,0.15)}.epc-btn-search:hover{background:#0e848f;transform:translateY(-1px)}.epc-category-field{align-items:center;width:100%}.epc-chips-container{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;width:75%;margin:0 auto}.epc-chip-btn{text-align:center;padding:8px 16px;border-radius:20px;border:1px solid #b5e2e5;background:#f5fcfc;color:#5c7d81;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;outline:none;flex:1 1 auto;min-width:100px}.epc-chip-btn:hover{background:#e8f8f9;color:#13a3b0}.epc-chip-btn.epc-chip-active{background:#13a3b0;color:#fff;border-color:#13a3b0;box-shadow:0 4px 10px rgba(19,163,176,0.2)}@media(max-width:1024px){.epc-lightbox-prev{left:10px}.epc-lightbox-next{right:10px}.epc-lightbox-close{top:10px;right:20px;z-index:3}}@media(max-width:768px){.epc-grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:16px}.epc-card{max-width:100%}.epc-search-bar{padding:14px;gap:10px;margin-bottom:8px}.epc-search-row{flex-direction:column;align-items:stretch;gap:10px}.epc-search-field{width:100%;flex:none;align-items:center;text-align:center}.epc-search-field label{text-align:center;width:100%}.epc-search-field input{width:100%;max-width:280px;text-align:center}.epc-btn-search{width:auto;min-width:180px;align-self:center;height:44px}.epc-chips-container{width:100%;max-width:100%;gap:6px;justify-content:center}.epc-chip-btn{padding:6px 12px;font-size:12px}}';
    document.head.appendChild(style);
  }

  function boot() {
    injectStyles();
    var scripts = document.querySelectorAll('script[data-epicenter-catalog]');
    scripts.forEach(function (script) {
      var targetSelector = script.getAttribute("data-target") || "#epicenter-catalog";
      var target = document.querySelector(targetSelector);
      if (!target) return;
      
      // Prevent duplicate boot execution
      if (target.getAttribute("data-epicenter-booted")) return;
      target.setAttribute("data-epicenter-booted", "true");

      var lang = script.getAttribute("data-lang") || "ru";
      var category = script.getAttribute("data-category") || "all";
      
      state.lang = lang;

      // Create grid element inside target
      var gridEl = document.createElement("div");
      gridEl.className = "epc-grid";
      target.appendChild(gridEl);

      // Prevent duplicate lightbox event listener
      target.addEventListener("click", function(e) {
        var imgEl = e.target.closest(".epc-card-img");
        if (imgEl && imgEl.getAttribute("data-photos")) {
          try {
            var photos = JSON.parse(decodeURIComponent(imgEl.getAttribute("data-photos")));
            openLightbox(photos, 0);
          } catch(err) {
            console.error("Failed to parse photos", err);
          }
        }
      });

      // Render search bar and fetch initial vehicles
      var baseUrl = "${baseUrl}";
      renderSearchBar(target, gridEl, baseUrl, category);
      fetchVehicles(gridEl, baseUrl);
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
  let baseUrl = (configuredBaseUrl || requestBaseUrl).replace(/\/$/, "");

  // Smart resolution: if the request came through a proxy, get the public facing host
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";

  if (forwardedHost && !forwardedHost.includes("localhost") && !forwardedHost.includes("127.0.0.1") && !forwardedHost.includes("3001") && !forwardedHost.includes("3000")) {
    baseUrl = `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
  } else if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("3001") || baseUrl.includes("3000")) {
    // Fallback for production when local settings might leak or proxy headers are missing
    baseUrl = "https://crm.phuketcar.rent";
  }

  return new NextResponse(widgetScript(baseUrl), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      "Access-Control-Allow-Origin": process.env.TILDA_ALLOWED_ORIGIN || "*"
    }
  });
}
