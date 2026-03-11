// assistant-widget.js
(function () {
  const API_BASE = (window.AIW_CONFIG && window.AIW_CONFIG.API_BASE_URL)
  ? window.AIW_CONFIG.API_BASE_URL
  : "https://ai-waiter-0b4e.onrender.com"; // fallback РґР»СЏ Р»РѕРєР°Р»РєРё
  const ASSETS_BASE = (window.AIW_CONFIG && window.AIW_CONFIG.ASSETS_BASE_URL)
    ? String(window.AIW_CONFIG.ASSETS_BASE_URL).replace(/\/$/, "")
    : window.location.origin;
  let sessionToken = null;

  const USER_LOCALE =
    (navigator.language && navigator.language.split("-")[0]) || "en";

  const WELCOME_LS_KEY = "aiw_welcome_shown_v1";

  // Welcome 2 should be shown only once per browser tab session
  const WELCOME2_SS_KEY = "aiw_welcome2_shown_v1";
  const UI_TEXTS_LS_KEY_PREFIX = "aiw_ui_texts_v1_";

  // Fallback EN texts (will be replaced by backend /chat/ui-texts based on browser language)
  let UI_TEXTS = {
    input_placeholder: "Message...¦",
    mini_subtotal: "Subtotal",
    cart_title: "Cart",
    cart_close_aria: "Close",
    cart_remove: "Remove",
    cart_submit: "Send to kitchen",
    quick_bill_title: "Ask for the bill?",
    quick_waiter_title: "Call a waiter?",
    quick_confirm_label: "I confirm sending",
    quick_send: "Send",
    quick_cancel: "Cancel",
    qty_unit_short: "pcs.",
    mini_cart_empty: "Cart is empty",
  };
  async function loadUiTextsOnce() {
    try {
      const lang = USER_LOCALE || "en";
      const lsKey = UI_TEXTS_LS_KEY_PREFIX + lang;

      // localStorage cache (fast boot + no extra request)
      const cached = localStorage.getItem(lsKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === "object")
          UI_TEXTS = { ...UI_TEXTS, ...parsed };
        return;
      }

      const qs = new URLSearchParams({ client_language: lang });
      const res = await fetch(`${API_BASE}/chat/ui-texts?${qs.toString()}`, {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) return;

      const data = await res.json();
      const texts =
        data && data.texts && typeof data.texts === "object"
          ? data.texts
          : null;
      if (texts) {
        UI_TEXTS = { ...UI_TEXTS, ...texts };
        localStorage.setItem(lsKey, JSON.stringify(texts));
      }
    } catch (e) {
      // ignore - fallback to EN defaults
    }
  }

  async function showWelcomeOnce() {
    try {
      if (localStorage.getItem(WELCOME_LS_KEY) === "1") return;

      const qs = new URLSearchParams({ client_language: USER_LOCALE });
      const res = await fetch(`${API_BASE}/chat/welcome?${qs.toString()}`, {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) {
        appendWelcomeMessage(
          "Hi! I’m your AI waiter. Ask me about the menu, or tell me what you’d like to order.",
        );
        localStorage.setItem(WELCOME_LS_KEY, "1");
        return;
      }

      const data = await res.json();
      const text =
        (data && typeof data.text === "string" && data.text.trim()) ||
        "Hi! I’m your AI waiter. Ask me about the menu, or tell me what you’d like to order.";

      appendWelcomeMessage(text);
      localStorage.setItem(WELCOME_LS_KEY, "1");
    } catch (e) {
      console.warn("[welcome] failed:", e);
      appendWelcomeMessage(
        "Hi! I’m your AI waiter. Ask me about the menu, or tell me what you’d like to order.",
      );
      localStorage.setItem(WELCOME_LS_KEY, "1");
    }
  }

  async function showGreetingEveryOpen() {
    try {
      const daypart = getLocalDaypart();
      const qs = new URLSearchParams({
        client_language: USER_LOCALE,
        daypart,
      });

      const res = await fetch(`${API_BASE}/chat/greeting?${qs.toString()}`, {
        method: "GET",
        credentials: "include",
      });

      // fallback EN
      let fallbackEn =
        daypart === "morning"
          ? "Good morning! How can I help you today?"
          : daypart === "evening"
            ? "Good evening! How can I help you today?"
            : "Good afternoon! How can I help you today?";

      if (!res.ok) {
        appendWelcomeMessage(fallbackEn);
        return;
      }

      const data = await res.json();
      const text =
        (data && typeof data.text === "string" && data.text.trim()) ||
        fallbackEn;

      // РњРѕР¶РЅРѕ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ С‚РѕС‚ Р¶Рµ СЂРµРЅРґРµСЂРµСЂ, С‡С‚Рѕ Рё Welcome 1 вЂ” С‡С‚РѕР±С‹ СЃС‚РёР»СЊ Р±С‹Р» РѕРґРёРЅР°РєРѕРІС‹Р№
      appendWelcomeMessage(text);
    } catch (e) {
      console.warn("[greeting] failed:", e);
      const daypart = getLocalDaypart();
      const fallbackEn =
        daypart === "morning"
          ? "Good morning! How can I help you today?"
          : daypart === "evening"
            ? "Good evening! How can I help you today?"
            : "Good afternoon! How can I help you today?";
      appendWelcomeMessage(fallbackEn);
    }
  }

  function getLocalDaypart() {
    const h = new Date().getHours(); // Р»РѕРєР°Р»СЊРЅРѕРµ РІСЂРµРјСЏ СѓСЃС‚СЂРѕР№СЃС‚РІР°
    if (h >= 5 && h < 12) return "morning";
    if (h >= 12 && h < 18) return "day";
    return "evening";
  }

  let lastOrderDraft = null;
  let lastOrderDraftEl = null;
  const imageUrlByCode = new Map();

  function normalizeImageUrl(raw) {
    const v = String(raw || "").trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (/^data:/i.test(v) || /^blob:/i.test(v)) return v;
    if (v.startsWith("/")) return `${ASSETS_BASE}${v}`;
    if (v.startsWith("img/")) return `${ASSETS_BASE}/${v}`;
    if (/^[\w.-]+\.(webp|png|jpe?g|gif|svg)$/i.test(v)) {
      return `${ASSETS_BASE}/img/${v}`;
    }
    return `${ASSETS_BASE}/${v}`;
  }

  function getItemCode(obj) {
    if (!obj) return "";
    return String(obj.code || obj.item_code || "").trim();
  }

  function pickImageUrl(obj) {
    if (!obj) return "";
    const raw =
      obj.imageUrl ||
      obj.image_url ||
      obj.photo_url ||
      obj.photoUrl ||
      obj.image ||
      obj.img ||
      "";

    const normalized = normalizeImageUrl(raw);
    if (normalized) return normalized;

    const byCode = imageUrlByCode.get(getItemCode(obj).toUpperCase());
    return byCode || "";
  }

  function rememberImagesFromList(list) {
    if (!Array.isArray(list)) return;
    for (const it of list) {
      const code = getItemCode(it);
      const url = pickImageUrl(it);
      if (code && url) imageUrlByCode.set(code.toUpperCase(), url);
    }
  }

  function normalizeOrderDraftImages(draft) {
    if (!draft || !Array.isArray(draft.items)) return draft;
    draft.items = draft.items.map((it) => {
      const url = pickImageUrl(it);
      const code = getItemCode(it);
      if (url && code) imageUrlByCode.set(code.toUpperCase(), url);
      return url && !it.imageUrl ? { ...it, imageUrl: url } : it;
    });
    return draft;
  }

  // Preserve imageUrl when backend returns order drafts without media fields.
  function mergeOrderDraftPreservingMedia(prevDraft, nextDraft) {
    if (!nextDraft || !Array.isArray(nextDraft.items)) return nextDraft;
    if (!prevDraft || !Array.isArray(prevDraft.items)) return nextDraft;

    const prevByKey = new Map();
    for (const it of prevDraft.items) {
      const key = String(
        it?.id || it?.order_item_id || it?.code || it?.item_code || "",
      );
      if (!key) continue;
      prevByKey.set(key, it);
    }

    const mergedItems = nextDraft.items.map((it) => {
      const key = String(
        it?.id || it?.order_item_id || it?.code || it?.item_code || "",
      );
      const prev = key ? prevByKey.get(key) : null;
      const nextUrl = pickImageUrl(it);
      const prevUrl = prev ? pickImageUrl(prev) : "";

      if (!nextUrl && prevUrl) {
        return { ...it, imageUrl: prevUrl };
      }
      return it;
    });

    return { ...nextDraft, items: mergedItems };
  }

  // --- Voice state ---
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;

  // Р‘С‹Р» Р»Рё РїРѕСЃР»РµРґРЅСЏСЏ С„СЂР°Р·Р° РѕС‚РїСЂР°РІР»РµРЅР° РёР· РіРѕР»РѕСЃР° (РґР»СЏ TTS)
  let lastRequestFromVoice = false;

  // --- WebSocket РґР»СЏ СЃС‚СЂРёРјРёРЅРіР° РіРѕР»РѕСЃР° ---
  let voiceWs = null;
  let voiceWsReady = false;
  let voiceWsOnTranscript = null;

  // ---------- РџР°СЂСЃРёРј С‚РѕРєРµРЅ РёР· URL (QR-СЂРµР¶РёРј) ----------

  function getQrTokenFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      // РїРѕРґРґРµСЂР¶РёРІР°РµРј Рё ?qr_token=..., Рё ?token=...
      return params.get("qr_token") || params.get("token");
    } catch (e) {
      console.warn("Cannot parse URLSearchParams", e);
      return null;
    }
  }

  // ---------- UI: helper РґР»СЏ СЃРѕРѕР±С‰РµРЅРёР№ ----------

  let messagesEl = null;

  let miniCartEl = null;

  // --- Cart overlay (cart-first editing) ---
  let cartOverlayEl = null;
  let cartOverlayListEl = null;
  let cartOverlaySubmitBtn = null;
  let cartOverlayTitleTotalEl = null;

  let openCartOverlay = null;
  let closeCartOverlay = null;
  let renderCartOverlay = null;

  function appendMessage(text, type) {
    if (!messagesEl) return;
    const div = document.createElement("div");
    div.className = `aiw-msg aiw-msg-${type}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendUserMessage(text) {
    appendMessage(text, "user");
  }

  function appendBotMessage(text) {
    appendMessage(text, "bot");
  }

  function appendSystemMessage(text) {
    appendMessage(text, "system");
  }

  function uiText(key, fallback) {
    const v = UI_TEXTS && UI_TEXTS[key];
    return typeof v === "string" && v.trim() ? v : fallback;
  }

  function formatTpl(tpl, params) {
    return String(tpl).replace(/\{(\w+)\}/g, (_, k) =>
      params && params[k] != null ? String(params[k]) : "",
    );
  }

  function appendWelcomeMessage(text) {
    if (!messagesEl) return;

    const msg = document.createElement("div");
    msg.className = "aiw-msg aiw-msg-bot aiw-msg-welcome";

    const bubble = document.createElement("div");
    bubble.className = "aiw-msg-bubble aiw-welcome-text";

    bubble.textContent = text;

    msg.appendChild(bubble);
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------- UI: Mini-cart (thumbnails only) ----------
  function computeDraftCounts(orderDraft) {
    const items =
      orderDraft && Array.isArray(orderDraft.items) ? orderDraft.items : [];
    const distinct = items.length;
    const totalQty = items.reduce(
      (sum, it) => sum + (it.quantity != null ? Number(it.quantity) : 1),
      0,
    );
    return { distinct, totalQty };
  }

  function renderMiniCart(orderDraft) {
    if (!miniCartEl) return;

    const hasItems = !!(
      orderDraft &&
      Array.isArray(orderDraft.items) &&
      orderDraft.items.length
    );
    miniCartEl.classList.toggle("aiw-mini-cart--empty", !hasItems);

    const { distinct, totalQty } = hasItems
      ? computeDraftCounts(orderDraft)
      : { distinct: 0, totalQty: 0 };

    // badge
    const badge = miniCartEl.querySelector(".aiw-mini-cart-badge");
    if (badge) {
      badge.textContent = String(distinct);
      badge.style.display = distinct > 0 ? "inline-flex" : "none";
      badge.title =
        totalQty > 0 ? `${totalQty} ${UI_TEXTS.qty_unit_short || "pcs."}` : "";
    }

    // total price (if unitPrice exists)
    const totalEl = miniCartEl.querySelector(".aiw-mini-cart-total");
    if (totalEl) {
      let subtotal = 0;
      let hasAnyPrice = false;
      if (hasItems) {
        for (const it of orderDraft.items) {
          const q = it.quantity != null ? Number(it.quantity) : 1;
          const p = it.unitPrice != null ? Number(it.unitPrice) : NaN;
          if (!Number.isNaN(p) && Number.isFinite(p) && p > 0) {
            subtotal += p * q;
            hasAnyPrice = true;
          }
        }
      }
      if (hasAnyPrice) {
        totalEl.textContent = `${
          UI_TEXTS.mini_subtotal || "Subtotal"
        }: ${formatPrice(subtotal)}`;
        totalEl.style.display = "block";
      } else {
        totalEl.style.display = "none";
      }
  }
  }

  // ---------- Session init only via QR ----------

  async function initSession() {
    const qrToken = getQrTokenFromUrl();

    try {
      if (qrToken) {
        console.log("[AI Waiter] QR token detected in URL:", qrToken);

        const res = await fetch(`${API_BASE}/qr/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qr_token: qrToken }),
          credentials: "include",
        });

        if (!res.ok) {
          console.error("Failed to verify QR token", await res.text());
          appendSystemMessage(
            "Не вдалося підтвердити QR-токен. Можливо, строк дії посилання закінчився. Спробуйте оновити QR-код на столі.",
          );
          return;
        }

        const data = await res.json();
        sessionToken = data.session_token;
        console.log("[AI Waiter] Session started via QR", data);
        appendSystemMessage(
          "Я під'єднався до вашого столика. Можемо робити замовлення.",
        );
      } else {
        console.warn("[AI Waiter] No QR token in URL. Session was not created.");
        appendSystemMessage(
          "Scan the table QR code to start an AI waiter session. Ordering is disabled without QR.",
        );
        return;
      }
    } catch (err) {
      console.error("Error in initSession", err);
      appendSystemMessage("Сталася помилка при підключенні до сервера.");
    }
  }

  // ---------- UI: СЃС‚РёР»Рё ----------

  function createStyles() {
    const style = document.createElement("style");
    style.textContent = `
      :root {
        --aiw-bg-glass: rgba(10, 10, 12, 0.78);
        --aiw-bg-glass-strong: rgba(12, 12, 14, 0.95);
        --aiw-border-subtle: rgba(255, 255, 255, 0.08);
        --aiw-border-strong: rgba(255, 255, 255, 0.14);
        --aiw-text-main: #f9fafb;
        --aiw-text-muted: #9ca3af;
        --aiw-accent: #0ea5e9;
        --aiw-accent-soft: rgba(14, 165, 233, 0.18);
        --aiw-error: #fb7185;
        --aiw-radius-xl: 24px;
        --aiw-radius-full: 999px;
        --aiw-shadow-elevated: 0 18px 45px rgba(0,0,0,0.65);
      }

      #top .image,
#top img.image_css,
#top img {
  pointer-events: none !important;
}

html.aiw-scroll-lock,
body.aiw-scroll-lock{
  overflow: hidden !important;
  height: 100% !important;
  overscroll-behavior: none;
  touch-action: none;
}
body.aiw-scroll-lock{
  position: fixed !important;
  width: 100% !important;
}

.aiw-upsell-trust {
        margin-top: 4px;
        font-size: 12px;
        line-height: 1.25;
        color: var(--aiw-text-sub);
      }

      /* ---------- РџР»Р°РІР°СЋС‰Р°СЏ РєРЅРѕРїРєР°-РІРёРґР¶РµС‚ ---------- */
      /* ---------- РџР»Р°РІР°СЋС‰Р°СЏ РєРЅРѕРїРєР°-РєР°РїР»СЏ (visionOS style) ---------- */
      .aiw-button {
        position: fixed;
        right: 20px;
        bottom: 20px;
        width: 40px;
        height: 40px;
        z-index: 9999;

        border-radius: 50%;
        /* РїРѕС‡С‚Рё РїСЂРѕР·СЂР°С‡РЅР°СЏ РєР°РїР»СЏ */
        background:
          radial-gradient(circle at 30% 0, rgba(255,255,255,0.50), transparent 55%),
          radial-gradient(circle at 50% 80%, rgba(15,23,42,0.55), rgba(15,23,42,0.05) 65%, transparent 80%);
        border: 1px solid rgba(255, 255, 255, 0.40);

        /* РѕР±СЉС‘Рј Рё Р»С‘РіРєР°СЏ С‚РµРЅСЊ РїРѕРґ РєР°РїР»РµР№ */
        box-shadow:
          0 10px 30px rgba(15, 23, 42, 0.85),
          inset 0 1px 0 rgba(255,255,255,0.4);

        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;

        /* Р»С‘РіРєРѕРµ РґСЂРѕР¶Р°РЅРёРµ / РїСѓР»СЊСЃР°С†РёСЏ РєР°РїР»Рё */
        transform-origin: center bottom;
        animation: aiw-dropPulse 2.8s ease-in-out infinite;
      }


      /* =========================
         HEADER LAUNCHER (CIRCLES) вЂ” FINAL
         1 big glass circle over logo + 2 small circles on the right
         ========================= */

      /* Р’РђР–РќРћ: РєРѕРЅС‚РµР№РЅРµСЂ РќР• РїРѕРєСЂС‹РІР°РµС‚ РІРµСЃСЊ С…РµРґРµСЂ (РёРЅР°С‡Рµ Р±Р»РѕРєРёСЂСѓРµС‚ РєР»РёРєРё).
         Р­С‚Рѕ РјР°Р»РµРЅСЊРєР°СЏ вЂњРіСЂСѓРїРїР°вЂќ РІРѕРєСЂСѓРі Р»РѕРіРѕС‚РёРїР°. */
      .aiw-button.aiw-button--header{
        position: absolute;
        left: 50%;
        top: 50%;
        width: 220px;            /* РіСЂСѓРїРїР°: РіР»Р°РІРЅС‹Р№ РєСЂСѓРі + 2 СЃРїСЂР°РІР° */
        height: 150px;
        transform: translate(-50%, -50%);
        z-index: 9999;

        /* РїРѕР»РЅРѕСЃС‚СЊСЋ СѓР±РёСЂР°РµРј РІРёР·СѓР°Р» .aiw-button */
        right: auto;
        bottom: auto;
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        animation: none !important;
        overflow: visible;
      }

      /* Р§С‚РѕР±С‹ РїСЂРё РєР»РёРєРµ РЅРµ РїРѕСЏРІР»СЏР»РёСЃСЊ вЂњРѕРІР°Р»С‹вЂќ Рё scale */
      .aiw-button.aiw-button--header:hover,
      .aiw-button.aiw-button--header:active{
        box-shadow: none !important;
        transform: translate(-50%, -50%) !important;
      }

      .aiw-button.aiw-button--header .aiw-header-wrap{
        position: absolute;
        inset: 0;
      }

      /* BASE GLASS CIRCLE */
      .aiw-button.aiw-button--header .aiw-hc{
        position: absolute;
        border-radius: 50%;
        cursor: pointer;
        pointer-events: auto;

        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);

        background:
          radial-gradient(120% 120% at 30% 25%,
            rgba(255,255,255,.38),
            rgba(255,255,255,.12) 40%,
            rgba(255,255,255,.07) 70%,
            rgba(255,255,255,.05) 100%);
        border: 1px solid rgba(255,255,255,.22);

        box-shadow:
          0 14px 36px rgba(0,0,0,.45),
          inset 0 1px 0 rgba(255,255,255,.25);

        transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
        will-change: transform, box-shadow;
      }

      /* BIG circle: РїРѕР»РЅРѕСЃС‚СЊСЋ РЅР°РєСЂС‹РІР°РµС‚ РєСЂСѓРіР»С‹Р№ Р»РѕРіРѕС‚РёРї */
      .aiw-button.aiw-button--header .aiw-hc--main{
        width: 100px;
        height: 100px;
        left: 60px;              /* С†РµРЅС‚СЂ РіСЂСѓРїРїС‹ */
        top: 50%;
        transform: translateY(-50%);
      }

      .aiw-button.aiw-button--header .aiw-hc--main img{
        position:absolute;
        inset:0;
        margin:auto;
        width: 26px;
        height: 26px;
        opacity: .92;
        filter: drop-shadow(0 6px 14px rgba(0,0,0,.45));
      }

      .aiw-button.aiw-button--header .aiw-hc--main:hover{
        transform: translateY(-50%) scale(1.05);
        border-color: rgba(255,255,255,.30);
        box-shadow:
          0 18px 44px rgba(0,0,0,.55),
          0 0 0 6px rgba(14,165,233,.10),
          inset 0 1px 0 rgba(255,255,255,.30);
      }

      .aiw-button.aiw-button--header.aiw-open .aiw-hc--main{
        border-color: rgba(14,165,233,.45);
        box-shadow:
          0 18px 44px rgba(0,0,0,.55),
          0 0 0 7px rgba(14,165,233,.20),
          0 0 26px rgba(14,165,233,.22),
          inset 0 1px 0 rgba(255,255,255,.28);
      }

      /* 2 РјР°Р»С‹С… СЃРїСЂР°РІР° */
      .aiw-button.aiw-button--header .aiw-hc--side{
        width: 44px;
        height: 44px;
        left: 170px;            /* СЃРїСЂР°РІР° РѕС‚ РіР»Р°РІРЅРѕРіРѕ РєСЂСѓРіР° */
      }

      .aiw-button.aiw-button--header .aiw-hc--waiter{
        top: calc(50% - 28px);
        transform: translateY(-50%);
      }

      .aiw-button.aiw-button--header .aiw-hc--bill{
        top: calc(50% + 28px);
        transform: translateY(-50%);
      }

      .aiw-button.aiw-button--header .aiw-hc--side:hover{
        transform: translateY(-50%) scale(1.06);
        border-color: rgba(255,255,255,.30);
      }

      .aiw-button.aiw-button--header .aiw-hc--side span{
        position:absolute;
        inset:0;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size: 15px;
        filter: drop-shadow(0 6px 14px rgba(0,0,0,.45));
      }

/* ---------- Р§Р°С‚: iOS 18 glass-panel ---------- */
      .aiw-chat {
        position: fixed;
        right: 16px;
        bottom: 84px;
        width: 360px;
        max-height: min(640px, 80vh);
        background: var(--aiw-bg-glass);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        border-radius: var(--aiw-radius-xl);
        border: 1px solid var(--aiw-border-subtle);
        box-shadow: var(--aiw-shadow-elevated);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 9999;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
        color: var(--aiw-text-main);
      }

      /* ---------- Quick Actions panel ---------- */
      .aiw-quick-panel{
        display:none;
        margin: 10px 12px 0 12px;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,.10);
        
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      .aiw-quick-panel.aiw-show{ display:block; }

      .aiw-quick-title{
        font-size: 13px;
        font-weight: 700;
        color: rgba(255,255,255,.92);
        margin-bottom: 8px;
      }

      .aiw-quick-checkbox{
        display:flex;
        gap: 8px;
        align-items:center;
        font-size: 12px;
        color: rgba(255,255,255,.80);
      }

      .aiw-quick-actions{
        display:flex;
        gap: 10px;
        margin-top: 10px;
      }

      .aiw-quick-btn{
        flex:1;
        height: 34px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.06);
        color: rgba(255,255,255,.92);
        cursor: pointer;
      }

      .aiw-quick-btn:hover{ background: rgba(255,255,255,.10); }
      .aiw-quick-btn:disabled{ opacity: .45; cursor: not-allowed; }


      /* ---------- РњРѕР±РёР»СЊРЅС‹Р№ СЂРµР¶РёРј: С‡Р°С‚ РЅР° РІРµСЃСЊ СЌРєСЂР°РЅ ---------- */
      /* ---------- РњРѕР±РёР»СЊРЅС‹Р№ СЂРµР¶РёРј: С‡Р°С‚ РЅР° РІРµСЃСЊ СЌРєСЂР°РЅ ---------- */
@media (max-width: 768px) {
  .aiw-chat{
    position: fixed;
    inset: 0;              /* top/right/bottom/left = 0 */
    width: 100%;
    width: 100vw;
    max-height: 100vh;         /* fallback */
    border-radius: 0;
    border: none;
    box-shadow: none;
    overflow: hidden;      /* С‡С‚РѕР±С‹ РЅРёС‡РµРіРѕ РЅРµ РІС‹Р»РµР·Р°Р»Рѕ */
    overscroll-behavior: contain;
  }

  .aiw-chat,
  .aiw-chat *{
    box-sizing: border-box;
    max-width: 100%;
  }

  .aiw-chat-messages{
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }
}

      /* ---------- РҐРµРґРµСЂ С‡Р°С‚Р° ---------- */
      .aiw-chat-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        font-size: 14px;
        flex-shrink: 0;
        position: relative;
      }

      /* Slot for moving the вЂњdropsвЂќ (aiw-header-wrap) into chat header */
.aiw-chat-header-slot{
  position: relative;
  flex: 1;
  min-height: 280px;   /* same visual scale as on the page */
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;   /* don't clip circles */
}

/* Host inside chat header that reuses the SAME launcher CSS (.aiw-button--header) */
.aiw-chat-launcher-host.aiw-button.aiw-button--header{
  position: relative;
  left: auto;
  top: auto;
  transform: none;
  z-index: auto;
}
.aiw-chat-launcher-host.aiw-button.aiw-button--header:hover,
.aiw-chat-launcher-host.aiw-button.aiw-button--header:active{
  transform: none !important;
}

      .aiw-chat-x{
        width: 34px;
        height: 34px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.06);
        color: rgba(255,255,255,.9);
        cursor: pointer;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .aiw-chat-x:hover{ background: rgba(255,255,255,.10); }

      /* Slightly compact when moved into chat */
      .aiw-chat-header-slot .aiw-header-wrap{
  transform: none !important;
}

      /* ---------- Р—РѕРЅР° СЃРѕРѕР±С‰РµРЅРёР№ ---------- */
      .aiw-chat-messages {
        padding: 10px 12px 12px;
        flex: 1;
        overflow-y: auto;
        font-size: 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        scrollbar-width: thin;
        scrollbar-color: rgba(148, 163, 184, 0.6) transparent;
      }

      .aiw-chat-messages::-webkit-scrollbar {
        width: 4px;
      }
      .aiw-chat-messages::-webkit-scrollbar-track {
        background: transparent;
      }
      .aiw-chat-messages::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.6);
        border-radius: 999px;
      }

      /* ---------- РџСѓР·С‹СЂСЊРєРё СЃРѕРѕР±С‰РµРЅРёР№ (Telegram-like) ---------- */
      .aiw-msg {
        max-width: 88%;

        padding: 0;
      }

      .aiw-msg.aiw-msg-wide {
  max-width: 88%;
  width: 88%;
}

      .aiw-msg-user,
      .aiw-msg-bot {
        padding: 8px 11px;
        border-radius: 18px;
        
        text-align: left;
        white-space: pre-wrap;
        line-height: 1.4;
      }

      .aiw-msg-user {
        align-self: flex-end;
        margin-left: auto;

        /* iOS 18-ish glass bubble, Р±Р»РёР·РєРѕ Рє #888, РЅРѕ С‡СѓС‚СЊ СЃРІРµС‚Р»РµРµ С‡РµРј Сѓ Р±РѕС‚Р° */
        background:
          radial-gradient(140% 180% at 20% 18%,
            rgba(255,255,255,0.22),
            rgba(255,255,255,0.10) 38%,
            rgba(136,136,136,0.26) 100%),
          rgba(136,136,136,0.22);

        
        

        color: rgba(255,255,255,0.93);
        border-radius: 18px 18px 4px 18px;

        
      }

      .aiw-msg-bot {
  align-self: flex-start;

  /* Dark matte glass вЂ” РїРѕС‡С‚Рё Р±РµР· РїРѕРґСЃРІРµС‚РѕРє */
  background:
    radial-gradient(140% 180% at 20% 18%,
      rgba(255,255,255,0.02),
      rgba(255,255,255,0.01) 42%,
      rgba(48,48,48,0.55) 100%),
    rgba(48,48,48,0.50);

  

  color: rgba(255,255,255,0.92);
  border-radius: 18px 18px 18px 4px;

  
}





      .aiw-msg-bot.aiw-msg-upsell {
        
        
      }

      .aiw-msg-system {
        align-self: center;
        background: transparent;
        border: none;
        color: var(--aiw-text-muted);
        font-size: 12px;
        padding: 2px 0;
      }

      /* ---------- Р”СЂР°С„С‚ Р·Р°РєР°Р·Р° (РєР°СЂС‚РѕС‡РєР°) ---------- */
      .aiw-order-draft {
        position: relative;
        padding: 8px 10px 12px;
        border-radius: 18px;
        
        border: 1px solid var(--aiw-border-subtle);
        margin-top: 6px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      }

      /* ---------- Welcome РєР°Рє РєР°СЂС‚РѕС‡РєР° РґСЂР°С„С‚Р° ---------- */
.aiw-welcome-draft {
  /* РЅРёС‡РµРіРѕ СЂР°РґРёРєР°Р»СЊРЅРѕРіРѕ вЂ” РёСЃРїРѕР»СЊР·СѓРµРј С‚Рµ Р¶Рµ СЃС‚РёР»Рё .aiw-order-draft */
  margin-top: 0;            /* welcome РѕР±С‹С‡РЅРѕ РїРµСЂРІС‹Р№ вЂ” Р±РµР· Р»РёС€РЅРµРіРѕ РѕС‚СЃС‚СѓРїР° */
}

.aiw-welcome-text {
  white-space: pre-wrap;
  line-height: 1.4;
  font-size: 14px;
  color: var(--aiw-text-main);
}


      .aiw-order-submit {
        position: absolute;
        right: 10px;
        bottom: 10px;
        border: none;
        border-radius: var(--aiw-radius-full);
        padding: 4px 10px;
        font-size: 13px;
        cursor: pointer;
        background: linear-gradient(135deg, #22c55e, #4ade80);
        color: #000;
        font-weight: 600;
        box-shadow: 0 6px 18px rgba(22,163,74,0.5);
      }

      .aiw-order-submit:hover {
        filter: brightness(1.05);
      }

      .aiw-order-items {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .aiw-order-item {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .aiw-order-item-image {
          width: 50px;
  height: 50px;
  min-width: 50px;
  min-height: 50px;

  border-radius: 14px;
  overflow: hidden;

  flex-shrink: 0;
  border: 1px solid var(--aiw-border-subtle);
      }

      .aiw-order-item-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .aiw-order-item-main {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
      }

      .aiw-order-item-name {
        font-size: 13px;
        color: var(--aiw-text-main);
        font-weight: 500;
        margin-bottom: 2px;
      }

      .aiw-order-item-meta {
        font-size: 12px;
        color: var(--aiw-text-muted);
      }

      /* ---------- + / в€’ РІ РєР°СЂС‚РѕС‡РєРµ РґСЂР°С„С‚Р° ---------- */
      .aiw-order-item-controls {
        display: flex;
        gap: 4px;
        margin-top: 4px;
      }

      .aiw-order-item-btn {
        border: 1px solid var(--aiw-border-subtle);
        border-radius: var(--aiw-radius-full);
        padding: 2px 8px;
        cursor: pointer;
        font-size: 14px;
        background: rgba(15,23,42,0.9);
        color: var(--aiw-text-main);
        min-width: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .aiw-order-item-btn:hover {
        background: rgba(30,64,175,0.5);
      }

      /* ---------- РђРїСЃРµР»: С‚РµРєСЃС‚ + РєР°СЂС‚РѕС‡РєРё С‚РѕРІР°СЂР° РІ РѕРґРЅРѕРј СЃС‚РёР»Рµ СЃ РґСЂР°С„С‚РѕРј ---------- */
      .aiw-msg-upsell {
        margin-top: 4px;
      }

      .aiw-upsell-text {
        margin-bottom: 4px;
        font-size: 13px;
        color: var(--aiw-text-main);
        font-weight: 500;
      }

      .aiw-upsell-items {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .aiw-upsell-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 9px;
        border-radius: 14px;
        
        border: 1px solid var(--aiw-border-subtle);
      }

      .aiw-upsell-item .aiw-order-item-name {
        font-size: 13px;
      }

      .aiw-upsell-item .aiw-order-item-meta {
        font-size: 12px;
      }

      /* ---------- Mini-cart (under header / вЂњdropsвЂќ) ---------- */
.aiw-mini-cart{
  margin: 0 12px 0 12px;
  padding: 10px 10px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,.10);

  
  position: relative;
}

.aiw-mini-cart-track{
  display:flex;
  gap: 8px;
  align-items:center;
  overflow-x: auto;
  padding: 2px 2px;
  scrollbar-width: none;
}
.aiw-mini-cart-track::-webkit-scrollbar{ display:none; }

.aiw-mini-cart-thumb{
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06);
  overflow:hidden;
  padding:0;
  cursor:pointer;
  flex: 0 0 auto;
}
.aiw-mini-cart-thumb:hover{ transform: scale(1.04); }
.aiw-mini-cart-thumb img{
  width:100%;
  height:100%;
  object-fit: cover;
  display:block;
}

.aiw-mini-cart-thumb-ph{
  width:100%;
  height:100%;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size: 12px;
  font-weight: 700;
  color: rgba(255,255,255,.85);
  background: radial-gradient(circle at 30% 30%, rgba(56,189,248,.22), rgba(255,255,255,.06));
}

.aiw-mini-cart-empty{
  font-size: 12px;
  color: rgba(255,255,255,.65);
  padding: 4px 2px;
}

.aiw-mini-cart-more{
  font-size: 12px;
  color: rgba(255,255,255,.75);
  padding: 0 8px;
  height: 34px;
  display:flex;
  align-items:center;
  border-radius: 999px;
  border: 1px dashed rgba(255,255,255,.18);
  flex: 0 0 auto;
}

.aiw-mini-cart-total{
  margin-top: 6px;
  font-size: 12px;
  color: rgba(255,255,255,.85);
  text-align: center;
}

/* Draft submit icon placeholder (set your custom SVG via CSS variable)
   Example:
   :root { --aiw-draft-submit-mask: url('img/cart.svg'); }
*/
:root { --aiw-draft-submit-mask: url('img/cart.svg'); }

.aiw-order-submit{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:38px;
  height:38px;
  padding:0 !important;
}

.aiw-draft-submit-icon{
  width:18px;
  height:18px;
  display:inline-block;
  background: currentColor;
  -webkit-mask: var(--aiw-draft-submit-mask) center / contain no-repeat;
  mask: var(--aiw-draft-submit-mask) center / contain no-repeat;
}


/* ---------- Cart overlay (50% chat height) ---------- */
.aiw-cart-overlay{
  position: absolute;
  inset: 0;
  z-index: 60;
  display: none;
  pointer-events: none;
}

.aiw-cart-overlay.aiw-cart-overlay--open{
  display: flex;
  align-items: flex-end;
  pointer-events: auto;
  background: rgba(0,0,0,.25);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.aiw-cart-sheet{
  width: 100%;
  height: 50%;
  max-height: 50%;
  border-top-left-radius: 18px;
  border-top-right-radius: 18px;
      background: var(--aiw-bg-glass-strong);
  border-top: 1px solid rgba(255,255,255,.10);
  box-shadow: 0 -18px 40px rgba(0,0,0,.35);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.aiw-cart-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,.10);
}

.aiw-cart-title{
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;

  font-weight: 700;
  color: rgba(255,255,255,.92);
}


.aiw-cart-title-total{
  font-weight: 600;
  font-size: 12px;
  line-height: 1.2;
  color: rgba(255,255,255,.75);
  white-space: nowrap;
}



.aiw-cart-close{
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06);
  color: rgba(255,255,255,.9);
  cursor: pointer;
}

.aiw-cart-list{
  padding: 10px 12px;
  overflow: auto;
  flex: 1;
  display:flex;
  flex-direction: column;
  gap: 10px;
}

.aiw-cart-item{
  display:flex;
  gap: 10px;
  padding: 10px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.06);
}

.aiw-cart-item-img{
  width: 100px;
  height: 100px;
  min-width: 100px;
  min-height: 100px;

  border-radius: 14px;
  overflow: hidden;
  background: rgba(255,255,255,.08);

  flex: 0 0 100px;   /* РІР°Р¶РЅРѕ: С‡С‚РѕР±С‹ flex РЅРµ СЃР¶РёРјР°Р» */
}
.aiw-cart-item-img img{
  width:100%;
  height:100%;
  object-fit: cover;
}

.aiw-cart-item-main{ flex:1; min-width: 0; }

.aiw-cart-item-name{
  font-weight: 700;
  color: rgba(255,255,255,.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aiw-cart-item-meta{
  margin-top: 4px;
  font-size: 12px;
  color: rgba(255,255,255,.7);
}

.aiw-cart-item-controls{
  margin-top: 8px;
  display:flex;
  align-items:center;
  gap: 8px;
}

.aiw-cart-step{
  display:flex;
  align-items:center;
  gap: 6px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(0,0,0,.15);
  padding: 4px 6px;
}

.aiw-cart-btn{
  width: 30px;
  height: 30px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06);
  color: rgba(255,255,255,.9);
  cursor:pointer;
}

.aiw-cart-qty{
  min-width: 18px;
  text-align:center;
  color: rgba(255,255,255,.9);
  font-weight: 800;
}

.aiw-cart-remove{
  margin-left: auto;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,80,80,.12);
  color: rgba(255,255,255,.92);
  padding: 7px 10px;
  cursor:pointer;
}

.aiw-cart-footer{
  border-top: 1px solid rgba(255,255,255,.10);
  padding: 10px 12px;
  background: rgba(0,0,0,.18);
}

.aiw-cart-submit{
  width: 100%;
  border: 0;
  border-radius: 14px;
  padding: 12px 14px;
  font-weight: 800;
  cursor:pointer;
  background: linear-gradient(135deg, #22c55e, #4ade80);
        color: rgba(255,255,255,0.93);
        font-weight: 600;
        box-shadow: 0 6px 18px rgba(22,163,74,0.5);
}

.aiw-cart-submit:disabled{ opacity: .55; cursor:not-allowed; }

.aiw-mini-cart-badge {
  position: absolute;
  top: -8px;
  right: -8px;

  min-width: 22px;
  height: 22px;
  padding: 0 6px;

  border-radius: 999px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  font-size: 12px;
  font-weight: 600;

  /* Р‘РµР»С‹Р№ СЃС‚РµРєР»СЏРЅРЅС‹Р№ С„РѕРЅ */
  background: rgba(255, 255, 255, 0.88);

  /* РўС‘РјРЅС‹Р№ С‚РµРєСЃС‚ РґР»СЏ РєРѕРЅС‚СЂР°СЃС‚Р° */
  color: rgba(0, 0, 0, 0.85);

  /* Р‘РµР»Р°СЏ РјСЏРіРєР°СЏ РїРѕРґСЃРІРµС‚РєР° */
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.45),
    0 3px 10px rgba(255, 255, 255, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);

  border: 1px solid rgba(255, 255, 255, 0.65);

  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}


/* subtle pulse when user taps thumbnail */
.aiw-pulse{ animation: aiwPulse 650ms ease-out; }
@keyframes aiwPulse{
  0%{ transform: scale(1); box-shadow: 0 0 0 0 rgba(56,189,248,.0); }
  40%{ transform: scale(1.01); box-shadow: 0 0 0 6px rgba(56,189,248,.18); }
  100%{ transform: scale(1); box-shadow: 0 0 0 0 rgba(56,189,248,.0); }
}


      .aiw-upsell-add-btn {
        border-radius: var(--aiw-radius-full);
        
         background: rgba(255, 255, 255, 0.88);

  /* РўС‘РјРЅС‹Р№ С‚РµРєСЃС‚ РґР»СЏ РєРѕРЅС‚СЂР°СЃС‚Р° */
  color: rgba(0, 0, 0, 0.85);

  /* Р‘РµР»Р°СЏ РјСЏРіРєР°СЏ РїРѕРґСЃРІРµС‚РєР° */
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.45),
    0 3px 10px rgba(255, 255, 255, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);

  border: 1px solid rgba(255, 255, 255, 0.65);

  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
        padding: 4px 10px;
        cursor: pointer;
        font-size: 15px;
        font-weight: 600;
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 32px;
      }

      

      /* ---------- РРЅРїСѓС‚ РІРЅРёР·Сѓ: СЃС‚РµРєР»Рѕ, Р·Р°РєСЂРµРїР»С‘РЅ Рє РЅРёР·Сѓ ---------- */
      .aiw-chat-input {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px 12px;
        flex-shrink: 0;
        background: transparent;
        border: none;
        position: sticky;
        bottom: 0;
        
      }

      /* СЃС‚РµРєР»СЏРЅРЅС‹Р№ РїСЂРѕР·СЂР°С‡РЅС‹Р№ РёРЅРїСѓС‚ */
      .aiw-chat-input input {
          flex: 1;
  border-radius: 999px;

  /* Glass 2.0 вЂ” РњРђРљРЎРРњРђР›Р¬РќРћ РїСЂРѕР·СЂР°С‡РЅРѕРµ СЃС‚РµРєР»Рѕ */
  background: rgba(255, 255, 255, 0.03);  /* Р±С‹Р»Рѕ 0.08 */
  border: 0px solid rgba(255, 255, 255, 0.22); /* С‡СѓС‚СЊ СЏСЂС‡Рµ */


  padding: 9px 14px;
  color: var(--aiw-text-main);
  font-size: 16px;
  min-height: 36px;
  box-shadow: none;

  /* Р»С‘РіРєРёР№ РІРЅСѓС‚СЂРµРЅРЅРёР№ Р±РµР»С‹Р№ highlight в†’ СЌС„С„РµРєС‚ РЅР°СЃС‚РѕСЏС‰РµРіРѕ СЃС‚РµРєР»Р° */
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
      }

      .aiw-chat-input input::placeholder {
        color: rgba(255, 255, 255, 0.45);
      }

      /* СЃС‚РµРєР»СЏРЅРЅС‹Рµ РєРЅРѕРїРєРё РѕС‚РїСЂР°РІРєРё Рё РјРёРєСЂРѕС„РѕРЅР° */
      .aiw-chat-input button {
          width: 38px;
  height: 38px;
  border-radius: 999px;
flex: 0 0 auto;
  /* Р•С‰С‘ Р±РѕР»РµРµ СЃС‚РµРєР»СЏРЅРЅС‹Рµ */
  background: rgba(255, 255, 255, 0.03);  /* Р±С‹Р»Рѕ 0.08 */
  


  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  font-size: 0;
  box-shadow: none;

  /* Р›С‘РіРєРёР№ highlight СЃРІРµСЂС…Сѓ */
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
}


      .aiw-send-button,
      .aiw-mic-button {
        position: relative;
      }

      /* Р±Р°Р·РѕРІС‹Р№ СЃС‚РёР»СЊ РёРєРѕРЅРѕРє */
      .aiw-send-button::before,
      .aiw-mic-button::before {
        content: "";
        width: 19px;
        height: 19px;
        display: block;
        background-repeat: no-repeat;
        background-position: center;
        background-size: 19px;
      }

      /* РёРєРѕРЅРєР° РѕС‚РїСЂР°РІРєРё */
      .aiw-send-button::before {
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='white' viewBox='0 0 24 24'%3E%3Cpath d='M4 4l16 8-16 8 3-8-3-8zm4.7 7.9l-1.4 3.8L16.3 12 7.3 7.3l1.4 3.8z'/%3E%3C/svg%3E");
      }

      /* РёРєРѕРЅРєР° РјРёРєСЂРѕС„РѕРЅР° */
      .aiw-mic-button::before {
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='white' viewBox='0 0 24 24'%3E%3Cpath d='M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zm5 9a1 1 0 0 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.1A5 5 0 0 0 17 12z'/%3E%3C/svg%3E");
      }

      /* РћС‚РґРµР»СЊРЅРѕ РјРёРєСЂРѕС„РѕРЅ РІ СЂРµР¶РёРјРµ Р·Р°РїРёСЃРё вЂ” Р»С‘РіРєРёР№ РєСЂР°СЃРЅС‹Р№ Р°РєС†РµРЅС‚, Р±РµР· С‚РµРЅРё */
      .aiw-mic-button.aiw-mic-recording {
        background: rgba(255, 80, 80, 0.12);
        border-color: rgba(255, 80, 80, 0.45);
        box-shadow: none;
      }

      /* ---------- РђРЅРёРјР°С†РёСЏ Р»С‘РіРєРѕРіРѕ "РїСѓР»СЊСЃР°" (РјРёРєСЂРѕС„РѕРЅ / РєРЅРѕРїРєР°) ---------- */
      @keyframes aiw-pulse-soft {
        0%   { transform: scale(1); }
        50%  { transform: scale(1.15); }
        100% { transform: scale(1); }
      }

      .aiw-suggestions {
  display: none;
  padding: 10px 5px;
  margin: 10px 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.aiw-suggestions-track {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
}

.aiw-suggestion-card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 5px;
  border: 1px solid var(--aiw-border-subtle);
  padding: 8px 25px;
  background: var(--aiw-bg-glass);
  cursor: pointer;
  white-space: nowrap;
  flex: 0 0 auto;
}

.aiw-suggestion-card:hover {
  border-color: var(--aiw-accent);
  background: var(--aiw-bg-glass-strong);
}

/* РћР±С‰РёР№ СЃС‚РёР»СЊ SVG-РёРєРѕРЅРѕРє РІ header launcher */
.aiw-button.aiw-button--header .aiw-hc img.aiw-icon{
  width: 22px;
  height: 22px;
  display: block;
  object-fit: contain;
  margin: auto;
  position: absolute;
  inset: 0;
}


.aiw-suggestion-image {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  object-fit: cover;
}

.aiw-suggestion-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.aiw-suggestion-name {
  font-size: 13px;
  font-weight: bold;
  color: var(--aiw-text-main);
}

.aiw-suggestion-price {
  font-size: 11px;
  color: var(--aiw-text-muted);
}


            /* РЎС„РµСЂР° РІРЅСѓС‚СЂРё РєР°РїР»Рё, РІ РєРѕС‚РѕСЂРѕР№ Р»РµРІРёС‚РёСЂСѓРµС‚ Р»РѕРіРѕС‚РёРї */
      .aiw-button-logo {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border-radius: 999px;
      }

      

      /* РЎР°Рј Р»РѕРіРѕС‚РёРї (SVG / IMG) РІ РјРёРЅРёР°С‚СЋСЂРµ, РєРѕС‚РѕСЂС‹Р№ Р»РµРІРёС‚РёСЂСѓРµС‚ */
      .aiw-button-logo img,
      .aiw-button-logo svg {
        width: 72%;
        height: 72%;
        display: block;
        object-fit: contain;
        animation: aiw-logoFloat 3.2s ease-in-out infinite;
      }

      

      /* ---------- Welcome message (plain text, no card) ---------- */

.aiw-msg-welcome .aiw-msg-bubble {
  background: transparent;     /* вќ— СѓР±РёСЂР°РµРј С‡С‘СЂРЅС‹Р№ С„РѕРЅ */
  box-shadow: none;
  border: none;
  padding: 6px 4px;            /* РєР°Рє Сѓ С‚РµРєСЃС‚Р° РґСЂР°С„С‚Р° */
}

.aiw-welcome-text {
  color: #ffffff;              /* С‡РёСЃС‚Рѕ Р±РµР»С‹Р№ */
  font-size: 14px;
  line-height: 1.4;
  font-weight: 400;
  opacity: 0.92;               /* РјСЏРіРєРѕ, РєР°Рє РІ РґСЂР°С„С‚Рµ */
}


/* ====== DROP SHAPE (Comp1.svg) for main header button ====== */

/* РЈ main РєРѕРЅС‚РµР№РЅРµСЂР° СѓР±РёСЂР°РµРј РєСЂСѓРіР»С‹Р№ вЂњglassвЂќ, РїРѕС‚РѕРјСѓ С‡С‚Рѕ С‚РµРїРµСЂСЊ СЃС‚РµРєР»Рѕ Р±СѓРґРµС‚ РЅР° .aiw-drop-shape */
.aiw-button.aiw-button--header .aiw-hc--main{
  background: none !important;
  border: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  overflow: visible;
}

.aiw-drop-shape {
    margin: auto;
    justify-content: center;
    display: flex;
}

/* Р’РёР·СѓР°Р»СЊРЅР°СЏ РєР°РїР»СЏ */
.aiw-button.aiw-button--header .aiw-hc--main .aiw-drop-shape{
  position: absolute;
  inset: 0;

  /* СЃС‚РµРєР»СЏРЅРЅС‹Р№ РІРёР·СѓР°Р» (С‚РѕС‚ Р¶Рµ СЃС‚РёР»СЊ С‡С‚Рѕ Р±С‹Р» РЅР° .aiw-hc) */
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  background:
    radial-gradient(120% 120% at 30% 25%,
      rgba(255,255,255,.38),
      rgba(255,255,255,.12) 40%,
      rgba(255,255,255,.07) 70%,
      rgba(255,255,255,.05) 100%);


  /* РґРµР»Р°РµРј С„РѕСЂРјСѓ РєР°РїР»Рё С‡РµСЂРµР· mask */
  -webkit-mask: url("img/Comp1.svg") center / contain no-repeat;
  mask: url("img/Comp1.svg") center / contain no-repeat;

  /* С‡С‚РѕР±С‹ Р°РЅРёРјР°С†РёРё Р±С‹Р»Рё РїР»Р°РІРЅС‹РјРё */
  transform-origin: 50% 65%;
  will-change: transform;
  animation: aiwDropWobble 3.8s ease-in-out infinite;
}

/* РћР±РІРѕРґРєР° (РїСЃРµРІРґРѕ-СЃР»РѕР№), С‡С‚РѕР±С‹ РєСЂР°Р№ Р±С‹Р» вЂњС‡С‘С‚С‡РµвЂќ */
.aiw-button.aiw-button--header .aiw-hc--main .aiw-drop-shape::before{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;

  -webkit-mask: url("img/Comp1.svg") center / contain no-repeat;
  mask: url("img/Comp1.svg") center / contain no-repeat;

  /* СЂРёСЃСѓРµРј РєСЂР°Р№ С‡РµСЂРµР· inset-shadow */
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.22);
  border-radius: 0;
}

/* РРєРѕРЅРєР° РІРЅСѓС‚СЂРё РєР°РїР»Рё */
.aiw-button.aiw-button--header .aiw-hc--main .aiw-drop-shape img{
  position:absolute;
  inset:0;
  margin:auto;
  width: 26px;
  height: 26px;
  opacity: .92;
  filter: drop-shadow(0 6px 14px rgba(0,0,0,.45));
}

/* Hover СЌС„С„РµРєС‚ (С‚РµРїРµСЂСЊ РїРѕРґСЃРІРµС‡РёРІР°РµРј РёРјРµРЅРЅРѕ РєР°РїР»СЋ) */
.aiw-button.aiw-button--header .aiw-hc--main:hover .aiw-drop-shape{
  box-shadow:
    0 18px 44px rgba(0,0,0,.55),
    0 0 0 6px rgba(14,165,233,.10),
    inset 0 1px 0 rgba(255,255,255,.30);
}
.aiw-button.aiw-button--header.aiw-open .aiw-hc--main .aiw-drop-shape{
  box-shadow:
    0 18px 44px rgba(0,0,0,.55),
    0 0 0 7px rgba(14,165,233,.20),
    0 0 26px rgba(14,165,233,.22),
    inset 0 1px 0 rgba(255,255,255,.28);
}

/* Р›С‘РіРєРѕРµ вЂњР¶РёРІРѕРµвЂќ РґСЂРѕР¶Р°РЅРёРµ РєР°РїР»Рё */
@keyframes aiwDropWobble{
  0%   { transform: translateY(0) rotate(0deg) scale(1); }
  25%  { transform: translateY(-1px) rotate(-1.2deg) scale(1.01); }
  50%  { transform: translateY(0) rotate(1.2deg) scale(1.01); }
  75%  { transform: translateY(1px) rotate(-0.8deg) scale(1.005); }
  100% { transform: translateY(0) rotate(0deg) scale(1); }
}

/* ====== DROP SHAPE for SIDE buttons (waiter/bill) ====== */

/* СѓР±РёСЂР°РµРј РєСЂСѓРіР»С‹Р№ вЂњglassвЂќ Сѓ side РєРѕРЅС‚РµР№РЅРµСЂР° вЂ” СЃС‚РµРєР»Рѕ Р±СѓРґРµС‚ РЅР° .aiw-drop-shape--side */
.aiw-button.aiw-button--header .aiw-hc--side{
  background: none !important;
  border: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  overflow: visible;
}

/* СЃР°РјР° РєР°РїР»СЏ РґР»СЏ side */
.aiw-button.aiw-button--header .aiw-hc--side .aiw-drop-shape--side{
  position: absolute;
  inset: 0;
  z-index: 1;  
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);

  background:
    radial-gradient(120% 120% at 30% 22%,
      rgba(255,255,255,.55),
      rgba(255,255,255,.22) 38%,
      rgba(255,255,255,.12) 65%,
      rgba(255,255,255,.08) 100%);

  -webkit-mask: url("img/Comp1.svg") center / contain no-repeat;
  mask: url("img/Comp1.svg") center / contain no-repeat;

  box-shadow:
    0 14px 34px rgba(0,0,0,.45),
    0 0 14px rgba(255,255,255,.18),
    inset 0 1px 0 rgba(255,255,255,.35);

  transform-origin: 50% 65%;
  will-change: transform;
  animation: aiwDropWobbleSide 4.6s ease-in-out infinite;
}

/* С‚РѕРЅРєР°СЏ РѕР±РІРѕРґРєР° РґР»СЏ side */
.aiw-button.aiw-button--header .aiw-hc--side .aiw-drop-shape--side::before{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  z-index: 2;
  -webkit-mask: url("img/Comp1.svg") center / contain no-repeat;
  mask: url("img/Comp1.svg") center / contain no-repeat;

  box-shadow: inset 0 0 0 1px rgba(255,255,255,.20);
}

/* РёРєРѕРЅРєР° РІРЅСѓС‚СЂРё РєР°РїР»Рё */
/* SIDE ICONS: С‡РёСЃС‚Рѕ Р±РµР»С‹Рµ, Р±РµР· Р±Р»СЋСЂР°, РїРѕРІРµСЂС… РєР°РїР»Рё */
.aiw-button.aiw-button--header .aiw-hc--side .aiw-drop-shape--side img.aiw-icon{
  position: absolute;
  inset: 0;
  margin: auto;
  width: 20px;
  height: 20px;

  z-index: 5;          /* РїРѕРІРµСЂС… РєР°РїР»Рё Рё РѕР±РІРѕРґРєРё */
  opacity: 1;

  /* РґРµР»Р°РµРј Р»СЋР±РѕР№ СЃРµСЂС‹Р№/С†РІРµС‚РЅРѕР№ SVG С‡РёСЃС‚Рѕ Р±РµР»С‹Рј */
  filter: brightness(0) invert(1) contrast(1.15);

  /* вЂњРєР°Рє РїРѕРІРµСЂС… СЃС‚РµРєР»Р°вЂќ вЂ” Р»С‘РіРєРёР№ РєРѕРЅС‚СЂР°СЃС‚РЅС‹Р№ РѕСЂРµРѕР» (РќР• blur) */
  -webkit-filter: brightness(0) invert(1) contrast(1.15)
    drop-shadow(0 2px 6px rgba(0,0,0,.45));
  filter: brightness(0) invert(1) contrast(1.15)
    drop-shadow(0 2px 6px rgba(0,0,0,.45));

  /* С‡С‚РѕР±С‹ РЅРµ Р±С‹Р»Рѕ СЃС‚СЂР°РЅРЅС‹С… Р±Р»РµРЅРґРѕРІ */
  mix-blend-mode: normal;
  transform: translateZ(0);
  pointer-events: none; /* РєР»РёРєР°РµРј РїРѕ РєРЅРѕРїРєРµ, РЅРµ РїРѕ img */
}


/* hover РїРѕРґСЃРІРµС‚РєР° side */
.aiw-button.aiw-button--header .aiw-hc--side:hover .aiw-drop-shape--side{
  box-shadow:
    0 16px 38px rgba(0,0,0,.52),
    0 0 0 6px rgba(14,165,233,.10),
    inset 0 1px 0 rgba(255,255,255,.28);
}

/* С‡СѓС‚СЊ Р±РѕР»РµРµ СЃРїРѕРєРѕР№РЅРѕРµ вЂњР¶РёРІРѕРµвЂќ РґСЂРѕР¶Р°РЅРёРµ РґР»СЏ side */
@keyframes aiwDropWobbleSide{
  0%   { transform: translateY(0) rotate(0deg) scale(1); }
  30%  { transform: translateY(-0.6px) rotate(-1deg) scale(1.008); }
  60%  { transform: translateY(0.4px) rotate(0.8deg) scale(1.008); }
  100% { transform: translateY(0) rotate(0deg) scale(1); }
}

/* ===== Product card image (inside bot message) ===== */

.aiw-product-card-media {
  width: 100px;
  height: 100px;
  min-width: 100px;
  min-height: 100px;
  flex-shrink: 0;
}

.aiw-product-card-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;

  border-radius: 14px;
  display: block;
}

/* === FORCE 100x100 product images (draft + bot cards) === */
.aiw-order-item-image{
  width: 100px !important;
  height: 100px !important;
  flex: 0 0 100px !important;
  border-radius: 16px !important;
}
.aiw-order-item-image img{
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  display: block !important;
}

/* === FORCE 100x100 cart images === */
.aiw-cart-item-img{
  width: 100px !important;
  height: 100px !important;
  flex: 0 0 100px !important;
  border-radius: 16px !important;
}
.aiw-cart-item-img img{
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  display: block !important;
}



    `;
    document.head.appendChild(style);
  }

  // ---------- UI: С‡Р°С‚ Рё РєРЅРѕРїРєР° + DRAGGABLE ----------

  let chatRoot = null;

  function createButtonAndChat() {
    const headerMount = document.querySelector("#top");
    const mountInHeader = !!headerMount;
    // РљРЅРѕРїРєР°
    const btn = document.createElement("div");
    btn.className = "aiw-button";
    

    // РІРјРµСЃС‚Рѕ textContent = '' РєР»Р°РґС‘Рј HTML СЃ РІРЅСѓС‚СЂРµРЅРЅРёРјРё СЃР»РѕСЏРјРё РєР°РїР»Рё
    btn.innerHTML = `
`;

    // Р§Р°С‚
    const chat = document.createElement("div");
    chat.className = "aiw-chat";
    chat.style.display = "none";
    chatRoot = chat;

    const header = document.createElement("div");
    header.className = "aiw-chat-header";
    header.innerHTML = `
  <div class="aiw-chat-header-slot">
    <div class="aiw-button aiw-button--header aiw-chat-launcher-host"></div>
  </div>
`;

    // --- Header controls вЂњdropsвЂќ move: move .aiw-header-wrap into chat header on open, back on close ---
    const headerSlot = header.querySelector(".aiw-chat-launcher-host");

    let headerWrapEl = null; // .aiw-header-wrap node
    let headerWrapHome = null; // where to return it (btn)
    let headerWrapInChat = false;

    function flipMove(el, toParent) {
      if (!el || !toParent) return;

      const first = el.getBoundingClientRect();
      toParent.appendChild(el);
      const last = el.getBoundingClientRect();

      const dx = first.left - last.left;
      const dy = first.top - last.top;

      el.style.willChange = "transform";
      el.style.transition = "transform 240ms cubic-bezier(.2,.8,.2,1)";
      el.style.transform = `translate(${dx}px, ${dy}px)`;

      requestAnimationFrame(() => {
        el.style.transform = "translate(0px, 0px)";
      });

      const cleanup = () => {
        el.style.transition = "";
        el.style.willChange = "";
        el.style.transform = "";
        el.removeEventListener("transitionend", cleanup);
      };
      el.addEventListener("transitionend", cleanup);
    }

    function moveHeaderWrapIntoChat() {
      if (!headerWrapEl || headerWrapInChat) return;

      // hide the original launcher container to avoid duplicate clicks/visuals
      btn.style.pointerEvents = "none";
      btn.style.opacity = "0";

      flipMove(headerWrapEl, headerSlot);
      headerWrapInChat = true;
    }

    function moveHeaderWrapBackToPage() {
      if (!headerWrapEl || !headerWrapInChat) return;

      flipMove(headerWrapEl, headerWrapHome);

      btn.style.opacity = "";
      btn.style.pointerEvents = "";
      headerWrapInChat = false;
    }

    const msgs = document.createElement("div");
    msgs.className = "aiw-chat-messages";
    messagesEl = msgs;

    // --- Mini-cart (under header / вЂњdropsвЂќ) ---
    const miniCart = document.createElement("div");
    miniCart.className = "aiw-mini-cart aiw-mini-cart--empty";
    miniCart.innerHTML = `
  <div class="aiw-mini-cart-badge" style="display:none">0</div>
  <div class="aiw-mini-cart-track"></div>
  <div class="aiw-mini-cart-total" style="display:none"></div>
`;
    miniCartEl = miniCart;
    renderMiniCart(null);

    // click anywhere on mini-cart -> open cart overlay
    miniCart.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openCartOverlay === "function") openCartOverlay();
    });

    // ---------- Cart overlay (50% chat height) ----------
    const cartOverlay = document.createElement("div");
    cartOverlay.className = "aiw-cart-overlay";
    cartOverlay.innerHTML = `
  <div class="aiw-cart-sheet" role="dialog" aria-modal="true">
    <div class="aiw-cart-head">
  <div class="aiw-cart-title">
    <span class="aiw-cart-title-label">${UI_TEXTS.cart_title || "Cart"}</span>
    <span class="aiw-cart-title-total" style="display:none"></span>
  </div>
  <button type="button" class="aiw-cart-close" aria-label="${
    UI_TEXTS.cart_close_aria || "Close"
  }">Г—</button>
</div>

    <div class="aiw-cart-list"></div>
    <div class="aiw-cart-footer">
      <button type="button" class="aiw-cart-submit" disabled>${
        UI_TEXTS.cart_submit || "Send to kitchen"
      }</button>
    </div>
  </div>
`;

    cartOverlayEl = cartOverlay;
    cartOverlayListEl = cartOverlay.querySelector(".aiw-cart-list");
    cartOverlaySubmitBtn = cartOverlay.querySelector(".aiw-cart-submit");
    cartOverlayTitleTotalEl = cartOverlay.querySelector(
      ".aiw-cart-title-total",
    );

    const cartCloseBtn = cartOverlay.querySelector(".aiw-cart-close");

    openCartOverlay = function () {
      if (!cartOverlayEl) return;
      cartOverlayEl.classList.add("aiw-cart-overlay--open");
      if (typeof renderCartOverlay === "function")
        renderCartOverlay(lastOrderDraft);
    };

    closeCartOverlay = function () {
      if (!cartOverlayEl) return;
      cartOverlayEl.classList.remove("aiw-cart-overlay--open");
    };

    // close when click on dim background
    cartOverlay.addEventListener("click", (e) => {
      if (e.target === cartOverlay) closeCartOverlay();
    });
    cartCloseBtn.addEventListener("click", closeCartOverlay);

    renderCartOverlay = function (orderDraft) {
      if (!cartOverlayListEl || !cartOverlaySubmitBtn) return;

      cartOverlayListEl.innerHTML = "";

      const items =
        orderDraft && Array.isArray(orderDraft.items) ? orderDraft.items : [];
      // header total (same translation key as mini-cart)
      if (cartOverlayTitleTotalEl) {
        let subtotal = 0;
        let hasAnyPrice = false;

        if (items && items.length) {
          for (const it of items) {
            const q = it.quantity != null ? Number(it.quantity) : 1;
            const p = it.unitPrice != null ? Number(it.unitPrice) : NaN;

            if (!Number.isNaN(p) && Number.isFinite(p) && p > 0) {
              subtotal += p * q;
              hasAnyPrice = true;
            }
          }
        }

        if (hasAnyPrice) {
          cartOverlayTitleTotalEl.textContent = `${
            UI_TEXTS.mini_subtotal || "Subtotal"
          }: ${formatPrice(subtotal)}`;
          cartOverlayTitleTotalEl.style.display = "inline";
        } else {
          cartOverlayTitleTotalEl.textContent = "";
          cartOverlayTitleTotalEl.style.display = "none";
        }
      }

      cartOverlaySubmitBtn.disabled = !(items && items.length);

      if (!items.length) {
        const empty = document.createElement("div");
        empty.style.padding = "10px 2px";
        empty.style.color = "rgba(255,255,255,.75)";
        empty.textContent = UI_TEXTS.mini_cart_empty || "Cart is empty";
        cartOverlayListEl.appendChild(empty);
        return;
      }

      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "aiw-cart-item";

        const img = document.createElement("div");
        img.className = "aiw-cart-item-img";
        const overlayImg = pickImageUrl(item);
        if (overlayImg) {
          const i = document.createElement("img");
          i.src = overlayImg;
          i.alt = item.name || item.code || "";
          img.appendChild(i);
        }
        row.appendChild(img);

        const main = document.createElement("div");
        main.className = "aiw-cart-item-main";

        const name = document.createElement("div");
        name.className = "aiw-cart-item-name";
        name.textContent = item.name || item.code || "Без назви";

        const qty = item.quantity != null ? Number(item.quantity) : 1;
        const priceStr = formatPrice(item.unitPrice);
        const meta = document.createElement("div");
        meta.className = "aiw-cart-item-meta";
        meta.textContent = priceStr ? `${qty} × ${priceStr}` : `${qty} ×`;

        const controls = document.createElement("div");
        controls.className = "aiw-cart-item-controls";

        const step = document.createElement("div");
        step.className = "aiw-cart-step";

        const minus = document.createElement("button");
        minus.type = "button";
        minus.className = "aiw-cart-btn";
        minus.textContent = "−";

        const qtyEl = document.createElement("div");
        qtyEl.className = "aiw-cart-qty";
        qtyEl.textContent = String(qty);

        const plus = document.createElement("button");
        plus.type = "button";
        plus.className = "aiw-cart-btn";
        plus.textContent = "+";

        step.appendChild(minus);
        step.appendChild(qtyEl);
        step.appendChild(plus);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "aiw-cart-remove";
        remove.textContent = UI_TEXTS.cart_remove || "Remove";

        async function setQty(newQty) {
          if (!orderDraft) return;

          const operation = {
            type: newQty > 0 ? "set" : "remove",
            order_item_id: item.id,
            item_code: item.code,
            menu_item_id: item.menuItemId,
            quantity: newQty,
          };

          const updatedDraft = await callOrderUiUpdate(
            orderDraft.id,
            operation,
          );
          if (updatedDraft) {
            // 1) РІСЃРµРіРґР° СЃРёРЅРєР°РµРј РіР»РѕР±Р°Р»СЊРЅС‹Р№ draft
            lastOrderDraft = updatedDraft;

            // 2) РµСЃР»Рё РµСЃС‚СЊ "СЃРѕРѕР±С‰РµРЅРёРµ-РґСЂР°С„С‚" РІ С‡Р°С‚Рµ вЂ” РѕР±РЅРѕРІРёРј РµРіРѕ
            if (lastOrderDraftEl && lastOrderDraftEl.isConnected) {
              rerenderOrderDraftElement(lastOrderDraftEl, updatedDraft);
            } else {
              // 3) РёРЅР°С‡Рµ СЌС‚Рѕ СЃС†РµРЅР°СЂРёР№ recommendations/mini-cart в†’ РїРµСЂРµСЂРёСЃРѕРІС‹РІР°РµРј UI РЅР°РїСЂСЏРјСѓСЋ
              const nd =
                updatedDraft &&
                Array.isArray(updatedDraft.items) &&
                updatedDraft.items.length
                  ? updatedDraft
                  : null;

              renderMiniCart(nd);
              if (typeof renderCartOverlay === "function")
                renderCartOverlay(updatedDraft);
            }
          }
        }

        minus.addEventListener("click", () => setQty(qty - 1));
        plus.addEventListener("click", () => setQty(qty + 1));
        remove.addEventListener("click", () => setQty(0));

        controls.appendChild(step);
        controls.appendChild(remove);

        main.appendChild(name);
        main.appendChild(meta);
        main.appendChild(controls);

        row.appendChild(main);
        cartOverlayListEl.appendChild(row);
      });
    };

    // submit only from overlay (this sends to Telegram)
    cartOverlaySubmitBtn.addEventListener("click", async () => {
      try {
        if (!lastOrderDraft || !lastOrderDraft.id) return;
        const res = await callOrderSubmit(lastOrderDraft.id);
        if (res && res.ok) {
          appendSystemMessage(
            uiText("sys_order_sent_tg", "Order sent to Telegram."),
          );
          closeCartOverlay();
          // cart-first: after submit clear local draft UI
          try {
            if (lastOrderDraftEl && lastOrderDraftEl.isConnected) {
              lastOrderDraftEl.remove();
            }
          } catch (_) {}
          lastOrderDraft = null;
          lastOrderDraftEl = null;
          if (typeof renderMiniCart === "function") renderMiniCart(null);
          if (typeof renderCartOverlay === "function") renderCartOverlay(null);
        }
      } catch (e) {
        console.error("submit failed", e);
      }
    });

    // --- Quick Actions panel (UI only) ---
    let pendingQuickAction = null;

    async function sendQuickActionToBackend(actionKey) {
      if (!sessionToken) {
        appendSystemMessage("Сесія ще не готова. Зачекайте пару секунд.");
        return { ok: false, error: "no_session" };
      }

      // mapping UI -> backend
      const endpoint =
        actionKey === "call_waiter"
          ? `${API_BASE}/actions/request-waiter`
          : `${API_BASE}/actions/request-bill`;

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-token": sessionToken,
          },
          // С‚РµР»Рѕ РЅРµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ, РЅРѕ РїСѓСЃС‚СЊ Р±СѓРґРµС‚ (РЅР° Р±СѓРґСѓС‰РµРµ)
          body: JSON.stringify({}),
          credentials: "include",
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          console.error("[QuickAction] HTTP error", res.status, txt);
          return { ok: false, status: res.status, body: txt };
        }

        const data = await res.json().catch(() => ({}));
        return { ok: true, data };
      } catch (err) {
        console.error("[QuickAction] network error", err);
        return { ok: false, error: String(err?.message || err) };
      }
    }

    const quickPanel = document.createElement("div");
    quickPanel.className = "aiw-quick-panel";
    quickPanel.innerHTML = `
      <div class="aiw-quick-title"></div>

      <label class="aiw-quick-checkbox">
        <input type="checkbox" class="aiw-quick-check" />
        <span>${UI_TEXTS.quick_confirm_label || "I confirm sending"}</span>
      </label>

      <div class="aiw-quick-actions">
        <button class="aiw-quick-btn aiw-quick-send">${
          UI_TEXTS.quick_send || "Send"
        }</button>
        <button class="aiw-quick-btn aiw-quick-cancel">${
          UI_TEXTS.quick_cancel || "Cancel"
        }</button>
      </div>
    `;

    window.openQuickAction = function (actionKey) {
      pendingQuickAction = actionKey;

      const titleEl = quickPanel.querySelector(".aiw-quick-title");
      const checkEl = quickPanel.querySelector(".aiw-quick-check");
      const sendEl = quickPanel.querySelector(".aiw-quick-send");

      titleEl.textContent =
        actionKey === "call_waiter"
          ? UI_TEXTS.quick_waiter_title || "Call a waiter?"
          : UI_TEXTS.quick_bill_title || "Ask for the bill?";

      checkEl.checked = false;
      sendEl.disabled = true;

      // show panel + open chat
      quickPanel.classList.add("aiw-show");
      toggleChat(true);
    };

    function closeQuickAction() {
      pendingQuickAction = null;
      quickPanel.classList.remove("aiw-show");
    }

    const quickCheck = quickPanel.querySelector(".aiw-quick-check");
    const quickSend = quickPanel.querySelector(".aiw-quick-send");
    const quickCancel = quickPanel.querySelector(".aiw-quick-cancel");

    quickCheck.addEventListener("change", () => {
      quickSend.disabled = !quickCheck.checked;
    });

    quickCancel.addEventListener("click", () => {
      closeQuickAction();
    });

    quickSend.addEventListener("click", async () => {
      if (!pendingQuickAction) return;

      // Р·Р°С‰РёС‚Р° РѕС‚ РґРІРѕР№РЅРѕРіРѕ РєР»РёРєР°
      quickSend.disabled = true;
      quickCancel.disabled = true;

      const niceLabel =
        pendingQuickAction === "call_waiter"
          ? uiText("quick_action_waiter_label", "Call a waiter")
          : uiText("quick_action_bill_label", "Request the bill");

      appendSystemMessage(
        formatTpl(uiText("sys_quick_sending", "⏳ Sending: {label}…"), {
          label: niceLabel,
        }),
      );

      const result = await sendQuickActionToBackend(pendingQuickAction);

      if (result.ok) {
        appendSystemMessage(
          formatTpl(uiText("sys_quick_sent_tg", "✅ Sent: {label}."), {
            label: niceLabel,
          }),
        );
        closeQuickAction();
      } else {
        appendSystemMessage(
          formatTpl(uiText("sys_quick_failed", "❌ Failed to send: {label}."), {
            label: niceLabel,
          }),
        );
        console.error("[QuickAction] failed", result);

        quickSend.disabled = !quickCheck.checked;
        quickCancel.disabled = false;
      }
    });

    // --- Р‘Р»РѕРє РїРѕРґСЃРєР°Р·РѕРє Р±Р»СЋРґ РЅР°Рґ РїРѕР»РµРј РІРІРѕРґР° ---
    const suggestionsEl = document.createElement("div");
    suggestionsEl.className = "aiw-suggestions";
    // РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ СЃРєСЂС‹С‚
    suggestionsEl.style.display = "none";

    const inputWrap = document.createElement("div");
    inputWrap.className = "aiw-chat-input";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = UI_TEXTS.input_placeholder || "Message...";

    // ===== Mobile keyboard fix (iOS Safari / Android) via visualViewport =====
