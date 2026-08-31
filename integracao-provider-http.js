(function exposeHttpIntegrationProvider(global) {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 15000;
  const MIN_TIMEOUT_MS = 3000;
  const MAX_TIMEOUT_MS = 60000;
  const ALLOWED_CONTEXT_FIELDS = Object.freeze(["facilityId", "cycle", "date", "wave"]);
  const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1"]);
  const TIMEOUT_MESSAGE = "Tempo limite ao consultar a fonte operacional.";
  const NETWORK_MESSAGE = "Não foi possível consultar a fonte operacional.";
  const INVALID_JSON_MESSAGE = "Fonte operacional não retornou JSON válido.";

  function normalizedQueryKey(value) {
    return String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function isSensitiveQueryKey(value) {
    const key = normalizedQueryKey(value);
    if (!key) return false;
    const parts = key.split("_");
    return parts.some(part => [
      "token",
      "secret",
      "password",
      "senha",
      "authorization",
      "cookie",
      "csrf"
    ].includes(part)) || key === "api_key";
  }

  function parseEndpoint(endpoint) {
    if (typeof endpoint !== "string" || !endpoint.trim()) {
      throw new TypeError("O endpoint deve ser uma URL absoluta HTTPS.");
    }
    if (typeof global.URL !== "function") {
      throw new Error("O ambiente atual não oferece suporte à validação de URLs.");
    }

    let parsed;
    try {
      parsed = new global.URL(endpoint.trim());
    } catch {
      throw new TypeError("O endpoint deve ser uma URL absoluta HTTPS.");
    }

    const isHttps = parsed.protocol === "https:";
    const isLocalHttp = parsed.protocol === "http:" && LOCAL_HTTP_HOSTS.has(parsed.hostname.toLowerCase());
    if (!isHttps && !isLocalHttp) {
      throw new TypeError("O endpoint deve usar HTTPS; HTTP é permitido somente em ambiente local.");
    }
    if (parsed.username || parsed.password) {
      throw new TypeError("O endpoint não pode conter usuário ou senha.");
    }

    for (const key of parsed.searchParams.keys()) {
      if (isSensitiveQueryKey(key)) {
        throw new TypeError("O endpoint não pode conter credenciais ou segredos na query string.");
      }
    }

    return parsed;
  }

  function validateEndpoint(endpoint) {
    return parseEndpoint(endpoint).toString();
  }

  function supportsLoopbackTargetAddressSpace() {
    if (typeof global.Request !== "function") return false;
    try {
      const probe = new global.Request("http://127.0.0.1/", {
        method: "GET",
        targetAddressSpace: "loopback"
      });
      return probe.targetAddressSpace === "loopback";
    } catch {
      return false;
    }
  }

  function validateTimeoutMs(value) {
    if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
      throw new RangeError(`O timeout deve ser um número inteiro entre ${MIN_TIMEOUT_MS} e ${MAX_TIMEOUT_MS} ms.`);
    }
    return value;
  }

  function contextValue(value) {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return String(value);
    return "";
  }

  function buildRequestUrl(endpoint, context) {
    const url = new global.URL(endpoint);
    const params = new global.URLSearchParams(url.search);
    const safeContext = context && typeof context === "object" && !Array.isArray(context) ? context : {};

    ALLOWED_CONTEXT_FIELDS.forEach(field => {
      const value = contextValue(safeContext[field]);
      if (value) params.set(field, value);
    });

    url.search = params.toString();
    return url.toString();
  }

  function responseContentType(response) {
    if (!response || !response.headers || typeof response.headers.get !== "function") return "";
    return String(response.headers.get("content-type") || "").trim();
  }

  function validatedPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("Resposta operacional inválida.");
    }
    if (!Array.isArray(payload.waves) || !Array.isArray(payload.dispatch) || !Array.isArray(payload.audits)) {
      throw new TypeError("Resposta operacional inválida.");
    }
    return {
      waves: payload.waves,
      dispatch: payload.dispatch,
      audits: payload.audits
    };
  }

  function create(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new TypeError("A configuração do provider HTTP deve ser um objeto.");
    }

    const parsedEndpoint = parseEndpoint(config.endpoint);
    const endpoint = parsedEndpoint.toString();
    const useLoopbackTargetAddressSpace = LOCAL_HTTP_HOSTS.has(parsedEndpoint.hostname.toLowerCase())
      && supportsLoopbackTargetAddressSpace();
    const timeoutMs = validateTimeoutMs(
      config.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : config.timeoutMs
    );

    return Object.freeze({
      async load(context = {}) {
        if (typeof global.fetch !== "function" || typeof global.setTimeout !== "function") {
          throw new Error(NETWORK_MESSAGE);
        }

        const requestUrl = buildRequestUrl(endpoint, context);
        const controller = typeof global.AbortController === "function"
          ? new global.AbortController()
          : null;
        const requestOptions = {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          headers: {
            Accept: "application/json"
          }
        };
        if (useLoopbackTargetAddressSpace) requestOptions.targetAddressSpace = "loopback";
        if (controller) requestOptions.signal = controller.signal;

        let timedOut = false;
        let timeoutId = null;
        const timeout = new Promise((_, reject) => {
          timeoutId = global.setTimeout(() => {
            timedOut = true;
            if (controller) controller.abort();
            reject(new Error(TIMEOUT_MESSAGE));
          }, timeoutMs);
        });

        let response;
        try {
          response = await Promise.race([
            global.fetch(requestUrl, requestOptions),
            timeout
          ]);
        } catch (error) {
          if (timedOut || (error && error.message === TIMEOUT_MESSAGE)) {
            throw new Error(TIMEOUT_MESSAGE);
          }
          throw new Error(NETWORK_MESSAGE);
        } finally {
          if (timeoutId !== null && typeof global.clearTimeout === "function") {
            global.clearTimeout(timeoutId);
          }
        }

        if (!response || typeof response !== "object") {
          throw new Error(NETWORK_MESSAGE);
        }
        if (!response.ok) {
          const status = Number.isInteger(response.status) ? response.status : 0;
          throw new Error(`Fonte operacional respondeu HTTP ${status}.`);
        }
        if (!/^application\/json(?:\s*;|$)/i.test(responseContentType(response))) {
          throw new Error(INVALID_JSON_MESSAGE);
        }

        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new Error(INVALID_JSON_MESSAGE);
        }
        return validatedPayload(payload);
      }
    });
  }

  global.PainelIntegracaoHttpProvider = Object.freeze({
    DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    ALLOWED_CONTEXT_FIELDS,
    create,
    supportsLoopbackTargetAddressSpace,
    validateEndpoint
  });
})(typeof window !== "undefined" ? window : globalThis);
