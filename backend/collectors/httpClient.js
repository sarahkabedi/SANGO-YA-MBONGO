const DEFAULT_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;

function retryDelay(response, attempt) {
  const retryAfter = response?.headers?.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(1000, Math.min(seconds * 1000, 60000));
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(1000, Math.min(retryAt - Date.now(), 60000));
    }
  }
  return Math.min(1000 * (2 ** attempt), 10000);
}

async function fetchText(url, options = {}) {
  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (options.beforeAttempt) {
      await options.beforeAttempt();
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs || DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "SangoYaMbongo/1.0 (+https://github.com/sarahkabedi/SANGO-YA-MBONGO)",
          Accept: options.accept || "application/json, application/rss+xml, application/xml, text/xml",
        },
        signal: controller.signal,
      });

      if (response.ok) {
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > (options.maxBytes || 10 * 1024 * 1024)) {
          throw new Error("La réponse de la source dépasse la taille maximale autorisée.");
        }
        return { body, headers: response.headers };
      }

      const error = new Error(`La source externe a répondu avec le statut HTTP ${response.status}.`);
      error.status = response.status;
      error.code = `SOURCE_HTTP_${response.status}`;
      error.retryAfterMs = retryDelay(response, attempt);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    } catch (error) {
      lastError = error;
      const retryable = error.retryable || error.name === "AbortError" || !error.status;
      if (!retryable || attempt + 1 >= MAX_ATTEMPTS) {
        if (error.name === "AbortError") {
          const timeoutError = new Error("La requête vers la source externe a dépassé son délai maximal.");
          timeoutError.code = "SOURCE_TIMEOUT";
          throw timeoutError;
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(
        resolve,
        error.retryAfterMs || Math.min(1000 * (2 ** attempt), 10000),
      ));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function fetchJson(url, options = {}) {
  const response = await fetchText(url, {
    ...options,
    accept: "application/json",
  });
  try {
    return JSON.parse(response.body);
  } catch {
    const error = new Error("La source externe a renvoyé un document JSON invalide.");
    error.code = "SOURCE_INVALID_JSON";
    throw error;
  }
}

module.exports = { fetchText, fetchJson };
