(() => {
  const normalizeText = value => String(value ?? "").trim();
  const routeKeySafe = value => {
    try {
      if (typeof routeKey === "function") return routeKey(value);
    } catch (_) {}
    return normalizeText(value).toUpperCase().replace(/\s+/g, "");
  };
  const firstWordsSafe = (value, count = 2) => normalizeText(value)
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
  const repName = row => firstWordsSafe(
    row?.repLog || row?.rep || row?.log || row?.representante || row?.responsavel || row?.responsável || "",
    2
  );

  function aduanaRepMap() {
    const map = new Map();

    try {
      if (typeof baseDetailsByRoute === "function") {
        baseDetailsByRoute().forEach((row, key) => {
          if (key && row) map.set(key, { ...(map.get(key) || {}), ...row });
        });
      }
    } catch (_) {}

    try {
      if (typeof data !== "undefined" && Array.isArray(data.baseAduana)) {
        data.baseAduana.forEach(row => {
          const key = routeKeySafe(row?.rota);
          if (key) map.set(key, { ...(map.get(key) || {}), ...row });
        });
      }
    } catch (_) {}

    return map;
  }

  function applyRepLogToDockCards() {
    const grid = document.getElementById("dockGrid");
    if (!grid) return;

    const detailsMap = aduanaRepMap();
    grid.querySelectorAll(".slot[data-route-key]").forEach(slot => {
      const key = routeKeySafe(slot.dataset.routeKey);
      const row = detailsMap.get(key) || {};
      const name = repName(row);
      const head = slot.querySelector(".dock-card-head");
      if (!head) return;

      let label = head.querySelector(".dock-person[data-rep-log-fix]");
      if (!name) {
        label?.remove();
        return;
      }

      if (!label) {
        label = document.createElement("span");
        label.className = "dock-person";
        label.dataset.repLogFix = "true";
        head.appendChild(label);
      }
      label.textContent = name;
      label.title = normalizeText(row.repLog || row.rep || row.log || row.representante || name);
    });
  }

  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(applyRepLogToDockCards);
  };

  function init() {
    const grid = document.getElementById("dockGrid");
    if (!grid) return;
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(grid, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) schedule();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();