let kbFixCleanup = null;

function bindMobileKeyboardFix(chatEl) {
  const inputBar = chatEl.querySelector(".aiw-chat-input");
  const messages = chatEl.querySelector(".aiw-chat-messages");
  if (!inputBar || !messages) return null;

  const vv = window.visualViewport;
  if (!vv) return null; // no visualViewport => do nothing

  let raf = 0;

  const apply = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      // Keyboard height estimation
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);

      // Move input bar up
      inputBar.style.transform = keyboard ? `translateY(${-keyboard}px)` : "";

      // Keep messages visible above the input bar
      const inputH = inputBar.getBoundingClientRect().height || 56;
      messages.style.paddingBottom = `${inputH + keyboard}px`;
    });
  };

  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);

  // iOS sometimes fires later вЂ” call once now
  apply();

  // Also re-apply when focusing/blur input (extra stability)
  const onFocus = () => apply();
  const onBlur = () => {
    inputBar.style.transform = "";
    const inputH = inputBar.getBoundingClientRect().height || 56;
    messages.style.paddingBottom = `${inputH}px`;
  };

  // Use the "input" element from outer scope (it exists where you paste this)
  input.addEventListener("focus", onFocus);
  input.addEventListener("blur", onBlur);

  return () => {
    vv.removeEventListener("resize", apply);
    vv.removeEventListener("scroll", apply);
    input.removeEventListener("focus", onFocus);
    input.removeEventListener("blur", onBlur);

    inputBar.style.transform = "";
    messages.style.paddingBottom = "";
  };
}

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "";
    sendBtn.className = "aiw-send-button";

    // ---- РћС‚РїСЂР°РІРєР° СЃРѕРѕР±С‰РµРЅРёР№ ----
    async function handleSend() {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";

      // рџ”№ РЎРєСЂС‹С‚СЊ РїРѕРґСЃРєР°Р·РєРё, РєРѕРіРґР° СЃРѕРѕР±С‰РµРЅРёРµ СѓС€Р»Рѕ
      renderSuggestions([]);

      // СЌС‚Рѕ С‚РµРєСЃС‚ СЃ РєР»Р°РІРёР°С‚СѓСЂС‹
      lastRequestFromVoice = false;

      appendUserMessage(text);
      await sendMessageToBackend(text);
    }

    // РљРѕРіРґР° РїРѕР»СѓС‡РёР»Рё С‚РµРєСЃС‚ РёР· ASR вЂ” СЃС‡РёС‚Р°РµРј, С‡С‚Рѕ Р·Р°РїСЂРѕСЃ РїСЂРёС€С‘Р» "СЃ РіРѕР»РѕСЃР°"
    async function handleRecognizedText(text) {
      input.value = text;
      lastRequestFromVoice = true;
      await handleSend();
    }

    inputWrap.appendChild(input);
    inputWrap.appendChild(sendBtn);

    chat.appendChild(header);
    chat.appendChild(miniCart);
    chat.appendChild(msgs);
    chat.appendChild(cartOverlay);
    chat.appendChild(quickPanel);
    suggestionsEl.style.display = "none";
    chat.appendChild(inputWrap);

    function bindHeaderLauncherToLogo(btn, headerMount) {
      const SIZE_MIN = 64;
      const SIZE_MAX = 180;

      const findLogoEl = () => {
        return (
          headerMount.querySelector("[data-aiw-logo]") ||
          headerMount.querySelector(".logo, .site-logo, .header__logo") ||
          headerMount.querySelector('img[alt*="AZUMA"], img[alt*="Azuma"]') ||
          headerMount.querySelector('img[src*="azuma"], img[src*="logo"]') ||
          null
        );
      };

      let raf = 0;

      const sync = () => {
        raf = 0;

        const logoEl = findLogoEl();
        const logoRect = logoEl
          ? logoEl.getBoundingClientRect()
          : headerMount.getBoundingClientRect();

        // size: С‡СѓС‚СЊ Р±РѕР»СЊС€Рµ Р»РѕРіРѕ, С‡С‚РѕР±С‹ РєР°РїР»СЏ С‚РѕС‡РЅРѕ РїРѕРєСЂС‹РІР°Р»Р° РєСЂСѓРі
        let size = (logoRect.height || 80) * 1.35;
        size = Math.max(SIZE_MIN, Math.min(size, SIZE_MAX));

        const centerX = logoRect.left + logoRect.width / 2;
        const centerY = logoRect.top + logoRect.height / 2;

        btn.style.left = centerX - size / 2 + "px";
        btn.style.top = centerY - size / 2 + "px";
        btn.style.width = size + "px";
        btn.style.height = size + "px";
        btn.style.borderRadius = "50%";
      };

      const requestSync = () => {
        if (raf) return;
        raf = requestAnimationFrame(sync);
      };

      // initial
      sync();

      // РІР°Р¶РЅРѕ: scroll + resize
      window.addEventListener("scroll", requestSync, { passive: true });
      window.addEventListener("resize", requestSync);

      // РµСЃР»Рё DOM РІРЅСѓС‚СЂРё С…РµРґРµСЂР° РјРµРЅСЏРµС‚СЃСЏ РїРѕ РІС‹СЃРѕС‚Рµ/С€РёСЂРёРЅРµ
      try {
        const ro = new ResizeObserver(requestSync);
        ro.observe(headerMount);
      } catch (e) {}

      // РЅР° РІСЃСЏРєРёР№ СЃР»СѓС‡Р°Р№: РєРѕРіРґР° РєР°СЂС‚РёРЅРєРё Р·Р°РіСЂСѓР·РёР»РёСЃСЊ
      window.addEventListener("load", requestSync);
    }

    // РџСЂРѕРёРіСЂР°С‚СЊ 1 СЂР°Р· Р°РЅРёРјР°С†РёСЋ "РІС‹С‚РµРєР°СЋС‰РёС…" РєР°РїРµР»СЊ РїСЂРё Р·Р°РіСЂСѓР·РєРµ СЃС‚СЂР°РЅРёС†С‹.
    // Р’Р°Р¶РЅРѕ: РќР• РїСЂРёРІСЏР·Р°РЅРѕ Рє toggleChat(), РїРѕСЌС‚РѕРјСѓ РЅРµ РїРѕРІС‚РѕСЂСЏРµС‚СЃСЏ РїСЂРё РѕС‚РєСЂС‹С‚РёРё/Р·Р°РєСЂС‹С‚РёРё С‡Р°С‚Р°.
    function playHeaderDropSplashOnce(btn) {
      if (!btn) return;
      if (btn.dataset.aiwSplashPlayed === "1") return;
      btn.dataset.aiwSplashPlayed = "1";

      const topBtn = btn.querySelector(".aiw-side-btn--top");
      const bottomBtn = btn.querySelector(".aiw-side-btn--bottom");

      // fallback РµСЃР»Рё РєРЅРѕРїРѕРє РЅРµС‚
      if (!topBtn || !bottomBtn) return;

      // 1) Р•СЃР»Рё GSAP РґРѕСЃС‚СѓРїРµРЅ вЂ” РґРµР»Р°РµРј СЂРµР°Р»СЊРЅРѕ РїР»Р°РІРЅРѕ
      if (window.gsap) {
        window.gsap.set([topBtn, bottomBtn], {
          opacity: 0,
          x: -18,
          scale: 0.82,
          transformOrigin: "50% 50%",
          force3D: true,
        });

        const tl = window.gsap.timeline();

        // РІРµСЂС…РЅСЏСЏ
        tl.to(
          topBtn,
          {
            opacity: 1,
            duration: 0.2,
            ease: "power2.out",
          },
          0,
        );

        tl.to(
          topBtn,
          {
            x: -10,
            scaleX: 1.12,
            scaleY: 0.88,
            duration: 0.22,
            ease: "power2.out",
          },
          0,
        );

        tl.to(
          topBtn,
          {
            x: 0,
            scaleX: 1.0,
            scaleY: 1.0,
            scale: 1.06,
            duration: 0.28,
            ease: "power3.out",
          },
          0.18,
        );

        tl.to(
          topBtn,
          {
            scale: 1.0,
            duration: 0.18,
            ease: "power2.out",
          },
          0.46,
        );

        // РЅРёР¶РЅСЏСЏ вЂ” СЃ Р·Р°РґРµСЂР¶РєРѕР№ РєР°Рє вЂњРєР»РµС‚РѕС‡РЅРѕРµ РґРµР»РµРЅРёРµвЂќ
        tl.to(
          bottomBtn,
          {
            opacity: 1,
            duration: 0.2,
            ease: "power2.out",
          },
          0.14,
        );

        tl.to(
          bottomBtn,
          {
            x: -10,
            scaleX: 1.12,
            scaleY: 0.88,
            duration: 0.22,
            ease: "power2.out",
          },
          0.14,
        );

        tl.to(
          bottomBtn,
          {
            x: 0,
            scaleX: 1.0,
            scaleY: 1.0,
            scale: 1.06,
            duration: 0.28,
            ease: "power3.out",
          },
          0.32,
        );

        tl.to(
          bottomBtn,
          {
            scale: 1.0,
            duration: 0.18,
            ease: "power2.out",
          },
          0.6,
        );

        return;
      }

      // 2) РРЅР°С‡Рµ вЂ” CSS fallback С‡РµСЂРµР· РєР»Р°СЃСЃ (РЅР° РІСЃСЏРєРёР№)
      btn.classList.add("aiw-side-splash");
      setTimeout(() => btn.classList.remove("aiw-side-splash"), 1100);
    }

    function isHighPerfOkForHQ() {
      // 1) user prefers reduced motion в†’ РІС‹РєР»СЋС‡Р°РµРј
      try {
        if (
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          return false;
      } catch (e) {}

      // 2) РµСЃР»Рё РґРµРІР°Р№СЃ СЂРµР°Р»СЊРЅРѕ СЃР»Р°Р±С‹Р№ (РјР°Р»Рѕ РїРѕС‚РѕРєРѕРІ) в†’ РІС‹РєР»СЋС‡Р°РµРј
      const cores = navigator.hardwareConcurrency || 0;
      // 4 СЏРґСЂР° С‚РѕР¶Рµ РѕРє РґР»СЏ HQ РЅР° РјРЅРѕРіРёС… РґРµРІР°Р№СЃР°С…
      if (cores && cores < 4) return false;

      // 3) deviceMemory РЅРµ РІРµР·РґРµ РµСЃС‚СЊ (Safari С‡Р°СЃС‚Рѕ undefined)
      const mem = navigator.deviceMemory || 0;
      if (mem && mem < 4) return false;

      // 4) СЃС‚Р°СЂС‹Рµ Р±СЂР°СѓР·РµСЂС‹ / Р±РµР· Web Animations РІРѕРѕР±С‰Рµ вЂ” С‚РѕР¶Рµ РІС‹РєР»СЋС‡РёРј
      if (!("animate" in document.documentElement)) return false;

      return true;
    }

    function loadScriptOnce(src) {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(
          `script[data-aiw-lib="${src}"]`,
        );
        if (existing) return resolve();

        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.dataset.aiwLib = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load " + src));
        document.head.appendChild(s);
      });
    }

    function ensureGooFilter() {
      if (document.getElementById("aiw-goo-svg")) return;

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("id", "aiw-goo-svg");
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.style.position = "absolute";
      svg.style.left = "-9999px";
      svg.style.top = "-9999px";

      // Gooey: blur + color matrix
      svg.innerHTML = `
    <filter id="aiwGoo">
      <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur"></feGaussianBlur>
      <feColorMatrix in="blur" mode="matrix"
        values="
          1 0 0 0 0
          0 1 0 0 0
          0 0 1 0 0
          0 0 0 18 -7"
        result="goo">
      </feColorMatrix>
      <feComposite in="SourceGraphic" in2="goo" operator="atop"></feComposite>
    </filter>
  `;
      document.body.appendChild(svg);
    }

    async function runHQMitosisOnce(btn) {
      if (!btn) return;
      if (btn.dataset.aiwHqMitosisPlayed === "1") return;
      btn.dataset.aiwHqMitosisPlayed = "1";

      if (!isHighPerfOkForHQ()) return;

      // GSAP CDN (РјРѕР¶РЅРѕ Р·Р°РјРµРЅРёС‚СЊ РЅР° СЃРІРѕР№ С…РѕСЃС‚РёРЅРі)
      // Р’Р°Р¶РЅРѕ: URL РґРµСЂР¶РёРј РІ РєРѕРґРµ, РєР°Рє С‚С‹ Рё РїСЂРѕСЃРёР» вЂњСЃ Р±РёР±Р»РёРѕС‚РµРєР°РјРёвЂќ.
      const GSAP_URL =
        "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js";

      try {
        await loadScriptOnce(GSAP_URL);
      } catch (e) {
        console.warn("[AIW] GSAP load failed, fallback animation only");
        return;
      }

      if (!window.gsap) return;

      ensureGooFilter();
      btn.classList.add("aiw-hq");

      const main = btn.querySelector(".aiw-goo-main");
      const bridge = btn.querySelector(".aiw-goo-bridge");
      const top = btn.querySelector(".aiw-goo-child--top");
      const bottom = btn.querySelector(".aiw-goo-child--bottom");

      if (!main || !bridge || !top || !bottom) return;

      // РЎС‚Р°СЂС‚: РґРѕС‡РµСЂРЅРёРµ РІРЅСѓС‚СЂРё вЂњРјР°С‚РµСЂРёРЅСЃРєРѕР№вЂќ РєР»РµС‚РєРё
      window.gsap.set([top, bottom], {
        opacity: 0,
        scale: 0.55,
        x: 0,
        yPercent: -50,
      });
      window.gsap.set(bridge, { scaleX: 0, opacity: 0, yPercent: -50 });
      window.gsap.set(main, { scale: 1 });

      const tl = window.gsap.timeline({
        defaults: { ease: "power2.out" },
      });

      // 1) вЂњРїРѕРґРіРѕС‚РѕРІРєР°вЂќ вЂ” РєР»РµС‚РєР° С‡СѓС‚СЊ вЂњРЅР°РґСѓР»Р°СЃСЊвЂќ
      tl.to(main, { scale: 1.03, duration: 0.18 });

      // 2) РїРѕСЏРІР»СЏСЋС‚СЃСЏ РґРѕС‡РµСЂРЅРёРµ + РјРѕСЃС‚РёРє
      tl.to([top, bottom], { opacity: 1, duration: 0.1 }, "<0.02");
      tl.to(bridge, { opacity: 1, scaleX: 0.95, duration: 0.18 }, "<");

      // 3) вЂњРїРµСЂРµС‚СЏР¶РєР°вЂќ Рё РѕС‚СЃР»РѕРµРЅРёРµ: РґРѕС‡РµСЂРЅРёРµ РІС‹РґР°РІР»РёРІР°СЋС‚СЃСЏ РЅР°СЂСѓР¶Сѓ, РјРѕСЃС‚РёРє С‚СЏРЅРµС‚СЃСЏ
      // (GSAP Р»СѓС‡С€Рµ РґРµР»Р°РµС‚ СЌС‚Рѕ РїР»Р°РІРЅРѕ, С‡РµРј CSS)
      tl.to(
        top,
        {
          duration: 0.42,
          x: 72, // вЂњРІС‹Р»РµР·Р°СЋС‚вЂќ РІРїСЂР°РІРѕ
          yPercent: -50,
          scale: 1.02,
        },
        "<",
      );

      tl.to(
        bottom,
        {
          duration: 0.42,
          x: 72,
          yPercent: -50,
          scale: 1.02,
        },
        "<0.06",
      );

      tl.to(
        bridge,
        { duration: 0.26, scaleX: 1.18, ease: "power1.inOut" },
        "<",
      );

      // 4) вЂњСЂР°Р·РґРµР»РµРЅРёРµвЂќ вЂ” РјРѕСЃС‚РёРє СЂРµР·РєРѕ С‚РѕРЅСЊС€Рµ Рё РёСЃС‡РµР·Р°РµС‚
      tl.to(
        bridge,
        { duration: 0.18, scaleX: 0.35, opacity: 0.45, ease: "power2.in" },
        "<0.05",
      );
      tl.to(bridge, {
        duration: 0.16,
        scaleX: 0.0,
        opacity: 0.0,
        ease: "power2.in",
      });

      // 5) settle: РґРѕС‡РµСЂРЅРёРµ вЂњРІСЃС‚Р°Р»РёвЂќ РЅР° РјРµСЃС‚Р° (СЃРѕРІРїР°РґР°СЋС‚ СЃ РєРЅРѕРїРєР°РјРё)
      // РњС‹ РЅРµ Р°РЅРёРјРёСЂСѓРµРј left/top (РґРѕСЂРѕРіРѕ). Р”РµР»Р°РµРј translate: С„РёРЅР°Р»СЊРЅР°СЏ x РѕС‚С‚Р°Р»РєРёРІР°РµС‚СЃСЏ РѕС‚ С‚РµРєСѓС‰РµР№ РїРѕР·РёС†РёРё РєРѕРЅС‚РµР№РЅРµСЂР°.
      tl.to(
        top,
        { duration: 0.22, scale: 1.0, x: 88, ease: "power2.out" },
        "<",
      );
      tl.to(
        bottom,
        { duration: 0.22, scale: 1.0, x: 88, ease: "power2.out" },
        "<0.02",
      );

      // 6) РјР°С‚РµСЂРёРЅСЃРєР°СЏ СЃР»РµРіРєР° вЂњСѓСЃРїРѕРєРѕРёР»Р°СЃСЊвЂќ
      tl.to(main, { scale: 1.0, duration: 0.18 }, "<0.08");

      // Р’СЃС‘.
    }

    // ---- Mount ----
    // Р§Р°С‚ РѕСЃС‚Р°С‘С‚СЃСЏ РІ body (fixed-РїР°РЅРµР»СЊ). Launcher: РІ #top РµСЃР»Рё РµСЃС‚СЊ, РёРЅР°С‡Рµ РїР»Р°РІР°СЋС‰РёР№.
    if (mountInHeader) {
      const computed = window.getComputedStyle(headerMount);
      if (!computed.position || computed.position === "static") {
        headerMount.style.position = "relative";
      }

      btn.classList.add("aiw-button--header");

      btn.innerHTML = `


      <div class="aiw-header-wrap">


      <div class="aiw-hc aiw-hc--main" aria-label="Open chat">
  
   


      </div>
      </div>

  `;

      const mainCircle = btn.querySelector(".aiw-hc--main");
      const waiterCircle = btn.querySelector(".aiw-hc--waiter");
      const billCircle = btn.querySelector(".aiw-hc--bill");

      // Capture the вЂњdropsвЂќ wrapper so we can physically move it into the chat header
      headerWrapEl = btn.querySelector(".aiw-header-wrap");
      headerWrapHome = btn;

      const openChat = (e) => {
        if (e) e.stopPropagation();
        toggleChat(true); // РіР°СЂР°РЅС‚РёСЂРѕРІР°РЅРЅРѕ РѕС‚РєСЂС‹С‚СЊ
      };
/*
      mainCircle.addEventListener("click", (e) => {
        console.log("mainCircle clicked");

        e.preventDefault();
        e.stopPropagation();

        // When the drops are already inside chat header, the main drop closes chat
        if (headerWrapInChat) toggleChat(false);
        else toggleChat(true);
      });

      // Р’ header-СЂРµР¶РёРјРµ РќР• РІРµС€Р°РµРј btn.click -> toggleChat,
      // РёРЅР°С‡Рµ Р±СѓРґРµС‚ РґРІРѕР№РЅРѕР№ РєР»РёРє Рё РіР»СЋРєРё СЃ СЂРµС‚Р°СЂРіРµС‚РѕРј СЃРѕР±С‹С‚РёР№.

      waiterCircle.addEventListener("click", (e) => {
        e.stopPropagation();
        openQuickAction("call_waiter");
      });

      billCircle.addEventListener("click", (e) => {
        e.stopPropagation();
        openQuickAction("request_bill");
      });
*/
      headerMount.appendChild(btn);
    } else {
      
    }

    document.body.appendChild(chat);

    // ---- DRAG ----
    let isPointerDown = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;

    if (!mountInHeader) {
      btn.addEventListener("pointerdown", (e) => {
        isPointerDown = true;
        isDragging = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = btn.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        // РїРµСЂРµС…РѕРґРёРј РЅР° left/top, С‡С‚РѕР±С‹ СЃС‡РёС‚Р°С‚СЊ РѕС‚ РѕРєРЅР°
        btn.style.left = rect.left + "px";
        btn.style.top = rect.top + "px";
        btn.style.right = "auto";
        btn.style.bottom = "auto";

        btn.setPointerCapture(e.pointerId);
      });

      window.addEventListener("pointermove", (e) => {
        if (!isPointerDown) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging && Math.hypot(dx, dy) > 5) {
          isDragging = true;
        }

        if (!isDragging) return;

        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;

        const btnRect = btn.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // РѕРіСЂР°РЅРёС‡РёРІР°РµРј РІ РїСЂРµРґРµР»Р°С… РѕРєРЅР°
        const maxLeft = vw - btnRect.width;
        const maxTop = vh - btnRect.height;

        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        btn.style.left = newLeft + "px";
        btn.style.top = newTop + "px";
      });

      window.addEventListener("pointerup", (e) => {
        if (!isPointerDown) return;
        btn.releasePointerCapture(e.pointerId);

        // РµСЃР»Рё РЅРµ С‚Р°С‰РёР»Рё вЂ” СЌС‚Рѕ РєР»РёРє
        if (!isDragging) {
          toggleChat();
        }

        isPointerDown = false;
        isDragging = false;
      });
    } else {
      // Р’ С…РµРґРµСЂРµ вЂ” РѕР±С‹С‡РЅС‹Р№ РєР»РёРє
    }

    let __aiwScrollY = 0;
