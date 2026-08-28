/* Minimal, cookie-free site health telemetry. Respects browser privacy signals. */
(() => {
  const config = window.SUPABASE_CONFIG || {};
  const privacyRequested = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  if (!config.url || !config.publishableKey || privacyRequested) return;

  let lastPath = "";
  const viewport = () => innerWidth < 600 ? "small" : innerWidth < 1024 ? "medium" : "large";
  const redact = value => String(value || "unknown error")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 300);
  const sourcePath = value => {
    try { return value ? new URL(value, location.href).pathname.slice(0, 180) : ""; }
    catch { return ""; }
  };
  const send = (eventType, details = {}) => {
    const payload = {
      event_type: eventType,
      path: location.pathname.slice(0, 240),
      referrer_host: (() => { try { return document.referrer ? new URL(document.referrer).hostname : ""; } catch { return ""; } })(),
      viewport: viewport(),
      details
    };
    fetch(`${config.url}/rest/v1/portfolio_events`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.publishableKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(payload)
    }).catch(() => {});
  };

  window.portfolioTelemetry = {
    pageview(path) {
      if (path === lastPath) return;
      lastPath = path;
      send("page_view");
    }
  };
  addEventListener("error", event => send("error", {
    message: redact(event.message),
    source: sourcePath(event.filename),
    line: Number(event.lineno) || null
  }));
  addEventListener("unhandledrejection", event => send("error", {
    message: redact(event.reason?.message || event.reason || "unhandled promise rejection")
  }));
})();
