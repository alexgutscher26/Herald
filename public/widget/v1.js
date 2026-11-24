/*!
 * Herald widget loader v1.
 *
 * One external script, one `data-project` attribute, no inline snippet and no
 * inline styles. The launcher lives in a shadow root so host CSS cannot leak
 * in; its stylesheet is a separate same-origin file so a strict style-src that
 * allows the Herald origin still works. `embed()` mounts the same iframe into
 * a host-provided container instead of the floating launcher. New breaking
 * behaviour is a new versioned URL, never an edit to this file.
 */
(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var candidates = document.querySelectorAll(
        'script[data-project][src*="/widget/v1.js"]',
      );
      return candidates.length ? candidates[candidates.length - 1] : null;
    })();

  if (!script) return;

  var project = parseProject(script.getAttribute("data-project"));
  if (!project) {
    if (window.console) {
      window.console.error(
        "[herald-widget] data-project must be a workspace/product pair.",
      );
    }
    return;
  }

  if (window.HeraldWidget && window.HeraldWidget.version === "v1") return;

  var previewToken = readPreviewToken(script.getAttribute("data-preview"));

  var scriptUrl;
  try {
    scriptUrl = new URL(script.src, window.location.href);
  } catch {
    return;
  }

  var origin = scriptUrl.origin;
  var hostOrigin = window.location.origin;
  var basePath =
    origin +
    "/p/" +
    encodeURIComponent(project.workspace) +
    "/" +
    encodeURIComponent(project.product) +
    "/embed";
  var stylesheet = origin + "/widget/v1.css?v=8";

  // Installation is counted once per loader boot. Use a beacon so a closing
  // host page cannot cancel the request, and never include host or identity.
  // A preview is not an installation and must not touch analytics.
  try {
    if (!previewToken && navigator.sendBeacon) {
      navigator.sendBeacon(
        origin + "/api/public/widget/events",
        new Blob(
          [
            JSON.stringify({
              workspaceSlug: project.workspace,
              productSlug: project.product,
              event: "widget_install",
              // Coarse installation metadata for the health panel. No
              // identity, session or page URL is sent.
              origin: hostOrigin,
              version: "v1",
            }),
          ],
          { type: "application/json" },
        ),
      );
    }
  } catch {
    // Analytics must never prevent the widget from loading.
  }

  var explicitTheme = readTheme(script.getAttribute("data-theme"));
  var explicitLocale = readLocale(script.getAttribute("data-locale"));
  var position = readPosition(script.getAttribute("data-position"));
  var triggerSelector = script.getAttribute("data-trigger");
  var customLabel = script.getAttribute("data-label");
  var explicitAccent = readAccent(script.getAttribute("data-accent"));
  var explicitAccentFg = readAccent(script.getAttribute("data-accent-fg"));
  var projectKey = readProjectKey(script.getAttribute("data-key"));
  // Strict host CSPs allow a nonce on the stylesheet element the loader adds
  // to its shadow root. Nothing is rendered inline, so this is the only
  // element that can need one.
  var scriptNonce = readNonce(script.getAttribute("data-nonce"));

  var state = {
    open: false,
    ready: false,
    mounted: false,
    destroyed: false,
    inline: false,
    syncUrl: false,
    urlParam: "herald",
    panel: normalizePanel(script.getAttribute("data-panel") || "home"),
    theme: explicitTheme,
    locale: explicitLocale,
    sections: script.getAttribute("data-sections"),
    accent: explicitAccent,
    accentFg: explicitAccentFg,
    unread: 0,
    online: false,
    degraded: null,
    identified: false,
    identityError: null,
    startedAt: Date.now(),
    // Product events fired by the host page. Experience and survey rules may
    // wait for one; an event that has not fired never matches.
    events: {},
  };

  var host;
  var shadow;
  var root;
  var button;
  var panel;
  var frame;
  var labelNode;
  var dot;
  var customTrigger;
  var triggerHandler;
  var pendingTasks = [];
  var identifyQueue = [];
  var logoutQueue = [];
  var pendingIdentify = {};
  var pendingLogout = {};
  var lastStateSignature = "";
  var liveRegion;
  var fallback;
  var fallbackTitle;
  var fallbackBody;
  var fallbackLink;
  var fallbackRetry;
  var handshakeTimer = 0;
  var experienceContainer;
  var experienceItems = [];
  var impressionsSent = {};
  var tourTarget;
  var listeners = {
    ready: [],
    open: [],
    close: [],
    identify: [],
    unread: [],
    presence: [],
    statechange: [],
    error: [],
  };

  function parseProject(value) {
    if (typeof value !== "string") return null;
    var parts = value.trim().split("/");
    if (parts.length !== 2) return null;
    if (!validSlug(parts[0]) || !validSlug(parts[1])) return null;
    return { workspace: parts[0], product: parts[1] };
  }

  function validSlug(value) {
    return /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/.test(value);
  }

  function validSegment(value) {
    return (
      /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }

  function readTheme(value) {
    return value === "light" || value === "dark" || value === "auto"
      ? value
      : null;
  }

  function readLocale(value) {
    return value === "en" || value === "es" ? value : null;
  }

  function readPosition(value) {
    return value === "bottom-left" ||
      value === "top-left" ||
      value === "top-right"
      ? value
      : "bottom-right";
  }

  /** A per-origin position from the frame; null means "no override". */
  function readPositionOverride(value) {
    return value === "bottom-left" ||
      value === "top-left" ||
      value === "top-right" ||
      value === "bottom-right"
      ? value
      : null;
  }

  function readNonce(value) {
    return typeof value === "string" &&
      /^[A-Za-z0-9+/_=-]{8,256}$/.test(value.trim())
      ? value.trim()
      : "";
  }

  function prefersReducedMotion() {
    try {
      return Boolean(
        window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    } catch (error) {
      return false;
    }
  }

  function readProjectKey(value) {
    if (typeof value !== "string") return "";
    var trimmed = value.trim();
    return /^hpk_[A-Za-z0-9_-]{20,120}$/.test(trimmed) ? trimmed : "";
  }

  /** Bearer link from the dashboard preview action; validated by the server. */
  function readPreviewToken(value) {
    if (typeof value !== "string") return "";
    var trimmed = value.trim();
    return /^[A-Za-z0-9_-]{24,120}$/.test(trimmed) ? trimmed : "";
  }

  function readAccent(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
      ? value.toLowerCase()
      : "";
  }

  function applyAccent() {
    if (!root) return;
    if (state.accent) root.style.setProperty("--herald-accent", state.accent);
    if (state.accentFg) {
      root.style.setProperty("--herald-accent-fg", state.accentFg);
    }
  }

  function normalizePanel(value) {
    var raw = typeof value === "string" ? value.trim().replace(/^\/+|\/+$/g, "") : "";
    if (raw === "") return "";

    var parts = raw.split("/").filter(Boolean);
    if (parts.length === 0 || parts.length > 3) return "";
    if (parts[0] === "home") return "";
    if (
      parts[0] !== "feedback" &&
      parts[0] !== "roadmap" &&
      parts[0] !== "updates" &&
      parts[0] !== "messages" &&
      parts[0] !== "notifications"
    ) {
      return "";
    }
    for (var index = 0; index < parts.length; index += 1) {
      if (!validSegment(parts[index])) return "";
    }
    return parts.join("/");
  }

  function buildFrameUrl(panelPath) {
    var params = ["host=" + encodeURIComponent(hostOrigin)];
    if (projectKey) params.push("key=" + encodeURIComponent(projectKey));
    if (previewToken) params.push("preview=" + encodeURIComponent(previewToken));
    if (state.theme) params.push("theme=" + encodeURIComponent(state.theme));
    if (state.locale) params.push("locale=" + encodeURIComponent(state.locale));
    if (state.sections !== null) {
      params.push("sections=" + encodeURIComponent(state.sections));
    }
    return (
      basePath + (panelPath ? "/" + panelPath : "") + "?" + params.join("&")
    );
  }

  /**
   * Ask the frame to re-read the unread count. The panel polls on its own; a
   * customer who opens the widget should not wait for the next tick to see a
   * changelog or reply that landed after the frame was loaded.
   */
  function requestUnreadRefresh() {
    if (!frame || !frame.contentWindow || !state.ready) return;
    frame.contentWindow.postMessage(
      { source: "herald-widget-host", type: "refresh" },
      origin,
    );
  }

  /**
   * Tell the frame whether it is a floating panel (focus is contained) or an
   * inline embed that is part of the page's own reading order (not contained).
   * Sent in reply to every state message, so a full frame reload re-arms it.
   */
  function sendMode() {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { source: "herald-widget-host", type: "mode", inline: state.inline },
      origin,
    );
  }

  function readUrlParam(value) {
    return typeof value === "string" &&
      /^[a-z][a-z0-9_-]{0,31}$/i.test(value)
      ? value
      : "herald";
  }

  /** The panel encoded in the host page URL, or null when it is absent. */
  function readPanelFromUrl() {
    if (!state.syncUrl) return null;
    try {
      var url = new URL(window.location.href);
      if (!url.searchParams.has(state.urlParam)) return null;
      return normalizePanel(url.searchParams.get(state.urlParam) || "");
    } catch {
      return null;
    }
  }

  /**
   * Keep a shareable host URL without adding an extra history entry. The
   * iframe owns its own back/forward history; replaceState makes the current
   * inline panel survive a reload or copy/paste without doubling every step.
   */
  function writePanelToUrl(panelPath) {
    if (!state.syncUrl || state.destroyed) return;
    try {
      var url = new URL(window.location.href);
      if (panelPath) url.searchParams.set(state.urlParam, panelPath);
      else url.searchParams.delete(state.urlParam);
      if (url.href === window.location.href) return;
      window.history.replaceState(window.history.state, "", url.href);
    } catch {
      // A sandboxed or frozen history is not a reason to break the widget.
    }
  }

  function onPopState() {
    if (!state.inline || !state.syncUrl || state.destroyed) return;
    var panelPath = readPanelFromUrl();
    if (panelPath === null) return;
    applyPanel(panelPath, false);
  }

  function applyPanel(panelPath, syncUrl) {
    var normalized = normalizePanel(panelPath);
    state.panel = normalized;
    if (frame) frame.src = buildFrameUrl(normalized);
    if (syncUrl) writePanelToUrl(normalized);
    notifyStateChange();
  }

  function labelText() {
    if (customLabel && customLabel.trim() !== "") return customLabel.trim();
    return state.locale === "es" ? "Novedades" : "What's new";
  }

  function unreadText(count) {
    if (count <= 0) return "";
    return state.locale === "es" ? count + " sin leer" : count + " unread";
  }

  function emit(name, value) {
    var handlers = listeners[name];
    if (!handlers) return;
    for (var index = 0; index < handlers.length; index += 1) {
      try {
        handlers[index](value);
      } catch (error) {
        if (window.console) window.console.error(error);
      }
    }
  }

  function enqueue(task) {
    if (state.mounted) {
      task();
      return;
    }
    pendingTasks.push(task);
  }

  /** Emit `statechange` only when the observable snapshot really changed. */
  function notifyStateChange() {
    var next = JSON.stringify(api.getState());
    if (next === lastStateSignature) return;
    lastStateSignature = next;
    emit("statechange", api.getState());
  }

  function reportError(scope, message) {
    if (window.console) {
      window.console.error("[herald-widget] " + message);
    }
    emit("error", { scope: scope, message: message });
  }

  function recordIdentityError(message) {
    state.identityError = message;
    reportError("identify", message);
    notifyStateChange();
  }

  function createLiveRegion() {
    if (liveRegion) return;
    liveRegion = document.createElement("div");
    liveRegion.className = "herald-live";
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("aria-atomic", "true");
  }

  /**
   * Announce a change from inside the shadow root. Screen readers do not
   * reliably follow state written into a shadow tree, so the live region is
   * part of the same root and updated as text, never as a visual-only badge.
   */
  function announce(message) {
    if (!liveRegion || !message) return;
    liveRegion.textContent = "";
    window.setTimeout(function () {
      if (liveRegion) liveRegion.textContent = message;
    }, 30);
  }

  function fallbackMessage(reason) {
    var es = state.locale === "es";
    if (reason === "cookies") {
      return {
        title: es ? "No podemos iniciar sesión" : "Sign-in is unavailable",
        body: es
          ? "Tu navegador bloquea las cookies de terceros para este widget, así que no puede cargar tu sesión. Abre el panel en una pestaña nueva o permite cookies de terceros para este sitio."
          : "Your browser blocks third-party cookies for this widget, so it cannot load your session. Open the panel in a new tab or allow third-party cookies for this site.",
      };
    }
    if (reason === "offline") {
      return {
        title: es ? "Sin conexión" : "You're offline",
        body: es
          ? "El widget se volverá a conectar automáticamente cuando recuperes la conexión."
          : "The widget will reconnect automatically when your connection returns.",
      };
    }
    return {
      title: es ? "El widget no está disponible" : "The widget is unavailable",
      body: es
        ? "No pudimos conectar con el widget. Comprueba tu conexión e inténtalo de nuevo."
        : "We couldn't reach the widget. Check your connection and try again.",
    };
  }

  function ensureFallback() {
    if (fallback && fallback.parentNode) return fallback;

    fallback = document.createElement("div");
    fallback.className = "herald-fallback";
    fallback.hidden = true;
    fallback.setAttribute("role", "alert");

    fallbackTitle = document.createElement("strong");
    fallback.appendChild(fallbackTitle);

    fallbackBody = document.createElement("p");
    fallback.appendChild(fallbackBody);

    var actions = document.createElement("div");
    actions.className = "herald-fallback-actions";

    fallbackRetry = document.createElement("button");
    fallbackRetry.type = "button";
    fallbackRetry.className = "herald-fallback-retry";
    fallbackRetry.addEventListener("click", retryWidgetFrame);
    actions.appendChild(fallbackRetry);

    fallbackLink = document.createElement("a");
    fallbackLink.className = "herald-fallback-link";
    fallbackLink.target = "_blank";
    fallbackLink.rel = "noreferrer";
    actions.appendChild(fallbackLink);

    fallback.appendChild(actions);
    return fallback;
  }

  function showFallback(reason) {
    if (!root || state.destroyed) return;
    var wasOpen = state.open;
    var copy = fallbackMessage(reason);
    state.degraded = reason;

    var node = ensureFallback();
    if (node.parentNode !== root) root.appendChild(node);
    fallbackTitle.textContent = copy.title;
    fallbackBody.textContent = copy.body;
    fallbackRetry.textContent = state.locale === "es" ? "Reintentar" : "Try again";
    fallbackLink.textContent =
      state.locale === "es" ? "Abrir en una pestaña nueva" : "Open in a new tab";
    fallbackLink.href = buildFrameUrl(state.panel);
    // Only reveal the card with the panel (or in place for an inline embed).
    // Shown while the launcher is closed, it floats over the host page and
    // swallows clicks meant for the page underneath.
    node.hidden = !(state.open || state.inline);

    if (frame) {
      frame.hidden = true;
      // WebKit keeps a shadow iframe with the hidden attribute laid out in
      // some versions; the inline display is the reliable cross-engine switch.
      frame.style.display = "none";
    }
    // Never pop the panel open uninvited. The explanation is waiting when the
    // customer opens the launcher; an inline embed shows it in place.
    if (!state.inline && panel && state.open) panel.hidden = false;

    if (state.open || state.inline) {
      announce(copy.title + ". " + copy.body);
    }
    if (
      wasOpen &&
      state.open &&
      fallbackRetry &&
      typeof fallbackRetry.focus === "function"
    ) {
      fallbackRetry.focus();
    }
    notifyStateChange();
  }

  function hideFallback() {
    if (fallback) fallback.hidden = true;
    if (frame) {
      frame.hidden = false;
      frame.style.display = "";
    }
    state.degraded = null;
  }

  function startHandshakeTimer() {
    if (handshakeTimer) window.clearTimeout(handshakeTimer);
    if (state.ready || state.destroyed) return;
    handshakeTimer = window.setTimeout(function () {
      handshakeTimer = 0;
      if (state.ready || state.destroyed) return;
      showFallback(navigator.onLine === false ? "offline" : "unreachable");
    }, 12000);
  }

  function retryWidgetFrame() {
    if (!frame || state.destroyed) return;
    hideFallback();
    frame.src = buildFrameUrl(state.panel);
    startHandshakeTimer();
  }

  function onBrowserOnline() {
    if (state.degraded === "offline" || state.degraded === "unreachable") {
      retryWidgetFrame();
      return;
    }
    retryWidgetFrame();
  }

  function onBrowserOffline() {
    showFallback("offline");
  }

  function createSvgIcon() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.41 5.956-2.738 7.326");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  function renderLauncher() {
    var label = labelText();
    var unread = unreadText(state.unread);
    if (button) {
      button.setAttribute(
        "aria-label",
        unread === "" ? label : label + ", " + unread,
      );
      button.setAttribute("title", unread === "" ? label : label + ", " + unread);
    }
    if (labelNode) labelNode.textContent = label;
    if (customTrigger) {
      customTrigger.setAttribute("data-herald-unread", String(state.unread));
      customTrigger.setAttribute("data-herald-online", state.online ? "true" : "false");
    }
    if (panel) panel.setAttribute("aria-label", label);
    if (frame) frame.title = label;
  }

  function setExpanded(expanded) {
    if (button) button.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (customTrigger) {
      customTrigger.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
  }

  function rootClassName() {
    return state.inline
      ? "herald-root herald-embedded herald-theme-" + (state.theme || "auto")
      : "herald-root herald-position-" +
          position +
          " herald-theme-" +
          (state.theme || "auto");
  }

  function applyRootClass() {
    if (root) root.className = rootClassName();
  }

  function openWidget(panelPath) {
    if (state.destroyed) return;
    if (state.inline) {
      if (typeof panelPath === "string") applyPanel(panelPath, true);
      return;
    }
    if (!panel || !frame) return;

    if (typeof panelPath === "string") {
      var normalized = normalizePanel(panelPath);
      state.panel = normalized;
      frame.src = buildFrameUrl(normalized);
    }

    panel.hidden = false;
    state.open = true;
    host.setAttribute("data-herald-open", "true");
    setExpanded(true);
    if (state.degraded) {
      var degradedNode = ensureFallback();
      degradedNode.hidden = false;
      if (fallbackRetry) fallbackRetry.focus();
    } else {
      requestUnreadRefresh();
      frame.focus();
    }
    emit("open", api.getState());
    notifyStateChange();
  }

  function closeWidget() {
    // An inline embed is part of the page, not a dismissible dialog.
    if (state.destroyed || state.inline || !panel) return;
    panel.hidden = true;
    if (state.degraded && fallback) fallback.hidden = true;
    state.open = false;
    host.removeAttribute("data-herald-open");
    setExpanded(false);
    var target = customTrigger || button;
    if (target && typeof target.focus === "function") target.focus();
    emit("close", api.getState());
    notifyStateChange();
  }

  function toggleWidget(panelPath) {
    if (state.inline) return;
    if (state.open) closeWidget();
    else openWidget(panelPath);
  }

  function sendIdentify(token, resolve, reject) {
    if (!frame || !frame.contentWindow || !state.ready) {
      identifyQueue.push([token, resolve, reject]);
      return;
    }

    var requestId =
      "herald-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 9);

    var timer = window.setTimeout(function () {
      if (!pendingIdentify[requestId]) return;
      delete pendingIdentify[requestId];
      recordIdentityError("The identity handshake timed out.");
      reject(new Error("The identity handshake timed out."));
    }, 20000);

    pendingIdentify[requestId] = {
      resolve: resolve,
      reject: reject,
      timer: timer,
    };

    frame.contentWindow.postMessage(
      {
        source: "herald-widget-host",
        type: "identify",
        token: token,
        requestId: requestId,
      },
      origin,
    );
  }

  function sendLogout(resolve, reject) {
    if (!frame || !frame.contentWindow || !state.ready) {
      logoutQueue.push([resolve, reject]);
      return;
    }

    var requestId =
      "herald-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 9);

    var timer = window.setTimeout(function () {
      if (!pendingLogout[requestId]) return;
      delete pendingLogout[requestId];
      reportError("logout", "The sign-out handshake timed out.");
      reject(new Error("The sign-out handshake timed out."));
    }, 20000);

    pendingLogout[requestId] = {
      resolve: resolve,
      reject: reject,
      timer: timer,
    };

    frame.contentWindow.postMessage(
      {
        source: "herald-widget-host",
        type: "logout",
        requestId: requestId,
      },
      origin,
    );
  }

  function flushQueues() {
    if (!state.ready) return;

    var queuedIdentify = identifyQueue.slice();
    identifyQueue.length = 0;
    for (var index = 0; index < queuedIdentify.length; index += 1) {
      sendIdentify(
        queuedIdentify[index][0],
        queuedIdentify[index][1],
        queuedIdentify[index][2],
      );
    }

    var queuedLogout = logoutQueue.slice();
    logoutQueue.length = 0;
    for (var logoutIndex = 0; logoutIndex < queuedLogout.length; logoutIndex += 1) {
      sendLogout(queuedLogout[logoutIndex][0], queuedLogout[logoutIndex][1]);
    }
  }

  function experienceUrl(value) {
    return typeof value === "string" && /^(https?:\/\/|\/)/.test(value)
      ? value
      : null;
  }

  function recordEvent(name) {
    if (typeof name !== "string") return;
    name = name.trim();
    if (!/^[a-z0-9][a-z0-9_.:-]{0,63}$/i.test(name) || state.events[name]) return;
    state.events[name] = true;
    if (experienceItems.length > 0) renderExperiences(experienceItems);
  }

  /** Delegated click trigger: any host element may carry data-herald-event. */
  function onDocumentClick(event) {
    var target = event.target;
    while (target && target !== document) {
      if (target.getAttribute) {
        var name = target.getAttribute("data-herald-event");
        if (name) {
          recordEvent(name);
          return;
        }
      }
      target = target.parentNode;
    }
  }

  function rulesMatch(rules) {
    rules = Array.isArray(rules) ? rules : [];
    for (var index = 0; index < rules.length; index += 1) {
      var rule = rules[index];
      if (!rule || rule.type === "attribute") continue;
      if (rule.type === "event") {
        if (!state.events[rule.value]) return false;
      } else if (rule.type === "page_url") {
        if (
          rule.operator === "equals"
            ? window.location.href !== rule.value
            : window.location.href.indexOf(rule.value) === -1
        ) {
          return false;
        }
      } else if (rule.type === "time_on_page") {
        if ((Date.now() - state.startedAt) / 1000 < Number(rule.value || 0)) {
          return false;
        }
      } else if (rule.type === "selector") {
        try {
          if (!document.querySelector(rule.value)) return false;
        } catch (error) {
          return false;
        }
      }
    }
    return true;
  }

  function experienceRuleMatches(item) {
    return rulesMatch(item && item.audience);
  }

  function experienceDismissed(id, days) {
    try {
      var at = Number(window.localStorage.getItem("herald-exp-" + id));
      return Boolean(at) && Date.now() - at < Number(days || 0) * 86400000;
    } catch (error) {
      return false;
    }
  }

  function copyForExperience(item) {
    var content = item.content || {};
    return (
      content[state.locale || "en"] ||
      content[item.defaultLocale] ||
      content.en ||
      content[Object.keys(content)[0]] ||
      null
    );
  }

  /**
   * A survey prompt or experience carries the path that counts one rendered
   * view. Report it only once the banner or tour is actually on screen, through
   * the iframe, so the write is same-origin and a page/event rule that filtered
   * it out never spends an allowance or frequency slot. Once per mount.
   */
  function noteImpression(item) {
    var path = item && (item.impressionPath || item.viewPath);
    if (!path || impressionsSent[item.id]) return;
    impressionsSent[item.id] = true;
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage(
        {
          source: "herald-widget-host",
          type: "track",
          path: path,
        },
        origin,
      );
    }
  }

  function dismissExperience(id, days, completed) {
    try {
      window.localStorage.setItem("herald-exp-" + id, String(Date.now()));
    } catch (error) {
      // Dismissal still hides the experience for this mount.
    }
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage(
        {
          source: "herald-widget-host",
          type: completed ? "experience-completed" : "experience-dismissed",
          id: id,
        },
        origin,
      );
    }
    renderExperiences(experienceItems);
  }

  function renderBanner(item, copy) {
    var card = document.createElement("div");
    card.className = "herald-experience herald-experience-banner";
    card.setAttribute("role", "status");

    var title = document.createElement("strong");
    title.textContent = copy.title;
    card.appendChild(title);

    var body = document.createElement("p");
    body.textContent = copy.body;
    card.appendChild(body);

    var actions = document.createElement("div");
    actions.className = "herald-experience-actions";
    var ctaPanel = normalizePanel(copy.ctaPanel);
    var cta = experienceUrl(copy.ctaUrl);
    if (ctaPanel && copy.ctaLabel) {
      // A proactive banner can open a widget panel directly instead of
      // sending the customer to a separate page. This is the trigger surface
      // `ctaPanel` documents; `ctaUrl` remains the outbound alternative.
      var panelButton = document.createElement("button");
      panelButton.type = "button";
      panelButton.textContent = copy.ctaLabel;
      panelButton.className = "herald-experience-cta";
      panelButton.addEventListener("click", function () {
        dismissExperience(item.id, item.dismissDays, true);
        openWidget(ctaPanel);
      });
      actions.appendChild(panelButton);
    } else if (cta && copy.ctaLabel) {
      var link = document.createElement("a");
      // A survey prompt carries a Herald path, not a host-page path.
      link.href =
        item.impressionPath && cta.charAt(0) === "/" ? origin + cta : cta;
      link.textContent = copy.ctaLabel;
      link.className = "herald-experience-cta";
      actions.appendChild(link);
    }
    var close = document.createElement("button");
    close.type = "button";
    close.className = "herald-experience-dismiss";
    close.textContent = "Dismiss";
    close.addEventListener("click", function () {
      dismissExperience(item.id, item.dismissDays);
    });
    actions.appendChild(close);
    card.appendChild(actions);
    return card;
  }

  function renderTour(item, copy, stepIndex) {
    var steps = Array.isArray(copy.steps) ? copy.steps.slice() : [];
    steps = steps.filter(function (step) {
      if (!step) return false;
      if (!rulesMatch(step.audience)) return false;
      if (step.pageUrl && window.location.href.indexOf(step.pageUrl) === -1) return false;
      if (step.selector) {
        try {
          return Boolean(document.querySelector(step.selector));
        } catch (error) {
          return false;
        }
      }
      return true;
    });
    if (steps.length === 0) return null;
    var index = Math.max(0, Math.min(stepIndex || 0, steps.length - 1));
    var step = steps[index];
    if (tourTarget) tourTarget.classList.remove("herald-tour-target");
    tourTarget = null;
    if (step.selector) {
      try {
        tourTarget = document.querySelector(step.selector);
      } catch (error) {
        tourTarget = null;
      }
    }
    if (tourTarget) {
      tourTarget.classList.add("herald-tour-target");
      if (typeof tourTarget.scrollIntoView === "function") {
        tourTarget.scrollIntoView({
          block: "center",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
      }
    }

    var card = document.createElement("div");
    card.className = "herald-experience herald-experience-tour";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", step.title || copy.title);
    var count = document.createElement("span");
    count.className = "herald-experience-count";
    count.textContent = index + 1 + " of " + steps.length;
    card.appendChild(count);
    var title = document.createElement("strong");
    title.textContent = step.title || copy.title;
    card.appendChild(title);
    var body = document.createElement("p");
    body.textContent = step.body || copy.body;
    card.appendChild(body);
    var actions = document.createElement("div");
    actions.className = "herald-experience-actions";
    if (index > 0) {
      var back = document.createElement("button");
      back.type = "button";
      back.className = "herald-experience-dismiss";
      back.textContent = "Back";
      back.addEventListener("click", function () {
        renderExperiences(experienceItems, index - 1);
      });
      actions.appendChild(back);
    }
    var next = document.createElement("button");
    next.type = "button";
    next.className = "herald-experience-cta";
    next.textContent = index === steps.length - 1 ? "Done" : "Next";
    next.addEventListener("click", function () {
      if (index === steps.length - 1) {
        dismissExperience(item.id, item.dismissDays, true);
      } else {
        renderExperiences(experienceItems, index + 1);
      }
    });
    actions.appendChild(next);
    var skip = document.createElement("button");
    skip.type = "button";
    skip.className = "herald-experience-dismiss";
    skip.textContent = "Skip";
    skip.addEventListener("click", function () {
      dismissExperience(item.id, item.dismissDays);
    });
    actions.appendChild(skip);
    card.appendChild(actions);
    return card;
  }

  function renderExperiences(items, requestedStep) {
    if (!root) return;
    experienceItems = Array.isArray(items) ? items : [];
    if (!experienceContainer) {
      experienceContainer = document.createElement("div");
      experienceContainer.className = "herald-experiences";
      root.insertBefore(experienceContainer, root.firstChild);
    }
    experienceContainer.innerHTML = "";
    if (tourTarget) {
      tourTarget.classList.remove("herald-tour-target");
      tourTarget = null;
    }

    var visible = experienceItems.filter(function (item) {
      return item && !experienceDismissed(item.id, item.dismissDays) && experienceRuleMatches(item);
    });
    var tour = null;
    var banner = null;
    for (var index = 0; index < visible.length; index += 1) {
      var copy = copyForExperience(visible[index]);
      if (!copy) continue;
      if (!tour && visible[index].kind === "tour") tour = { item: visible[index], copy: copy };
      if (!banner && visible[index].kind === "banner") banner = { item: visible[index], copy: copy };
    }
    if (tour) {
      var node = renderTour(tour.item, tour.copy, requestedStep || 0);
      if (node) {
        experienceContainer.appendChild(node);
        noteImpression(tour.item);
      }
    } else if (banner) {
      experienceContainer.appendChild(renderBanner(banner.item, banner.copy));
      noteImpression(banner.item);
    }
  }

  function onWindowMessage(event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || data.source !== "herald-widget") return;

    if (data.type === "state") {
      var wasReady = state.ready;
      if (handshakeTimer) {
        window.clearTimeout(handshakeTimer);
        handshakeTimer = 0;
      }
      if (state.degraded) hideFallback();
      var nextUnread =
        typeof data.unread === "number" && isFinite(data.unread)
          ? Math.max(0, Math.trunc(data.unread))
          : 0;
      var nextOnline = Boolean(data.presence && data.presence.online);
      var nextIdentified = data.identified === true;
      var changedUnread = state.unread !== nextUnread;
      var changedPresence = state.online !== nextOnline;
      var stateIdentityChanged = state.identified !== nextIdentified;

      var nextAccent = readAccent(data.accent);
      var nextAccentFg = readAccent(data.accentFg);
      if (nextAccent) state.accent = nextAccent;
      if (nextAccentFg) state.accentFg = nextAccentFg;

      state.ready = true;
      state.unread = nextUnread;
      state.online = nextOnline;
      state.identified = nextIdentified;
      if (nextIdentified) state.identityError = null;

      // A per-origin override resolved by the embed route. The snippet still
      // wins because the frame only receives the host origin, not whether the
      // host passed `data-theme`.
      var statePosition = readPositionOverride(data.position);
      if (statePosition && statePosition !== position && !state.inline) {
        position = statePosition;
        applyRootClass();
      }
      var stateTheme = readTheme(data.theme);
      if (stateTheme && stateTheme !== state.theme) {
        state.theme = stateTheme;
        applyRootClass();
      }

      applyAccent();
      renderLauncher();
      if (!wasReady) {
        announce(
          state.locale === "es"
            ? "Widget listo. " + state.unread + " sin leer"
            : "Widget ready. " + state.unread + " unread",
        );
        emit("ready", api.getState());
      }
      if (stateIdentityChanged) emit("identify", api.getState());
      if (changedPresence) emit("presence", state.online);
      if (changedUnread) {
        announce(
          state.locale === "es"
            ? state.unread === 0
              ? "No hay notificaciones sin leer"
              : state.unread + " sin leer"
            : state.unread === 0
              ? "No unread notifications"
              : state.unread + " unread notifications",
        );
        emit("unread", state.unread);
      }
      notifyStateChange();
      flushQueues();
      sendMode();
      return;
    }

    if (data.type === "route") {
      // Client-side route changes inside the iframe are not visible to the
      // host page, so the frame reports its current panel. This is what keeps
      // an inline embed's host URL shareable and reload-safe.
      var routePath = normalizePanel(
        typeof data.path === "string" ? data.path : "",
      );
      var routeChanged = state.panel !== routePath;
      state.panel = routePath;
      if (state.inline) writePanelToUrl(routePath);
      if (routeChanged) notifyStateChange();
      return;
    }

    if (data.type === "experiences") {
      renderExperiences(data.items);
      return;
    }

    if (data.type === "close") {
      closeWidget();
      return;
    }

    if (data.type === "degraded") {
      // The frame loaded but cannot use its session (third-party cookies are
      // blocked). A message is more useful than a blank panel.
      showFallback(data.reason === "cookies" ? "cookies" : "unreachable");
      return;
    }

    if (data.type === "identify") {
      var pending = pendingIdentify[data.requestId];
      if (!pending) return;
      delete pendingIdentify[data.requestId];
      window.clearTimeout(pending.timer);

      if (data.ok === true) {
        var identityChanged = !state.identified;
        state.identified = true;
        state.identityError = null;
        if (identityChanged) emit("identify", api.getState());
        notifyStateChange();
        pending.resolve(api.getState());
      } else {
        var message =
          typeof data.error === "string"
            ? data.error
            : "The identity token was rejected.";
        recordIdentityError(message);
        pending.reject(new Error(message));
      }
      return;
    }

    if (data.type === "logout") {
      var pendingLogoutRequest = pendingLogout[data.requestId];
      if (!pendingLogoutRequest) return;
      delete pendingLogout[data.requestId];
      window.clearTimeout(pendingLogoutRequest.timer);

      if (data.ok === true) {
        var wasIdentified = state.identified;
        state.identified = false;
        state.unread = 0;
        state.identityError = null;
        renderLauncher();
        if (wasIdentified) emit("identify", api.getState());
        notifyStateChange();
        pendingLogoutRequest.resolve(api.getState());
      } else {
        var logoutMessage =
          typeof data.error === "string"
            ? data.error
            : "Could not sign out.";
        reportError("logout", logoutMessage);
        pendingLogoutRequest.reject(new Error(logoutMessage));
      }
    }
  }

  function onDocumentKeyDown(event) {
    if (event.key === "Escape" && state.open && !state.inline) closeWidget();
  }

  /**
   * Keep keyboard focus inside the open panel. Focus anywhere inside the
   * shadow root is retargeted to the host element, so anything else means the
   * user tabbed onto the page behind the panel; pull focus back to the frame.
   * Closing clears `state.open` first, so this never fights Escape, the close
   * button or the click-outside handler.
   */
  function onDocumentFocusIn(event) {
    if (!state.open || state.inline || !host || !frame) return;
    var node = event.target;
    if (
      node === host ||
      node === document.body ||
      node === document.documentElement
    ) {
      return;
    }
    frame.focus();
  }

  function onDocumentPointerDown(event) {
    if (!state.open || state.inline || !host) return;
    if (event.target === host || host.contains(event.target)) return;
    if (customTrigger && customTrigger.contains(event.target)) return;
    closeWidget();
  }

  function mount() {
    if (state.destroyed || state.mounted) return;
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
      return;
    }
    if (state.inline) mountInline();
    else mountFloating();
  }

  function addMountListeners() {
    window.addEventListener("message", onWindowMessage);
    document.addEventListener("keydown", onDocumentKeyDown);
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("focusin", onDocumentFocusIn);
    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("online", onBrowserOnline);
    window.addEventListener("offline", onBrowserOffline);
  }

  function flushPendingTasks() {
    var tasks = pendingTasks.slice();
    pendingTasks.length = 0;
    for (var index = 0; index < tasks.length; index += 1) tasks[index]();
  }

  function mountFloating() {
    host = document.createElement("div");
    host.setAttribute("data-herald-widget-host", "");
    shadow = host.attachShadow({ mode: "open" });

    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = stylesheet;
    if (scriptNonce) link.setAttribute("nonce", scriptNonce);
    shadow.appendChild(link);

    root = document.createElement("div");
    root.className =
      "herald-root herald-position-" +
      position +
      " herald-theme-" +
      (state.theme || "auto");
    shadow.appendChild(root);
    applyAccent();

    panel = document.createElement("div");
    panel.className = "herald-panel";
    panel.id = "herald-widget-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");

    frame = document.createElement("iframe");
    frame.className = "herald-frame";
    frame.src = buildFrameUrl(state.panel);
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    frame.setAttribute("allow", "display-capture");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("loading", "eager");
    panel.appendChild(frame);
    root.appendChild(panel);
    root.appendChild(ensureFallback());

    createLiveRegion();
    shadow.appendChild(liveRegion);

    customTrigger = triggerSelector
      ? document.querySelector(triggerSelector)
      : null;

    if (customTrigger && !customTrigger.isConnected) {
      // A selector for a node that is not in the DOM yet is almost always a
      // typo; fall back to the built-in launcher rather than silently hiding it.
      customTrigger = null;
    }

    if (customTrigger) {
      customTrigger.setAttribute("aria-haspopup", "dialog");
      customTrigger.setAttribute("aria-expanded", "false");
      triggerHandler = function (event) {
        event.preventDefault();
        toggleWidget();
      };
      customTrigger.addEventListener("click", triggerHandler);
    } else {
      button = document.createElement("button");
      button.type = "button";
      button.className = "herald-launcher";
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "herald-widget-panel");
      button.setAttribute("aria-expanded", "false");
      button.appendChild(createSvgIcon());

      labelNode = document.createElement("span");
      labelNode.className = "herald-launcher-label";
      button.appendChild(labelNode);

      dot = document.createElement("span");
      dot.className = "herald-launcher-dot";
      dot.setAttribute("aria-hidden", "true");
      button.appendChild(dot);

      button.addEventListener("click", function () {
        toggleWidget();
      });
      root.appendChild(button);
    }

    renderLauncher();
    document.body.appendChild(host);
    state.mounted = true;
    addMountListeners();
    if (navigator.onLine === false) showFallback("offline");
    else startHandshakeTimer();
    flushPendingTasks();
  }

  function resolveInlineTarget(target) {
    if (typeof target === "string" && target.trim() !== "") {
      try {
        return document.querySelector(target);
      } catch {
        return null;
      }
    }
    return target && target.nodeType === 1 ? target : null;
  }

  function rejectPendingRequests(message) {
    var identifyKeys = Object.keys(pendingIdentify);
    for (var index = 0; index < identifyKeys.length; index += 1) {
      var identifyRequest = pendingIdentify[identifyKeys[index]];
      if (!identifyRequest) continue;
      window.clearTimeout(identifyRequest.timer);
      identifyRequest.reject(new Error(message));
      delete pendingIdentify[identifyKeys[index]];
    }

    var logoutKeys = Object.keys(pendingLogout);
    for (var logoutIndex = 0; logoutIndex < logoutKeys.length; logoutIndex += 1) {
      var logoutRequest = pendingLogout[logoutKeys[logoutIndex]];
      if (!logoutRequest) continue;
      window.clearTimeout(logoutRequest.timer);
      logoutRequest.reject(new Error(message));
      delete pendingLogout[logoutKeys[logoutIndex]];
    }
  }

  /** Remove the current host and listeners without ending the SDK instance. */
  function teardownMount() {
    window.removeEventListener("message", onWindowMessage);
    document.removeEventListener("keydown", onDocumentKeyDown);
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    document.removeEventListener("focusin", onDocumentFocusIn);
    document.removeEventListener("click", onDocumentClick, true);
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("online", onBrowserOnline);
    window.removeEventListener("offline", onBrowserOffline);
    if (handshakeTimer) {
      window.clearTimeout(handshakeTimer);
      handshakeTimer = 0;
    }

    if (customTrigger && triggerHandler) {
      customTrigger.removeEventListener("click", triggerHandler);
    }
    triggerHandler = null;

    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    shadow = null;
    root = null;
    button = null;
    panel = null;
    frame = null;
    experienceContainer = null;
    experienceItems = [];
    if (tourTarget) {
      tourTarget.classList.remove("herald-tour-target");
      tourTarget = null;
    }
    labelNode = null;
    dot = null;
    customTrigger = null;
    liveRegion = null;
    fallback = null;
    fallbackTitle = null;
    fallbackBody = null;
    fallbackLink = null;
    fallbackRetry = null;

    state.mounted = false;
    state.ready = false;
    state.open = false;
    lastStateSignature = "";
    rejectPendingRequests("The widget was rebuilt before the request completed.");
  }

  function mountInline(options) {
    var target = resolveInlineTarget(options.target);
    if (!target) {
      reportError(
        "embed",
        "Inline embed target was not found. Pass a selector or an element that is already in the document.",
      );
      return;
    }

    if (state.mounted) teardownMount();

    state.inline = true;
    state.syncUrl = options.syncUrl !== false;
    state.urlParam = readUrlParam(options.urlParam);

    var nextTheme = readTheme(options.theme);
    if (nextTheme) state.theme = nextTheme;
    var nextLocale = readLocale(options.locale);
    if (nextLocale) state.locale = nextLocale;

    var initialPanel =
      options.panel !== undefined ? normalizePanel(options.panel) : state.panel;
    var panelFromUrl = readPanelFromUrl();
    if (panelFromUrl !== null) initialPanel = panelFromUrl;
    state.panel = initialPanel;

    host = document.createElement("div");
    host.setAttribute("data-herald-widget-host", "");
    host.setAttribute("data-herald-inline", "");
    host.className = "herald-inline-host";
    shadow = host.attachShadow({ mode: "open" });

    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = stylesheet;
    if (scriptNonce) link.setAttribute("nonce", scriptNonce);
    shadow.appendChild(link);

    root = document.createElement("div");
    root.className = rootClassName();
    shadow.appendChild(root);
    applyAccent();

    frame = document.createElement("iframe");
    frame.className = "herald-frame";
    frame.src = buildFrameUrl(state.panel);
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    frame.setAttribute("allow", "display-capture");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("loading", "eager");
    root.appendChild(frame);
    root.appendChild(ensureFallback());

    createLiveRegion();
    shadow.appendChild(liveRegion);

    target.appendChild(host);
    state.mounted = true;
    state.open = true;
    host.setAttribute("data-herald-open", "true");

    addMountListeners();
    renderLauncher();
    writePanelToUrl(state.panel);
    if (navigator.onLine === false) showFallback("offline");
    else startHandshakeTimer();
    notifyStateChange();
    flushPendingTasks();
  }

  var api = {
    version: "v1",
    // The loader/frame handshake revision. A new loader may speak a newer
    // protocol while the frame keeps answering this one; see
    // docs/widget-versioning.md.
    protocol: 1,
    embed: function (targetOrOptions, maybeOptions) {
      if (!targetOrOptions) {
        reportError(
          "embed",
          "embed() needs a target selector or an element.",
        );
        return api;
      }

      var options;
      if (
        typeof targetOrOptions === "string" ||
        (typeof targetOrOptions === "object" &&
          typeof targetOrOptions.nodeType === "number")
      ) {
        options = maybeOptions ? Object.assign({}, maybeOptions) : {};
        options.target = targetOrOptions;
      } else if (typeof targetOrOptions === "object") {
        options = Object.assign({}, targetOrOptions);
      } else {
        reportError(
          "embed",
          "embed() needs a target selector or an element.",
        );
        return api;
      }

      enqueue(function () {
        mountInline(options);
      });
      return api;
    },
    open: function (panelPath) {
      enqueue(function () {
        openWidget(typeof panelPath === "string" ? panelPath : undefined);
      });
      return api;
    },
    close: function () {
      enqueue(closeWidget);
      return api;
    },
    toggle: function (panelPath) {
      enqueue(function () {
        toggleWidget(typeof panelPath === "string" ? panelPath : undefined);
      });
      return api;
    },
    navigate: function (panelPath) {
      enqueue(function () {
        if (typeof panelPath !== "string") return;
        if (state.inline) {
          applyPanel(panelPath, true);
          return;
        }
        var normalized = normalizePanel(panelPath);
        state.panel = normalized;
        if (frame) frame.src = buildFrameUrl(normalized);
        if (state.open) openWidget();
        else notifyStateChange();
      });
      return api;
    },
    identify: function (input) {
      return new Promise(function (resolve, reject) {
        // A signed token is the only identity path. The object form exists so
        // hosts can keep the token inside a user payload, but `user` and
        // `companies` must be claims inside the token, not browser input.
        var token =
          typeof input === "string"
            ? input
            : input && typeof input.token === "string"
              ? input.token
              : input && typeof input.jwt === "string"
                ? input.jwt
                : "";
        token = token.trim();

        if (token === "") {
          var message =
            "Signed identity requires a token. Mint one on your server and pass a string or { token }.";
          recordIdentityError(message);
          reject(new Error(message));
          return;
        }

        enqueue(function () {
          sendIdentify(token, resolve, reject);
        });
      });
    },
    logout: function () {
      return new Promise(function (resolve, reject) {
        enqueue(function () {
          sendLogout(resolve, reject);
        });
      });
    },
    setTheme: function (theme) {
      var next = readTheme(theme);
      if (!next) return api;
      enqueue(function () {
        state.theme = next;
        applyRootClass();
        if (frame) frame.src = buildFrameUrl(state.panel);
        notifyStateChange();
      });
      return api;
    },
    setLocale: function (locale) {
      var next = readLocale(locale);
      if (!next) return api;
      enqueue(function () {
        state.locale = next;
        renderLauncher();
        if (frame) frame.src = buildFrameUrl(state.panel);
        notifyStateChange();
      });
      return api;
    },
    on: function (name, handler) {
      if (listeners[name] && typeof handler === "function") {
        listeners[name].push(handler);
      }
      return api;
    },
    off: function (name, handler) {
      if (!listeners[name]) return api;
      listeners[name] = listeners[name].filter(function (entry) {
        return entry !== handler;
      });
      return api;
    },
    /** Fire a product event; page/event-targeted banners and surveys react. */
    track: function (name) {
      recordEvent(name);
      return api;
    },
    getState: function () {
      return {
        open: state.open,
        ready: state.ready,
        mode: state.inline ? "inline" : "floating",
        panel: state.panel,
        unread: state.unread,
        online: state.online,
        identified: state.identified,
        identityError: state.identityError,
        degraded: state.degraded,
        theme: state.theme,
        locale: state.locale,
      };
    },
    destroy: function () {
      if (state.destroyed) return;
      state.destroyed = true;
      if (customTrigger) {
        customTrigger.removeAttribute("aria-haspopup");
        customTrigger.removeAttribute("aria-expanded");
        customTrigger.removeAttribute("data-herald-unread");
        customTrigger.removeAttribute("data-herald-online");
      }
      teardownMount();
      if (window.HeraldWidget === api) delete window.HeraldWidget;
    },
  };

  window.HeraldWidget = api;
  mount();
})();