function applyMobileFullscreen(chatEl, enabled) {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;

  if (!enabled) {
    // cleanup inline styles
    chatEl.style.inset = "";
    chatEl.style.left = "";
    chatEl.style.right = "";
    chatEl.style.top = "";
    chatEl.style.bottom = "";
    chatEl.style.width = "";
    chatEl.style.maxWidth = "";
    chatEl.style.height = "";
    chatEl.style.maxHeight = "";
    chatEl.style.borderRadius = "";
    return;
  }

  chatEl.style.position = "fixed";
  chatEl.style.inset = "0";
  chatEl.style.width = "100%";
  chatEl.style.maxWidth = "100%";
  chatEl.style.height = `${h}px`;      // РІР°Р¶РЅРµРµ С‡РµРј 100vh РІ iOS webview
  chatEl.style.maxHeight = "none";
  chatEl.style.borderRadius = "0";
}
function lockPageScroll() {
  __aiwScrollY = window.scrollY || window.pageYOffset || 0;
  document.documentElement.classList.add("aiw-scroll-lock");
  document.body.classList.add("aiw-scroll-lock");
  document.body.style.top = `-${__aiwScrollY}px`;
}

function unlockPageScroll() {
  document.documentElement.classList.remove("aiw-scroll-lock");
  document.body.classList.remove("aiw-scroll-lock");
  const y = __aiwScrollY;
  document.body.style.top = "";
  window.scrollTo(0, y);
}

    // ---- РћС‚РєСЂС‹С‚РёРµ/Р·Р°РєСЂС‹С‚РёРµ С‡Р°С‚Р° ----
    window.toggleChat = function (forceOpen) {
      // Was chat already open before this call?
      const wasOpen = chat.style.display !== "none";

      const canvas = document.getElementById('canvas-rive');

      if (canvas && forceOpen) {
        canvas.style.position = 'fixed';
        canvas.style.zIndex = '999998';
        canvas.style.top = '0';
      }else {
        if (canvas) {
          canvas.style.margin = 'auto';
          canvas.style.position = 'relative';
          canvas.style.zIndex = '1';
          canvas.style.top = 'initial';
        }
      }

      const shouldOpen =
        typeof forceOpen === "boolean"
          ? forceOpen
          : chat.style.display === "none";

      chat.style.display = shouldOpen ? "flex" : "none";

      const vv = window.visualViewport;
      const vw = vv ? vv.width : window.innerWidth;

      const isMobile =
        (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
        vw <= 820; // запас, потому что WebView/scale может давать странные числа

      if (isMobile) {
        if (shouldOpen) {
          lockPageScroll();
          applyMobileFullscreen(chat, true);
        } else {
          applyMobileFullscreen(chat, false);
          unlockPageScroll();
        }
      }

      // Init / cleanup mobile keyboard fix
if (shouldOpen) {
  if (!kbFixCleanup) kbFixCleanup = bindMobileKeyboardFix(chat);
} else {
  if (kbFixCleanup) kbFixCleanup();
  kbFixCleanup = null;
}

      // ensure cart overlay never auto-opens
      if (typeof closeCartOverlay === "function") {
        if (!shouldOpen) closeCartOverlay();
        else closeCartOverlay();
      }

      if (mountInHeader) {
        btn.classList.toggle("aiw-open", shouldOpen);

        if (shouldOpen) {
          // Let browser paint chat before FLIP move
          requestAnimationFrame(() => moveHeaderWrapIntoChat());
        } else {
          moveHeaderWrapBackToPage();
        }
      }

      if (shouldOpen) {
        // If chat was already open, don't re-run on-open logic (prevents duplicate greetings)
        if (wasOpen) {
          if (kbFixCleanup) {
    // trigger reflow in case keyboard behavior changed
    // (apply runs on focus anyway, but keep it safe)
  }
          input.focus();
          return;
        }

        renderMiniCart(
          lastOrderDraft &&
            Array.isArray(lastOrderDraft.items) &&
            lastOrderDraft.items.length
            ? lastOrderDraft
            : null,
        );
        input.focus();

        const wasWelcome1Shown = localStorage.getItem(WELCOME_LS_KEY) === "1";

        if (wasWelcome1Shown) {
          // Welcome 2: show only once per browser tab session (and never on repeated open calls)
          const wasWelcome2Shown =
            sessionStorage.getItem(WELCOME2_SS_KEY) === "1";
          if (!wasWelcome2Shown) {
            // Set flag BEFORE the async call to avoid race duplicates
            sessionStorage.setItem(WELCOME2_SS_KEY, "1");
            showGreetingEveryOpen();
          }
        } else {
          // Welcome 1: explain features (only once per device)
          showWelcomeOnce();
        }
      }
    };

    const SUGGEST_MIN_LEN = 2;

    function debounce(fn, delay) {
      let timer = null;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
      };
    }

    function renderSuggestions(items) {
      suggestionsEl.innerHTML = "";
      rememberImagesFromList(items || []);

      if (!items || !items.length) {
        suggestionsEl.style.display = "none";
        return;
      }

      suggestionsEl.style.display = "block";

      const track = document.createElement("div");
      track.className = "aiw-suggestions-track";

      items.forEach((item) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "aiw-suggestion-card";

        const suggestionImg = pickImageUrl(item);
        if (suggestionImg) {
          const img = document.createElement("img");
          img.className = "aiw-suggestion-image";
          img.src = suggestionImg;
          img.alt = item.name || item.item_code || "";
          card.appendChild(img);
        }

        const info = document.createElement("div");
        info.className = "aiw-suggestion-info";

        const title = document.createElement("div");
        title.className = "aiw-suggestion-name";
        title.textContent = item.name || item.item_code;

        const price = document.createElement("div");
        price.className = "aiw-suggestion-price";
        if (item.price != null) {
          price.textContent = item.price.toFixed
            ? item.price.toFixed(2) + " $"
            : String(item.price);
        }

        info.appendChild(title);
        info.appendChild(price);

        card.appendChild(info);

        card.addEventListener("click", () => {
          const suggestionText = item.name || item.item_code || "";

          // РўРµРєСѓС‰РёР№ С‚РµРєСЃС‚ РІ РёРЅРїСѓС‚Рµ
          const current = input.value || "";

          let next;
          if (!current.trim()) {
            // Р•СЃР»Рё РёРЅРїСѓС‚ РїСѓСЃС‚РѕР№ вЂ” РїСЂРѕСЃС‚Рѕ РїРѕРґСЃС‚Р°РІР»СЏРµРј РїРѕРґСЃРєР°Р·РєСѓ
            next = suggestionText;
          } else {
            // Р•СЃР»Рё СѓР¶Рµ РµСЃС‚СЊ С‚РµРєСЃС‚ вЂ” Р°РєРєСѓСЂР°С‚РЅРѕ РґРѕР±Р°РІР»СЏРµРј С‡РµСЂРµР· РїСЂРѕР±РµР»
            const needsSpace = !current.endsWith(" ");
            next = current + (needsSpace ? " " : "") + suggestionText;
          }

          input.value = next;
          input.focus();

          const len = input.value.length;
          if (input.setSelectionRange) {
            input.setSelectionRange(len, len);
          }

          // РЎРєСЂС‹РІР°РµРј РїРѕРґСЃРєР°Р·РєРё РїРѕСЃР»Рµ РІС‹Р±РѕСЂР° (РїРѕ Р¶РµР»Р°РЅРёСЋ)
          renderSuggestions([]);
        });

        track.appendChild(card);
      });

      suggestionsEl.appendChild(track);
    }

    async function fetchSuggestionsForQuery(query) {
      const trimmed = query.trim();
      if (!trimmed || trimmed.length < SUGGEST_MIN_LEN) {
        renderSuggestions([]);
        return;
      }

      if (!sessionToken) {
        // Р±РµР· СЃРµСЃСЃРёРё РїРѕРґСЃРєР°Р·РєРё РЅРµ СЂР°Р±РѕС‚Р°РµРј (РЅСѓР¶РµРЅ restaurant_id)
        renderSuggestions([]);
        return;
      }

      try {
        const params = new URLSearchParams({
          q: trimmed,
          locale: USER_LOCALE,
          limit: "6",
        });

        const res = await fetch(
          `${API_BASE}/menu/suggest?` + params.toString(),
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "x-session-token": sessionToken,
            },
            credentials: "include",
          },
        );

        if (!res.ok) {
          console.warn("Suggest API error", res.status);
          renderSuggestions([]);
          return;
        }

        const data = await res.json();
        if (!Array.isArray(data)) {
          renderSuggestions([]);
          return;
        }

        renderSuggestions(data);
      } catch (err) {
        console.error("Suggest fetch error", err);
        renderSuggestions([]);
      }
    }

    const debouncedSuggest = debounce(fetchSuggestionsForQuery, 250);

    // ---- РћС‚РїСЂР°РІРєР° СЃРѕРѕР±С‰РµРЅРёР№ ----

    sendBtn.addEventListener("click", handleSend);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    });

    // рџ‘‰ Р’РћРў Р­РўРћ Р”РћР‘РђР’Р›РЇР•Рњ Р”Р›РЇ РџРћР”РЎРљРђР—РћРљ
  }

  async function playAssistantTTS(text) {
    try {
      if (!text || !text.trim()) return;

      const resp = await fetch(`${API_BASE}/voice/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text,
          voice: "alloy", // РїРѕС‚РѕРј РјРѕР¶РЅРѕ СЃРґРµР»Р°С‚СЊ РЅР°СЃС‚СЂРѕР№РєРѕР№
        }),
      });

      if (!resp.ok) {
        console.error("[Voice] TTS HTTP error", resp.status);
        return;
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    } catch (err) {
      console.error("[Voice] TTS error:", err);
    }
  }

  // ---------- РћС‚РїСЂР°РІРєР° Р·Р°РїСЂРѕСЃРѕРІ РІ backend ----------

  async function sendMessageToBackend(message) {
    if (!sessionToken) {
      appendSystemMessage(
        "Сесія ще не готова. Зачекайте пару секунд або оновіть сторінку.",
      );
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/chat/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-token": sessionToken,
        },
        body: JSON.stringify({
          text: message,
          client_language: USER_LOCALE || null,
        }),
        credentials: "include",
      });

      if (!res.ok) {
        console.error("Chat request failed", await res.text());
        appendSystemMessage("Помилка при надсиланні повідомлення до AI-офіціанта.");
        return;
      }

      const data = await res.json();

      const replyText = data.replyText || data.reply || "";

      const orderDraft = data.orderDraft || null;
      const upsell = data.upsell || null;
      const recommendations = data.recommendations || null;
      rememberImagesFromList(recommendations || []);
      if (upsell && Array.isArray(upsell.items)) rememberImagesFromList(upsell.items);
      if (orderDraft && Array.isArray(orderDraft.items)) rememberImagesFromList(orderDraft.items);

      if (replyText) {
        if (
          recommendations &&
          Array.isArray(recommendations) &&
          recommendations.length > 0
        ) {
          appendBotMessageWithRecommendations(replyText, recommendations);
        } else if (
          orderDraft &&
          Array.isArray(orderDraft.items) &&
          orderDraft.items.length > 0
        ) {
          appendBotMessageWithOrder(replyText, orderDraft);
        } else {
          appendBotMessage(replyText);
        }

        if (lastRequestFromVoice) {
          playAssistantTTS(replyText);
        }
      } else {
        appendSystemMessage("Сервер не відповів текстом.");
      }

      // РћС‚РґРµР»СЊРЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РґР»СЏ Р°РїСЃРµР»Р»Р°, РµСЃР»Рё РѕРЅ РµСЃС‚СЊ
      if (upsell && Array.isArray(upsell.items) && upsell.items.length > 0) {
        appendUpsellMessage(upsell);
      }

      // cart-first UX: if backend explicitly returned draft (even empty) вЂ” sync mini-cart
            if (Object.prototype.hasOwnProperty.call(data, "orderDraft")) {
        const d0 = data.orderDraft || null;
        const d1 = normalizeOrderDraftImages(d0);
        const d = mergeOrderDraftPreservingMedia(lastOrderDraft, d1);

        lastOrderDraft = d; // keep draft in state
        const nd = d && Array.isArray(d.items) && d.items.length ? d : null;
        renderMiniCart(nd);
        if (typeof renderCartOverlay === "function") renderCartOverlay(nd);
      }
    } catch (err) {
      console.error("Error in sendMessageToBackend", err);
      appendSystemMessage("Помилка при надсиланні повідомлення до AI-офіціанта.");
    }
  }

  // Prevent duplicate UI update requests for the same item while a request is in-flight
  const __aiwUiUpdateInFlight = new Set();

  async function callOrderUiUpdate(orderId, operation) {
    if (!sessionToken) {
      appendSystemMessage(
        "Сесія ще не готова. Зачекайте пару секунд або оновіть сторінку.",
      );
      return null;
    }

    // Deduplicate UI updates for the same operation/item while a request is in-flight.
    // This prevents double "remove" / rapid clicks from producing ORDER_ITEM_NOT_FOUND.
    const opType =
      operation && operation.type ? String(operation.type) : "unknown";
    const opItemId =
      operation && operation.order_item_id
        ? String(operation.order_item_id)
        : "";
    const opCode =
      operation && operation.item_code ? String(operation.item_code) : "";
    const dedupeKey = `${opType}:${opItemId || opCode}`;

    if (dedupeKey !== "unknown:" && __aiwUiUpdateInFlight.has(dedupeKey)) {
      return null;
    }
    if (dedupeKey !== "unknown:") __aiwUiUpdateInFlight.add(dedupeKey);

    try {
      const res = await fetch(`${API_BASE}/order/ui-update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-token": sessionToken,
        },
        body: JSON.stringify({
          ...(operation || {}),
          language: USER_LOCALE || null,
        }),
      });

      if (!res.ok) {
        const raw = await res.text();
        let errObj = null;
        try {
          errObj = JSON.parse(raw);
        } catch (_) {}

        // If we are removing an item that is already gone on the server, treat as success.
        if (
          opType === "remove" &&
          errObj &&
          errObj.error === "ORDER_ITEM_NOT_FOUND"
        ) {
          return lastOrderDraft || null;
        }

        console.error("UI update failed", errObj || raw);
        appendSystemMessage("Помилка при оновленні замовлення.");
        return null;
      }

            const data = await res.json();
      if (data?.orderDraft && Array.isArray(data.orderDraft.items)) {
        rememberImagesFromList(data.orderDraft.items);
      }
      const d0 = data.orderDraft || null;
      const d1 = normalizeOrderDraftImages(d0);
      const d = mergeOrderDraftPreservingMedia(lastOrderDraft, d1);

      // If backend returned upsell on UI update вЂ” show it as separate bot message.
      const upsell = data.upsell || null;
      if (upsell && Array.isArray(upsell.items) && upsell.items.length > 0) {
        rememberImagesFromList(upsell.items);
        appendUpsellMessage(upsell);
      }

      return d;
    } catch (err) {
      console.error("Error in callOrderUiUpdate", err);
      appendSystemMessage("Помилка при оновленні замовлення.");
      return null;
    } finally {
      if (dedupeKey !== "unknown:") __aiwUiUpdateInFlight.delete(dedupeKey);
    }
  }

  async function callOrderSubmit(orderId) {
    if (!sessionToken) {
      appendSystemMessage(
        "Сесія ще не готова. Зачекайте пару секунд або оновіть сторінку.",
      );
      return null;
    }

    try {
      const res = await fetch(`${API_BASE}/order/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-token": sessionToken,
        },
        body: JSON.stringify({ order_id: orderId }),
        credentials: "include",
      });

      if (!res.ok) {
        console.error("Order submit failed", await res.text());
        appendSystemMessage("Помилка при відправленні замовлення офіціанту.");
        return null;
      }

      const data = await res.json();
      return data;
    } catch (err) {
      console.error("Error in callOrderSubmit", err);
      appendSystemMessage("Помилка при відправленні замовлення офіціанту.");
      return null;
    }
  }

  function rerenderOrderDraftElement(wrapperEl, orderDraft) {
    if (!wrapperEl) return;

    if (
      !orderDraft ||
      !Array.isArray(orderDraft.items) ||
      orderDraft.items.length === 0
    ) {
      wrapperEl.remove();
      lastOrderDraft = null;
      lastOrderDraftEl = null;
      renderMiniCart(null);
      if (typeof renderCartOverlay === "function") renderCartOverlay(null);
      return;
    }

    wrapperEl.innerHTML = "";
    wrapperEl.dataset.orderId = orderDraft.id;
    wrapperEl._orderDraft = orderDraft;

    const list = document.createElement("div");
    list.className = "aiw-order-items";

    orderDraft.items.forEach((item) => {
      list.appendChild(createOrderItemCard(item));
    });

    wrapperEl.appendChild(list);

    // submit button
    const submitBtn = document.createElement("button");
    submitBtn.className = "aiw-order-submit";
    submitBtn.innerHTML =
      '<span class="aiw-draft-submit-icon" aria-hidden="true"></span>';
    submitBtn.title = "Перейти в кошик (підтвердження та відправка — таємно)";

    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openCartOverlay === "function") openCartOverlay();
      try {
        if (miniCartEl) {
          miniCartEl.classList.add("aiw-pulse");
          setTimeout(
            () => miniCartEl && miniCartEl.classList.remove("aiw-pulse"),
            650,
          );
        }
      } catch (_) {}
    });

    wrapperEl.appendChild(submitBtn);

    // sync state + mini-cart once
    lastOrderDraft = orderDraft;
    lastOrderDraftEl = wrapperEl;
    renderMiniCart(orderDraft);
    if (typeof renderCartOverlay === "function") renderCartOverlay(orderDraft);
  }

  // ---------- РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ ----------

  async function init() {
    createStyles();
    await loadUiTextsOnce();
    createButtonAndChat();
    await initSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
