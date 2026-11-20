"use strict";

const API_BASE = `${window.location.origin}/api`;
const FR_DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });
const FR_DATETIME = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});
const FR_NUMBER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const ARTICLE_FALLBACK_IMAGE = "/assets/illustration-paiements.svg";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function formatDate(value, dateTime = false) {
  if (!value) return "Date non communiquée";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date non communiquée";
  return (dateTime ? FR_DATETIME : FR_DATE).format(date);
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? FR_NUMBER.format(number) : "Non disponible";
}

async function api(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("La réponse du serveur n'est pas au format attendu.");
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Le serveur a répondu avec le code ${response.status}.`);
  }
  return payload;
}

function setState(container, heading, message, action) {
  container.replaceChildren();
  const state = element("div", "state-card");
  if (heading) state.append(element("strong", "", heading));
  if (message) state.append(element("p", "", message));
  if (action) state.append(action);
  container.append(state);
}

function showError(container, error, retry) {
  const button = element("button", "button button-secondary", "Réessayer");
  button.type = "button";
  button.addEventListener("click", retry);
  setState(container, "Impossible de charger les données", error.message, button);
}

function makeArticleVisual(article) {
  const figure = element("figure", "article-visual");
  const imageUrl = safeHttpUrl(article.image_url);
  const credit = typeof article.image_credit === "string" ? article.image_credit.trim() : "";
  const hasCreditedImage = Boolean(imageUrl && credit && article.image_reuse_allowed === true);
  const image = element("img");
  image.src = hasCreditedImage ? imageUrl : ARTICLE_FALLBACK_IMAGE;
  image.alt = "";
  image.loading = "lazy";
  const caption = element(
    "figcaption",
    "",
    hasCreditedImage ? `Image : ${credit}` : "Illustration éditoriale — pas une photo d’actualité",
  );
  let fallbackTimeout;
  const useLocalFallback = () => {
    if (image.dataset.localFallback === "true") return;
    window.clearTimeout(fallbackTimeout);
    image.dataset.localFallback = "true";
    image.onerror = null;
    image.src = ARTICLE_FALLBACK_IMAGE;
    caption.textContent = "Illustration éditoriale — pas une photo d’actualité";
  };
  image.addEventListener("error", useLocalFallback, { once: true });
  image.addEventListener("load", () => window.clearTimeout(fallbackTimeout), { once: true });
  if (hasCreditedImage) fallbackTimeout = window.setTimeout(useLocalFallback, 5000);
  figure.append(image, caption);
  return figure;
}

function makeArticleCard(article) {
  const card = element("article", "article-card");
  card.append(makeArticleVisual(article));
  const meta = element("div", "article-meta");
  if (article.category?.name) meta.append(element("span", "category-pill", article.category.name));
  meta.append(element("span", "", formatDate(article.published_at)));
  card.append(meta);

  const title = element("h3");
  const titleLink = element("a", "", article.title);
  titleLink.href = `/pages/article.html?id=${encodeURIComponent(article.id)}`;
  title.append(titleLink);
  card.append(title);
  if (article.summary) card.append(element("p", "article-card-summary", article.summary));

  const footer = element("div", "article-card-footer");
  const sources = Array.isArray(article.sources) ? article.sources : [];
  footer.append(element("span", "", sources.map((source) => source.name).filter(Boolean).join(", ") || "Source non précisée"));
  const sourceUrl = sources
    .flatMap((source) => Array.isArray(source.originalUrls) ? source.originalUrls : [])
    .map(safeHttpUrl)
    .find(Boolean);
  if (sourceUrl) {
    const original = element("a", "", "Article original ↗");
    original.href = sourceUrl;
    original.target = "_blank";
    original.rel = "noopener noreferrer";
    footer.append(original);
  }
  const details = element("a", "", "Lire la fiche →");
  details.href = titleLink.href;
  footer.append(details);
  card.append(footer);
  return card;
}

function initializeSharedUI() {
  document.querySelectorAll("[data-current-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
  const toggle = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".main-nav");
  if (toggle && navigation) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      navigation.classList.toggle("open", open);
    });
  }
  const homeSearch = document.querySelector("#home-search");
  if (homeSearch) {
    homeSearch.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = new FormData(homeSearch).get("q")?.toString().trim();
      const destination = new URL("/pages/actualites.html", window.location.origin);
      if (query) destination.searchParams.set("q", query);
      window.location.assign(destination);
    });
  }
}

function initializeHomeCarousel() {
  const carousel = document.querySelector("#home-carousel");
  if (!carousel) return;
  const slides = [...carousel.querySelectorAll(".carousel-slide")];
  const dots = [...carousel.querySelectorAll(".carousel-dot")];
  const previous = carousel.querySelector("[data-carousel-previous]");
  const next = carousel.querySelector("[data-carousel-next]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (slides.length < 2 || dots.length !== slides.length || !previous || !next) return;

  let activeIndex = slides.findIndex((slide) => slide.classList.contains("is-active"));
  if (activeIndex < 0) activeIndex = 0;
  let timer;
  let paused = false;

  const showSlide = (index) => {
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === activeIndex;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
      dots[slideIndex].classList.toggle("is-active", active);
      if (active) dots[slideIndex].setAttribute("aria-current", "true");
      else dots[slideIndex].removeAttribute("aria-current");
    });
  };

  const stopAutoplay = () => {
    window.clearInterval(timer);
    timer = undefined;
  };

  const startAutoplay = () => {
    stopAutoplay();
    if (paused || reducedMotion.matches || document.hidden) return;
    timer = window.setInterval(() => showSlide(activeIndex + 1), 7000);
  };

  previous.addEventListener("click", () => {
    showSlide(activeIndex - 1);
    startAutoplay();
  });
  next.addEventListener("click", () => {
    showSlide(activeIndex + 1);
    startAutoplay();
  });
  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => {
      showSlide(index);
      startAutoplay();
    });
  });
  carousel.addEventListener("pointerenter", () => {
    paused = true;
    stopAutoplay();
  });
  carousel.addEventListener("pointerleave", () => {
    paused = false;
    startAutoplay();
  });
  carousel.addEventListener("focusin", () => {
    paused = true;
    stopAutoplay();
  });
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) {
      paused = false;
      startAutoplay();
    }
  });
  document.addEventListener("visibilitychange", startAutoplay);
  reducedMotion.addEventListener?.("change", startAutoplay);

  carousel.querySelectorAll(".carousel-illustration img").forEach((image) => {
    const useFallback = () => {
      if (image.getAttribute("src") === ARTICLE_FALLBACK_IMAGE) return;
      window.clearTimeout(imageFallbackTimer);
      image.src = ARTICLE_FALLBACK_IMAGE;
    };
    image.addEventListener("error", useFallback, { once: true });
    const imageFallbackTimer = window.setTimeout(useFallback, 5000);
    image.addEventListener("load", () => window.clearTimeout(imageFallbackTimer), { once: true });
    if (image.complete && image.naturalWidth === 0) useFallback();
  });

  startAutoplay();
}

async function loadHomeArticles() {
  const target = document.querySelector("#home-articles");
  if (!target) return;
  try {
    const result = await api("/articles?limit=3&page=1");
    const articles = result.data || [];
    if (!articles.length) {
      setState(target, "Aucune actualité publiée pour le moment", "Les articles apparaîtront ici après leur validation éditoriale.");
      return;
    }
    target.replaceChildren(...articles.map(makeArticleCard));
  } catch (error) {
    showError(target, error, loadHomeArticles);
  }
}

async function loadFilterOptions(selectId, endpoint, labelKey, valueKey, selected) {
  const select = document.querySelector(selectId);
  if (!select) return;
  try {
    const result = await api(endpoint);
    for (const item of result.data || []) {
      const option = element("option", "", item[labelKey]);
      option.value = item[valueKey];
      option.selected = item[valueKey] === selected;
      select.append(option);
    }
  } catch {
    const option = element("option", "", "Indisponible");
    option.disabled = true;
    select.append(option);
  }
}

function readArticleFilters(form) {
  const data = new FormData(form);
  const filters = new URLSearchParams();
  for (const key of ["q", "category", "source", "from", "to"]) {
    const value = data.get(key)?.toString().trim();
    if (value) filters.set(key, value);
  }
  return filters;
}

async function initializeNewsPage() {
  const form = document.querySelector("#news-filters");
  if (!form) return;
  const resultsContainer = document.querySelector("#news-results");
  const count = document.querySelector("#results-count");
  const pagination = document.querySelector("#pagination");
  const pageLabel = document.querySelector("#page-label");
  const limitSelect = document.querySelector("#page-size");
  const initial = new URLSearchParams(window.location.search);
  for (const key of ["q", "category", "source", "from", "to"]) {
    const field = form.elements.namedItem(key);
    if (field && initial.has(key)) field.value = initial.get(key);
  }
  await Promise.all([
    loadFilterOptions("#filter-category", "/categories", "name", "slug", initial.get("category")),
    loadFilterOptions("#filter-source", "/sources", "name", "code", initial.get("source")),
  ]);
  if (initial.has("category")) document.querySelector("#filter-category").value = initial.get("category");
  if (initial.has("source")) document.querySelector("#filter-source").value = initial.get("source");

  let page = Number(initial.get("page")) || 1;
  const loadPage = async () => {
    resultsContainer.replaceChildren();
    const loading = element("div", "state-card loading-state");
    const spinner = element("span", "spinner");
    spinner.setAttribute("aria-hidden", "true");
    loading.append(spinner, element("p", "", "Chargement des actualités…"));
    resultsContainer.append(loading);
    count.textContent = "Chargement…";
    pagination.hidden = true;
    const filters = readArticleFilters(form);
    const limit = limitSelect.value;
    filters.set("page", String(page));
    filters.set("limit", limit);
    const nextUrl = new URL(window.location.href);
    nextUrl.search = readArticleFilters(form).toString();
    if (page > 1) nextUrl.searchParams.set("page", String(page));
    window.history.replaceState({}, "", nextUrl);
    try {
      const result = await api(`/articles?${filters.toString()}`);
      const articles = result.data || [];
      const paging = result.pagination || { page: 1, total: articles.length, totalPages: 1 };
      count.textContent = `${paging.total} résultat${paging.total === 1 ? "" : "s"}`;
      if (!articles.length) {
        setState(resultsContainer, "Aucun résultat", "Essayez d'autres mots-clés ou ajustez les filtres.");
        return;
      }
      resultsContainer.replaceChildren(...articles.map(makeArticleCard));
      if (paging.totalPages > 1) {
        pagination.hidden = false;
        pageLabel.textContent = `Page ${paging.page} sur ${paging.totalPages}`;
        document.querySelector("#previous-page").disabled = paging.page <= 1;
        document.querySelector("#next-page").disabled = paging.page >= paging.totalPages;
      }
    } catch (error) {
      count.textContent = "Résultats indisponibles";
      showError(resultsContainer, error, loadPage);
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    page = 1;
    loadPage();
  });
  document.querySelector("#reset-filters").addEventListener("click", () => {
    form.reset();
    page = 1;
    loadPage();
  });
  limitSelect.addEventListener("change", () => {
    page = 1;
    loadPage();
  });
  document.querySelector("#previous-page").addEventListener("click", () => {
    if (page > 1) {
      page -= 1;
      loadPage();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  document.querySelector("#next-page").addEventListener("click", () => {
    page += 1;
    loadPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  await loadPage();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(api[_-]?key|access[_-]?token|token|secret|password|signature|sig|auth)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.href;
  } catch {
    return null;
  }
}

async function initializeArticlePage() {
  const state = document.querySelector("#article-state");
  const detail = document.querySelector("#article-detail");
  if (!state || !detail) return;
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id || !/^[1-9]\d*$/.test(id)) {
    setState(state, "Article introuvable", "L'identifiant de l'article est absent ou invalide.");
    return;
  }
  try {
    const result = await api(`/articles/${encodeURIComponent(id)}`);
    const article = result.data;
    document.title = `${article.title} — SANGO YA MBONGO`;
    detail.replaceChildren();
    detail.append(makeArticleVisual(article));
    const meta = element("div", "article-meta");
    if (article.category?.name) meta.append(element("span", "category-pill", article.category.name));
    meta.append(element("span", "", formatDate(article.published_at)));
    detail.append(meta, element("h1", "", article.title));
    if (article.summary) detail.append(element("p", "article-summary", article.summary));
    detail.append(element("p", "content-note", "Le contenu détaillé de cette publication n'est pas fourni par l'API. Consultez la source d'origine pour lire l'article complet."));

    const sources = Array.isArray(article.sources) ? article.sources : [];
    const heading = element("h2", "", "Sources et liens d'origine");
    heading.className = "detail-section-title";
    detail.append(heading);
    const list = element("div", "source-list");
    for (const source of sources) {
      const item = element("div", "source-item");
      const copy = element("div");
      copy.append(element("strong", "", source.name || "Source"));
      copy.append(element("small", "", source.type || "Source d'information"));
      item.append(copy);
      const urls = Array.isArray(source.originalUrls) ? source.originalUrls : [];
      const validUrl = urls.map(safeHttpUrl).find(Boolean);
      if (validUrl) {
        const link = element("a", "button button-secondary", "Lire à la source ↗");
        link.href = validUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        item.append(link);
      }
      list.append(item);
    }
    if (!sources.length) list.append(element("p", "chart-empty", "Aucune source associée n'est disponible."));
    detail.append(list);
    state.hidden = true;
    detail.hidden = false;
  } catch (error) {
    showError(state, error, initializeArticlePage);
  }
}

function createIndicatorChart(observations, unit) {
  const sorted = [...observations]
    .filter((item) => item.value_normalized !== null
      && item.value_normalized !== undefined
      && String(item.value_normalized).trim() !== ""
      && Number.isFinite(Number(item.value_normalized))
      && item.period_end
      && Number.isFinite(Date.parse(item.period_end)))
    .sort((a, b) => new Date(a.period_end) - new Date(b.period_end))
    .slice(-12);
  if (!sorted.length) return null;

  const width = 720;
  const height = 220;
  const pad = { top: 26, right: 22, bottom: 48, left: 52 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const values = sorted.map((item) => Number(item.value_normalized));
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) max = min + 1;
  const y = (value) => pad.top + (max - value) / (max - min) * innerHeight;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Évolution des ${sorted.length} observations disponibles, unité ${unit || "non précisée"}`);
  const baseline = document.createElementNS(svg.namespaceURI, "line");
  baseline.setAttribute("x1", pad.left);
  baseline.setAttribute("x2", width - pad.right);
  baseline.setAttribute("y1", y(0));
  baseline.setAttribute("y2", y(0));
  baseline.setAttribute("stroke", "#dce6dd");
  svg.append(baseline);
  const slot = innerWidth / sorted.length;
  const barWidth = Math.min(34, slot * .5);

  sorted.forEach((item, index) => {
    const value = Number(item.value_normalized);
    const center = pad.left + slot * (index + .5);
    const rect = document.createElementNS(svg.namespaceURI, "rect");
    rect.setAttribute("x", center - barWidth / 2);
    rect.setAttribute("y", Math.min(y(value), y(0)));
    rect.setAttribute("width", barWidth);
    rect.setAttribute("height", Math.max(2, Math.abs(y(value) - y(0))));
    rect.setAttribute("rx", "4");
    rect.setAttribute("fill", "#F97316");
    const title = document.createElementNS(svg.namespaceURI, "title");
    title.textContent = `${formatDate(item.period_end)} : ${item.value_normalized} ${item.unit_normalized || unit || ""}`;
    rect.append(title);
    svg.append(rect);

    const valueLabel = document.createElementNS(svg.namespaceURI, "text");
    valueLabel.setAttribute("x", center);
    valueLabel.setAttribute("y", Math.max(16, Math.min(y(value), y(0)) - 7));
    valueLabel.setAttribute("text-anchor", "middle");
    valueLabel.setAttribute("fill", "#35563d");
    valueLabel.setAttribute("font-size", sorted.length > 8 ? "9" : "10");
    valueLabel.textContent = formatNumber(item.value_normalized);
    svg.append(valueLabel);

    const dateLabel = document.createElementNS(svg.namespaceURI, "text");
    dateLabel.setAttribute("x", center);
    dateLabel.setAttribute("y", height - 19);
    dateLabel.setAttribute("text-anchor", "middle");
    dateLabel.setAttribute("fill", "#6a786e");
    dateLabel.setAttribute("font-size", "10");
    dateLabel.textContent = new Date(item.period_end).getUTCFullYear().toString();
    svg.append(dateLabel);
  });

  const figure = element("figure", "indicator-chart");
  figure.append(svg);
  return figure;
}

