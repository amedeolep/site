import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const ROOT_SELECTOR = "[data-pdf-stack]";
const INIT_ATTR = "data-pdf-stack-initialized";

const roots = new Set();

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function isInDom(el) {
  return el && document.contains(el);
}

async function waitForWidth(el) {
  for (let i = 0; i < 120; i++) {
    const w = el.clientWidth;
    if (w && w > 1) return w;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return Math.max(1, el.clientWidth || 1);
}

function buildSlot(pageNum, aspect) {
  const slot = document.createElement("div");
  slot.className = "pdfPage";
  slot.dataset.page = String(pageNum);
  if (aspect) slot.style.aspectRatio = String(aspect);
  return slot;
}

async function initOne(root) {
  if (!root || root.hasAttribute(INIT_ATTR)) return;

  root.setAttribute(INIT_ATTR, "1");
  roots.add(root);

  const pdfUrl = root.dataset.pdfSrc;
  if (!pdfUrl) {
    root.innerHTML = '<p class="pdfError">Missing PDF source.</p>';
    return;
  }

  const state = {
    pdf: null,
    numPages: 0,
    pageAspect: null,
    rendered: new Set(),
    rendering: new Set(),
    io: null,
    rerenderRenderedPages: null,
  };

  root.__pdfStackState = state;

  const cssWidthPx = () => Math.max(1, root.clientWidth);

  async function renderPageInto(slot, pageNum, force = false) {
    if (!force && state.rendered.has(pageNum)) return;
    if (state.rendering.has(pageNum)) return;

    state.rendering.add(pageNum);

    try {
      const page = await state.pdf.getPage(pageNum);

      const base = page.getViewport({ scale: 1 });
      const scaleCss = cssWidthPx() / base.width;

      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scaleCss * dpr });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

      slot.innerHTML = "";
      slot.style.aspectRatio = "auto";
      slot.appendChild(canvas);

      await page.render({ canvasContext: ctx, viewport }).promise;

      state.rendered.add(pageNum);
    } catch (err) {
      console.error(err);
      slot.innerHTML = '<p class="pdfError">Failed to render page.</p>';
    } finally {
      state.rendering.delete(pageNum);
    }
  }

  function setupIntersectionObserver() {
    if (state.io) state.io.disconnect();

    state.io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const slot = entry.target;
          const pageNum = Number(slot.dataset.page);
          renderPageInto(slot, pageNum);
        }
      },
      { root: null, rootMargin: "800px 0px", threshold: 0.01 }
    );

    root.querySelectorAll(".pdfPage").forEach((el) => state.io.observe(el));
  }

  try {
    await waitForWidth(root);

    const task = pdfjsLib.getDocument({ url: pdfUrl });
    state.pdf = await task.promise;
    state.numPages = state.pdf.numPages;

    const p1 = await state.pdf.getPage(1);
    const vp1 = p1.getViewport({ scale: 1 });
    state.pageAspect = vp1.width / vp1.height;

    const frag = document.createDocumentFragment();
    for (let i = 1; i <= state.numPages; i++) {
      frag.appendChild(buildSlot(i, state.pageAspect));
    }
    root.appendChild(frag);

    setupIntersectionObserver();

    state.rerenderRenderedPages = debounce(async () => {
      if (!isInDom(root)) return;
      if (!state.pdf) return;

      await waitForWidth(root);

      const already = Array.from(state.rendered);
      state.rendered.clear();

      for (const pageNum of already) {
        const slot = root.querySelector(`.pdfPage[data-page="${pageNum}"]`);
        if (slot) await renderPageInto(slot, pageNum, true);
      }
    }, 150);
  } catch (err) {
    console.error(err);
    root.innerHTML = '<p class="pdfError">Failed to load the PDF.</p>';
  }
}

function initAll() {
  document.querySelectorAll(ROOT_SELECTOR).forEach((el) => initOne(el));
}

if (!window.__pdfStackResizeHooked) {
  window.__pdfStackResizeHooked = true;

  window.addEventListener(
    "resize",
    debounce(() => {
      for (const r of Array.from(roots)) {
        if (!isInDom(r)) roots.delete(r);
      }
      for (const r of roots) {
        const st = r.__pdfStackState;
        if (st && st.rerenderRenderedPages) st.rerenderRenderedPages();
      }
    }, 150),
    { passive: true }
  );
}

// Works on initial load and Astro client-side navigation
document.addEventListener("astro:page-load", initAll);
initAll();
