// public/scripts/argentinaJourney.js
// Handles: hover preview popup, pinned popup, and full screen gallery panel.
// Uses body position: fixed scroll locking to avoid "jump to top".

export function initArgentinaJourney() {
  const root = document.getElementById("journeyRoot");
  if (!root) return;

  if (root.dataset.bound === "true") return;
  root.dataset.bound = "true";

  const dataEl = document.getElementById("journeyData");
  let data = [];
  try {
    data = JSON.parse(dataEl?.textContent || "[]");
  } catch {
    data = [];
  }

  const popup = document.getElementById("journeyPopup");
  const popupTitle = document.getElementById("popupTitle");
  const popupThumb = document.getElementById("popupThumb");
  const popupBlurb = document.getElementById("popupBlurb");

  const panel = document.getElementById("journeyPanel");
  const panelInner = document.getElementById("journeyPanelInner");
  const panelTitle = document.getElementById("panelTitle");
  const galleryImage = document.getElementById("galleryImage");
  const galleryCaption = document.getElementById("galleryCaption");
  const galleryCounter = document.getElementById("galleryCounter");

  const pinEls = Array.from(root.querySelectorAll(".journeyPin"));

  const state = {
    hoverId: null,
    pinnedId: null,
    openId: null,
    photoIndex: 0,
    popupHover: false,
    hideTimer: null,
    lockRect: null,
    activeId: null,

    scrollY: 0,
    scrollbarPad: 0,
    isScrollLocked: false,
  };

  // Force panel closed on init
  if (panel) {
    panel.classList.remove("isOpen");
    panel.setAttribute("aria-hidden", "true");
  }
  document.documentElement.classList.remove("galleryOpen");
  unlockScroll();

  function getLoc(id) {
    for (let i = 0; i < data.length; i++) {
      if (data[i]?.id === id) return data[i];
    }
    return null;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function measurePopup() {
    if (!popup) return { w: 0, h: 0 };
    const prevHidden = popup.hidden;
    popup.hidden = false;
    const r = popup.getBoundingClientRect();
    popup.hidden = prevHidden;
    return { w: r.width, h: r.height };
  }

  function positionPopupNearPinRect(pinRect, preferSide = "right") {
    if (!popup || !pinRect) return;

    popup.style.left = "0px";
    popup.style.top = "0px";
    popup.hidden = false;

    const { w: popupW, h: popupH } = measurePopup();
    const margin = 10;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const anchorX = pinRect.left + pinRect.width / 2;
    const anchorY = pinRect.top + pinRect.height / 2;

    const offsetX = 18;
    const offsetY = -12;

    let left =
      preferSide === "left" ? anchorX - popupW - offsetX : anchorX + offsetX;
    let top = anchorY + offsetY;

    if (left + popupW > viewportW - margin) left = anchorX - popupW - offsetX;
    if (left < margin) left = anchorX + offsetX;

    left = clamp(left, margin, viewportW - popupW - margin);
    top = clamp(top, margin, viewportH - popupH - margin);

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  function ensureActive(id) {
    if (state.activeId !== id) {
      state.activeId = id;
      state.photoIndex = 0;
    }
  }

  function getGallery(loc) {
    return Array.isArray(loc?.gallery) ? loc.gallery : [];
  }

  function updatePopupMedia(id) {
    const loc = getLoc(id);
    if (!loc || !popup) return;

    const gallery = getGallery(loc);
    const total = gallery.length;

    state.photoIndex = total > 0 ? clamp(state.photoIndex, 0, total - 1) : 0;

    const item = total > 0 ? gallery[state.photoIndex] || {} : {};
    const src =
      item.image ||
      (loc.preview && loc.preview.image) ||
      "/docs/argentina/placeholder.png";

    if (popupThumb) {
      const current = popupThumb.getAttribute("src") || "";
      if (current !== src) popupThumb.src = src;
      popupThumb.alt = `${loc.label || "Location"} preview`;
    }

    const prevBtn = popup.querySelector('[data-action="popup-prev"]');
    const nextBtn = popup.querySelector('[data-action="popup-next"]');
    const canNav = total > 1;

    if (prevBtn) prevBtn.toggleAttribute("disabled", !canNav);
    if (nextBtn) nextBtn.toggleAttribute("disabled", !canNav);
  }

  function showPopup(id, mode, pinEl) {
    const loc = getLoc(id);
    if (!loc || !popup) return;

    ensureActive(id);

    popup.dataset.mode = mode;
    if (popupTitle) popupTitle.textContent = loc.label || "";
    if (popupBlurb) popupBlurb.textContent = loc.preview?.blurb || "";

    if (!state.lockRect && pinEl) state.lockRect = pinEl.getBoundingClientRect();

    popup.hidden = false;
    updatePopupMedia(id);

    const rectToUse = state.lockRect || pinEl?.getBoundingClientRect();
    positionPopupNearPinRect(rectToUse, "right");
  }

  function hidePopupOnly() {
    if (!popup) return;
    popup.hidden = true;
    state.hoverId = null;
    state.pinnedId = null;
    state.lockRect = null;
  }

  function scheduleHidePopup() {
    if (state.pinnedId) return;
    if (state.hideTimer) window.clearTimeout(state.hideTimer);
    state.hideTimer = window.setTimeout(() => {
      if (!state.pinnedId && !state.popupHover) hidePopupOnly();
    }, 120);
  }

  function updateGallery() {
    if (!state.openId) return;
    const loc = getLoc(state.openId);
    if (!loc) return;

    const gallery = getGallery(loc);
    if (gallery.length === 0) return;

    const total = gallery.length;
    state.photoIndex = clamp(state.photoIndex, 0, total - 1);

    const item = gallery[state.photoIndex] || {};
    const src = item.image || "/docs/argentina/placeholder.png";
    const caption = item.caption || "";

    if (galleryImage) {
      galleryImage.src = src;
      galleryImage.alt = `${loc.label || "Location"}, photo ${state.photoIndex + 1}`;
    }
    if (galleryCaption) galleryCaption.textContent = caption;
    if (galleryCounter) galleryCounter.textContent = `Photo ${state.photoIndex + 1} of ${total}`;
  }

  function stepSharedGallery(dir) {
    const id = state.openId || state.pinnedId || state.hoverId || state.activeId;
    if (!id) return;

    const loc = getLoc(id);
    if (!loc) return;

    const gallery = getGallery(loc);
    if (gallery.length <= 1) return;

    ensureActive(id);

    const total = gallery.length;
    let next = state.photoIndex + dir;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    state.photoIndex = next;

    if (popup && !popup.hidden && (state.pinnedId || state.hoverId)) {
      updatePopupMedia(id);
    }
    if (state.openId) updateGallery();
  }

  function lockScroll() {
    if (state.isScrollLocked) return;

    const y = window.scrollY || window.pageYOffset || 0;
    state.scrollY = y;

    // Compensate for scrollbar disappearance
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    state.scrollbarPad = scrollbarW > 0 ? scrollbarW : 0;

    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    if (state.scrollbarPad) body.style.paddingRight = `${state.scrollbarPad}px`;

    state.isScrollLocked = true;
  }

  function unlockScroll() {
    if (!state.isScrollLocked) return;

    const body = document.body;
    const y = state.scrollY || 0;

    body.style.position = "";
    body.style.top = "";
    body.style.left = "";
    body.style.right = "";
    body.style.width = "";
    body.style.paddingRight = "";

    state.isScrollLocked = false;

    window.scrollTo(0, y);
  }

  function openPanel(id) {
    const loc = getLoc(id);
    if (!loc || !panel) return;

    ensureActive(id);
    state.openId = id;

    // Hide dock via global rule, and lock scroll without jumping
    document.documentElement.classList.add("galleryOpen");
    lockScroll();

    panel.classList.add("isOpen");
    panel.setAttribute("aria-hidden", "false");
    if (panelTitle) panelTitle.textContent = loc.label || "";

    updateGallery();
  }

  function closePanelOnly() {
    state.openId = null;
    if (!panel) return;

    panel.classList.remove("isOpen");
    panel.setAttribute("aria-hidden", "true");

    document.documentElement.classList.remove("galleryOpen");
    unlockScroll();
  }

  function pinElementById(id) {
    for (let i = 0; i < pinEls.length; i++) {
      if (pinEls[i].dataset.id === id) return pinEls[i];
    }
    return null;
  }

  pinEls.forEach((pinEl) => {
    const id = pinEl.dataset.id;

    pinEl.addEventListener("mouseenter", () => {
      if (state.pinnedId) return;
      state.hoverId = id;
      state.lockRect = pinEl.getBoundingClientRect();
      showPopup(id, "hover", pinEl);
    });

    pinEl.addEventListener("mouseleave", () => {
      if (state.pinnedId) return;
      scheduleHidePopup();
    });

    pinEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const wasHoveringSame = state.hoverId === id && popup && !popup.hidden;

      state.pinnedId = id;
      state.hoverId = null;

      if (!state.lockRect) state.lockRect = pinEl.getBoundingClientRect();

      if (wasHoveringSame) {
        popup.dataset.mode = "pinned";
        positionPopupNearPinRect(state.lockRect, "right");
        return;
      }

      showPopup(id, "pinned", pinEl);
    });
  });

  popup?.addEventListener("mouseenter", () => {
    state.popupHover = true;
    if (state.hideTimer) window.clearTimeout(state.hideTimer);
  });

  popup?.addEventListener("mouseleave", () => {
    state.popupHover = false;
    if (!state.pinnedId) hidePopupOnly();
  });

  root.addEventListener("click", (e) => {
    const t = e.target;
    if (!t) return;

    const actionEl = t.closest ? t.closest("[data-action]") : null;
    if (!actionEl) return;

    const action = actionEl.getAttribute("data-action");

    if (action === "close-popup") {
      e.preventDefault();
      hidePopupOnly();
      return;
    }

    if (action === "popup-prev") {
      e.preventDefault();
      stepSharedGallery(-1);
      return;
    }

    if (action === "popup-next") {
      e.preventDefault();
      stepSharedGallery(1);
      return;
    }

    if (action === "see-location") {
      e.preventDefault();
      const id = state.pinnedId || state.hoverId || state.activeId;
      if (!id) return;

      openPanel(id);
      hidePopupOnly();
      return;
    }

    if (action === "close-panel") {
      e.preventDefault();
      closePanelOnly();
      return;
    }

    if (action === "prev") {
      e.preventDefault();
      stepSharedGallery(-1);
      return;
    }

    if (action === "next") {
      e.preventDefault();
      stepSharedGallery(1);
      return;
    }
  });

  // Backdrop click closes panel
  panel?.addEventListener("click", (e) => {
    if (!panelInner) return;
    if (e.target === panel) closePanelOnly();
  });

  document.addEventListener("keydown", (e) => {
    if (!document.body.contains(root)) return;

    if (e.key === "Escape") {
      if (panel && panel.classList.contains("isOpen")) {
        closePanelOnly();
        return;
      }
      if (popup && !popup.hidden) {
        hidePopupOnly();
        return;
      }
      return;
    }

    if (!panel || !panel.classList.contains("isOpen")) return;

    if (e.key === "ArrowLeft") stepSharedGallery(-1);
    if (e.key === "ArrowRight") stepSharedGallery(1);
  });

  const reflow = () => {
    if (!popup || popup.hidden) return;
    if (!state.lockRect) return;

    const id = state.pinnedId || state.hoverId;
    const pinEl = id ? pinElementById(id) : null;
    if (pinEl) state.lockRect = pinEl.getBoundingClientRect();

    positionPopupNearPinRect(state.lockRect, "right");
  };

  window.addEventListener("resize", reflow, { passive: true });
  window.addEventListener("scroll", reflow, { passive: true });
}

if (typeof document !== "undefined") {
  document.addEventListener("astro:page-load", initArgentinaJourney);
  document.addEventListener("astro:after-swap", initArgentinaJourney);
}