function renderObservationTable(observations) {
  const wrap = element("div", "observation-table-wrap");
  const table = element("table", "observation-table");
  const caption = element("caption", "", "Observations réelles communiquées par les sources");
  table.append(caption);
  const headers = [
    "Période",
    "Valeur normalisée",
    "Valeur brute",
    "Source",
    "Mise à jour source",
    "Collectée le",
  ];
  const thead = element("thead");
  const headerRow = element("tr");
  headers.forEach((label) => headerRow.append(element("th", "", label)));
  thead.append(headerRow);
  table.append(thead);

  const tbody = element("tbody");
  observations.forEach((observation) => {
    const row = element("tr");
    const period = element("td", "", `${formatDate(observation.period_start)} – ${formatDate(observation.period_end)}`);
    const normalized = element(
      "td",
      "",
      observation.value_normalized === null || observation.value_normalized === undefined
        ? "Non disponible"
        : `${formatNumber(observation.value_normalized)} ${observation.unit_normalized || ""}`.trim(),
    );
    if (observation.value_normalized !== null && observation.value_normalized !== undefined) {
      normalized.title = `${observation.value_normalized} ${observation.unit_normalized || ""}`.trim();
    }
    const raw = element(
      "td",
      "",
      observation.value_raw === null || observation.value_raw === undefined
        ? "Non disponible"
        : `${formatNumber(observation.value_raw)} ${observation.unit_raw || ""}`.trim(),
    );
    if (observation.value_raw !== null && observation.value_raw !== undefined) {
      raw.title = `${observation.value_raw} ${observation.unit_raw || ""}`.trim();
    }
    const sourceCell = element("td");
    const sourceName = element(
      "span",
      "",
      observation.source_name || observation.source_code || "Source non précisée",
    );
    const homepageUrl = safeHttpUrl(observation.source_homepage_url);
    if (homepageUrl) {
      const sourceLink = element("a");
      sourceLink.href = homepageUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceLink.textContent = sourceName.textContent;
      sourceCell.append(sourceLink);
    } else {
      sourceCell.append(sourceName);
    }
    const sourceUrl = safeHttpUrl(observation.document_original_url);
    if (sourceUrl) {
      const link = element("a");
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = observation.document_title || "Document source";
      sourceCell.append(document.createElement("br"), link);
    }
    const sourceUpdated = observation.source_updated_at
      ? formatDate(observation.source_updated_at, true)
      : "Non communiquée";
    const collected = observation.collected_at
      ? formatDate(observation.collected_at, true)
      : "Non disponible";
    row.append(
      period,
      normalized,
      raw,
      sourceCell,
      element("td", "", sourceUpdated),
      element("td", "", collected),
    );
    tbody.append(row);
  });
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

function renderIndicatorCard(indicator, detail) {
  const card = element("article", "indicator-card");
  const header = element("div", "indicator-card-header");
  const titleBlock = element("div");
  titleBlock.append(element("h2", "", indicator.name));
  titleBlock.append(element("p", "indicator-definition", indicator.definition || "Définition non fournie par la source."));
  header.append(titleBlock, element("span", "indicator-code", indicator.code));
  card.append(header);

  const observations = detail?.observations?.data || [];
  const totalObservations = detail?.observations?.pagination?.total ?? observations.length;
  const summary = element("div", "indicator-summary");
  summary.append(element("span", "", `Unité : ${indicator.unit || "non précisée"}`));
  summary.append(element("span", "", `Fréquence : ${indicator.frequency || "non précisée"}`));
  summary.append(element("span", "", `Observations enregistrées : ${totalObservations}`));
  card.append(summary);

  const explainer = element("section", "indicator-explainer");
  explainer.append(element("h3", "", "Comment lire cet indicateur"));
  explainer.append(element(
    "p",
    "",
    `Cet indicateur mesure la part des personnes de 15 ans et plus qui détiennent un compte dans une institution financière OU qui ont personnellement utilisé un service de monnaie mobile. Il ne mesure donc pas exclusivement le Mobile Money. Chaque valeur correspond à l'année et à l'unité affichées; la définition et la fréquence (${indicator.frequency || "non précisée"}) proviennent de la source. Une absence d'observation ne signifie pas zéro.`,
  ));
  card.append(explainer);

  if (!observations.length) {
    card.append(element(
      "p",
      "chart-empty",
      "Aucune observation normalisée n'est actuellement enregistrée pour cet indicateur. Aucun graphique n'est affiché tant qu'une valeur réelle n'est pas disponible.",
    ));
    return card;
  }

  const chart = createIndicatorChart(observations, indicator.unit);
  if (chart) {
    card.append(chart);
  }
  card.append(renderObservationTable(observations));
  if (observations.length < totalObservations) {
    card.append(element(
      "p",
      "observation-coverage",
      `Les ${observations.length} observations les plus récentes sont affichées sur ${totalObservations}.`,
    ));
  }
  const latestCollection = observations
    .filter((item) => item.collected_at && Number.isFinite(Date.parse(item.collected_at)))
    .sort((a, b) => Date.parse(b.collected_at) - Date.parse(a.collected_at))[0];
  if (latestCollection) {
    card.append(element(
      "p",
      "observation-source",
      `Dernière mise à jour connue dans la plateforme : ${formatDate(latestCollection.collected_at, true)} (${latestCollection.source_name || latestCollection.source_code || "source non précisée"}).`,
    ));
  }
  return card;
}

async function initializeDashboard() {
  const status = document.querySelector("#dashboard-status");
  const grid = document.querySelector("#indicator-grid");
  if (!status || !grid) return;
  try {
    const result = await api("/indicators");
    const indicators = result.data || [];
    if (!indicators.length) {
      setState(status, "Aucun indicateur disponible", "Les indicateurs apparaîtront ici lorsqu'ils seront configurés.");
      return;
    }
    const details = await Promise.all(indicators.map(async (indicator) => {
      try {
        const response = await api(`/indicators/${encodeURIComponent(indicator.id)}?page=1&limit=100`);
        return { indicator, detail: response.data };
      } catch (error) {
        return { indicator, error };
      }
    }));
    status.hidden = true;
    for (const item of details) {
      if (item.error) {
        const card = element("article", "indicator-card");
        card.append(element("h2", "", item.indicator.name));
        card.append(element("p", "chart-empty", `Les observations n'ont pas pu être chargées : ${item.error.message}`));
        grid.append(card);
      } else {
        grid.append(renderIndicatorCard(item.indicator, item.detail));
      }
    }
  } catch (error) {
    showError(status, error, initializeDashboard);
  }
}

initializeSharedUI();
initializeHomeCarousel();
if (document.body.dataset.page === "home") loadHomeArticles();
if (document.body.dataset.page === "news") initializeNewsPage();
if (document.body.dataset.page === "article") initializeArticlePage();
if (document.body.dataset.page === "dashboard") initializeDashboard();