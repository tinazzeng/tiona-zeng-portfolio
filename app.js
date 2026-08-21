/* The public site and editor share one hosted archive, with a small local backup. */
const STORAGE_KEY = "tiona-portfolio";
const LEGACY_STORAGE_KEY = "moss-archive";
const CONTENT_TABLE = "portfolio_content";
const MEDIA_BUCKET = "portfolio-media";
const isAdmin = location.pathname.replace(/\/+$/, "") === "/applepie";
const app = document.querySelector("#app");
const modal = document.querySelector("#editor-modal");
const cursor = document.querySelector(".cursor-orb");
const supabaseConfig = window.SUPABASE_CONFIG || {};
const sb = window.supabase && supabaseConfig.url && supabaseConfig.publishableKey
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey)
  : null;
let editingId = null;
let currentUser = null;
let archiveOwner = null;
let pendingMediaFiles = [];
let mediaLibrary = [];
let mediaLibraryLoaded = false;
let mediaLibraryMessage = "";
const recoveryHash = new URLSearchParams(location.hash.slice(1));
const recoveryQuery = new URLSearchParams(location.search);
let isRecoveringPassword = recoveryHash.get("type") === "recovery" || recoveryQuery.has("code");
let recoveryLinkError = "";

const defaults = {
  studioName: "Tiona Zeng",
  accent: "#f2d591",
  about: "I’m a student artist making pictures, poems, and playful things for the internet. I’m interested in soft colors, hard feelings, and the little worlds we carry around with us.",
  email: "tinazeng16@gmail.com",
  annotations: [
    "student artist | I’m currently studying, experimenting, and building an archive as I go.",
    "soft colors | I keep returning to colors that feel like a memory.",
    "little worlds | A collection of tiny details, feelings, and references that shape each project."
  ],
  links: { linkedin: "", rednote: "", instagram: "", resume: "" },
  projects: [],
  archiveCleared: true
};

const labels = { "fine-art": "Fine art", writing: "Writing", projects: "Design" };
const listingCopy = {
  "fine-art": "A home for my experiments and artworks. I particularly love to play with color theory, and I like to incorporate written elements.",
  writing: "Words will always be my first love, my favorite medium. I prefer English; incorporate Mandarin Chinese; and occasionally explore Japanese.",
  projects: "Selected design work that I produced for “clients” such companies, clubs, and other such organizations."
};
const fallbackReading = [
  { title: "In the Woods", author: "Tana French", url: "https://www.goodreads.com/book/show/2459785.In_the_Woods" },
  { title: "Abundance", author: "Ezra Klein", url: "https://www.goodreads.com/book/show/176444106-abundance" }
];
const socialIcons = {
  linkedin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg>',
  rednote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect width="20" height="20" x="2" y="2" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/></svg>',
  resume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"/></svg>'
};

function cloneDefaults() { return structuredClone(defaults); }

function normalizeArchive(candidate) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const archive = { ...cloneDefaults(), ...source, links: { ...defaults.links, ...(source.links || {}) } };
  archive.annotations = Array.isArray(source.annotations) ? source.annotations : defaults.annotations;
  archive.projects = Array.isArray(source.projects) ? source.projects : [];
  return archive;
}

function loadArchive() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
    if (!saved) return cloneDefaults();
    const archive = normalizeArchive(saved);
    // One deliberate migration: the demo archive is removed once for every browser.
    if (!archive.archiveCleared) { archive.projects = []; archive.archiveCleared = true; }
    return archive;
  } catch { return cloneDefaults(); }
}

let data = loadArchive();

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function externalUrl(value = "") {
  const url = String(value || "").trim();
  if (!url || /^(https?:|mailto:)/i.test(url)) return url;
  return `https://${url.replace(/^\/+/, "")}`;
}

function isVideoSource(source = "") {
  return /^data:video\//i.test(source) || /\.mp4(?:[?#].*)?$/i.test(source);
}

function isPdfSource(source = "") {
  return /^data:application\/pdf/i.test(source) || /\.pdf(?:[?#].*)?$/i.test(source);
}

function projectImages(project) {
  const items = Array.isArray(project?.gallery) && project.gallery.length
    ? project.gallery
    : (Array.isArray(project?.images) ? project.images : []);
  return items.map(item => {
    const media = typeof item === "string" ? { src: item, caption: "" } : item;
    return { ...media, type: media.type || (isPdfSource(media.src) ? "pdf" : isVideoSource(media.src) ? "video" : "image") };
  }).filter(media => media?.src);
}

function mediaKind(source = "") {
  return isPdfSource(source) ? "pdf" : isVideoSource(source) ? "video" : "image";
}

function storagePathFromUrl(source = "") {
  try {
    const marker = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
    const path = new URL(source).pathname;
    return path.includes(marker) ? decodeURIComponent(path.split(marker)[1]) : "";
  } catch {
    return "";
  }
}

function mediaName(source = "") {
  const name = source.split("/").pop()?.split("?")[0] || "untitled upload";
  try { return decodeURIComponent(name).replace(/^\d+-[\da-f-]+-/, ""); }
  catch { return name.replace(/^\d+-[\da-f-]+-/, ""); }
}

function storedMedia(projects = data.projects) {
  const known = new Map();
  projects.forEach(project => {
    const sources = [project.image, ...projectImages(project).map(item => item.src)].filter(Boolean);
    sources.forEach(src => {
      if (!known.has(src)) known.set(src, { src, path: storagePathFromUrl(src), type: mediaKind(src), projects: [] });
      if (!known.get(src).projects.includes(project.title)) known.get(src).projects.push(project.title);
    });
  });
  return [...known.values()];
}

function richText(value = "") {
  return escapeHtml(value)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br />");
}

function saveLocalArchive() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Large embedded font files can exceed a browser's local-storage quota.
    const lightweightArchive = { ...data };
    delete lightweightArchive.font;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lightweightArchive)); }
    catch { /* The hosted archive remains the source of truth. */ }
  }
  applyTheme();
}

async function hydrateArchive() {
  if (!sb) return;
  const { data: remote, error } = await sb
    .from(CONTENT_TABLE)
    .select("content, owner")
    .eq("id", "site")
    .maybeSingle();
  if (error) throw error;
  if (!remote) return;
  archiveOwner = remote.owner;
  data = normalizeArchive(remote.content);
  saveLocalArchive();
}

async function saveArchive() {
  saveLocalArchive();
  if (!sb) return;
  if (!currentUser) throw new Error("Sign in to save changes and upload media.");
  const { error } = await sb.from(CONTENT_TABLE).upsert({
    id: "site",
    content: data,
    owner: archiveOwner || currentUser.id,
    updated_at: new Date().toISOString()
  }, { onConflict: "id" });
  if (error) throw error;
  archiveOwner = archiveOwner || currentUser.id;
}

function applyTheme() {
  document.documentElement.style.setProperty("--accent", data.accent);
  document.title = isAdmin ? "Tiona Zeng — Studio Editor" : "tiona zeng — portfolio";
  let customFont = document.querySelector("#custom-font");
  if (data.font) {
    customFont ||= Object.assign(document.createElement("style"), { id: "custom-font" });
    customFont.textContent = `@font-face{font-family:StudioCustom;src:url(${data.font})}`;
    if (!customFont.isConnected) document.head.append(customFont);
    document.documentElement.style.setProperty("--display", 'StudioCustom, "Sneaky Times", serif');
  } else {
    customFont?.remove();
    document.documentElement.style.setProperty("--display", '"Sneaky Times", "Times New Roman", serif');
  }
  const wordmark = document.querySelector(".wordmark");
  if (wordmark) wordmark.innerHTML = `${escapeHtml(data.studioName).replace(" ", "<br />")}<span>✶</span>`;
  const emailLink = document.querySelector('footer a[href^="mailto:"]');
  if (emailLink && data.email) emailLink.href = `mailto:${data.email.trim()}`;
}

function createIcons() { window.lucide?.createIcons(); }
function emptyShelf() { return '<p class="empty">This shelf is ready for your work.</p>'; }

function card(project) {
  const cover = project.image
    ? `<img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.title)}" loading="lazy" decoding="async" />`
    : `<span class="card-placeholder" style="background:${escapeHtml(project.color || "#f2d591")}"></span>`;
  return `<a class="work-card" href="#${project.category}/${project.id}"><div class="card-image">${cover}</div><div class="card-caption"><div class="card-meta"><span>${escapeHtml(project.medium || labels[project.category])}</span><span>${escapeHtml(project.year)}</span></div><h3 class="card-title">${escapeHtml(project.title)}</h3></div></a>`;
}

function aboutText() {
  let copy = escapeHtml(data.about);
  data.annotations.forEach((entry, index) => {
    const [phrase, ...note] = entry.split("|");
    if (!phrase?.trim() || !note.join("|").trim()) return;
    const noteId = `annotation-note-${index + 1}`;
    copy = copy.replace(escapeHtml(phrase.trim()), `<button class="annotation" type="button" aria-expanded="false" aria-controls="${noteId}"><span>${escapeHtml(phrase.trim())}</span><sup>${index + 1}</sup><span class="annotation-note" id="${noteId}">${escapeHtml(note.join("|").trim())}</span></button>`);
  });
  return copy;
}

function socialLinks() {
  const links = Object.entries(data.links).map(([name, url]) => [name, externalUrl(url)]).filter(([, url]) => url);
  return links.length ? `<nav class="about-links" aria-label="Social links">${links.map(([name, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" aria-label="${name}" title="${name}">${socialIcons[name]}<span class="visually-hidden">${name}</span></a>`).join("")}</nav>` : "";
}

function homeSection(label, title, href, linkText, content, className = "") {
  return `<section class="home-sections ${className}"><div class="section-heading"><div><p>${label}</p><h2><a href="${href}">${title}</a></h2></div><a class="text-link" href="${href}">${linkText}</a></div><div class="feature-grid">${content}</div></section>`;
}

function writingHomeSection(content) {
  return `<section class="home-sections writing-home"><div class="section-heading"><div><p>02 / shower & regular thoughts alike</p><h2><a href="#writing">writing</a></h2></div><a class="text-link" href="#writing">browse more</a></div><div class="writing-list">${content}</div></section>`;
}

function marqueeContent() {
  const phrase = '<span class="marquee-phrase">thanks for stopping by</span><span class="marquee-separator">✶</span>';
  const group = phrase.repeat(4);
  return `<span class="marquee-group">${group}</span><span class="marquee-group" aria-hidden="true">${group}</span>`;
}

function home() {
  const art = data.projects.filter(project => project.category === "fine-art").slice(0, 3);
  const writing = data.projects.filter(project => project.category === "writing").slice(0, 3);
  const design = data.projects.filter(project => project.category === "projects").slice(0, 3);
  const writingRows = writing.length ? writing.map(writingRow).join("") : emptyShelf();
  return `<section class="hero"><div><h1><em>welcome.</em></h1><p class="intro">Thanks for stopping by and I hope you enjoy looking through some of my works. Please let me know if you have any comments, questions, and concerns. Feedback is always appreciated :)</p></div><div class="hero-art"><img src="assets/graphics/portfolio-graphic.svg?v=20260820-12" alt="" /></div><div class="hero-bottom"><span>scroll to explore my mind</span><span>student / artist / writer / designer <i data-lucide="arrow-down"></i></span></div></section>${homeSection("01 / pieces that challenge me in ever different ways", "fine art", "#fine-art", "browse more", art.map(card).join("") || emptyShelf())}${writingHomeSection(writingRows)}${homeSection("03 / projects with clients", "design", "#projects", "browse more", design.map(card).join("") || emptyShelf(), "design-preview")}<section class="about"><h2><em>nice to meet you</em></h2><div class="about-copy"><p>${aboutText()}</p>${socialLinks()}</div></section>`;
}

function writingRow(project) {
  return `<a class="writing-row" href="#writing/${project.id}"><span class="type">${escapeHtml(project.medium || "writing")}</span><h3>${escapeHtml(project.title)}</h3><span class="writing-year">${escapeHtml(project.year || "")}</span><i data-lucide="arrow-up-right"></i></a>`;
}

function listing(category) {
  const title = { "fine-art": "Fine<br />art", writing: "Creative<br />writing", projects: "Design<br />work" }[category];
  const projects = data.projects.filter(project => project.category === category);
  const content = category === "writing"
    ? `<div class="writing-list">${projects.length ? projects.map(writingRow).join("") : emptyShelf()}</div>`
    : `<div class="project-grid">${projects.length ? projects.map(card).join("") : emptyShelf()}</div>`;
  return `<section class="page ${category === "writing" ? "writing-page" : ""}"><div class="page-head"><h1>${title}</h1><p>${listingCopy[category]}</p></div>${content}</section>`;
}

function detail(category, id) {
  const project = data.projects.find(item => item.id === id);
  if (!project) return listing(category);
  const cover = project.image
    ? `<figure class="detail-image detail-image--cover"><img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.title)}" decoding="async" role="button" tabindex="0" aria-label="Open ${escapeHtml(project.title)} full screen" /></figure>`
    : `<div class="detail-gallery-anchor" aria-hidden="true"></div>`;
  const meta = [project.year, project.medium].filter(Boolean).map(value => `<span>${escapeHtml(value)}</span>`).join("");
  const credits = project.credits ? `<h3>credits</h3><p>${escapeHtml(project.credits)}</p>` : "";
  const notes = project.notes ? `<h3>more information</h3><p>${richText(project.notes)}</p>` : "";
  return `<article class="detail"><a class="back" href="#${category}"><i data-lucide="arrow-left"></i> back to ${labels[category]}</a><div class="detail-head"><h1>${escapeHtml(project.title)}</h1><div class="detail-meta">${meta}${project.description ? `<p class="detail-description">${escapeHtml(project.description)}</p>` : ""}</div></div>${cover}<div class="detail-copy"><div>${credits}${notes}${project.link ? `<a class="external-text-link" href="${escapeHtml(externalUrl(project.link))}" target="_blank" rel="noreferrer">visit external link <i class="external-link-icon" data-lucide="arrow-up-right" aria-hidden="true"></i></a>` : ""}</div></div></article>`;
}

function renderGallery(project) {
  let coverRemoved = false;
  const images = projectImages(project).filter(image => {
    if (!coverRemoved && image.src === project.image) { coverRemoved = true; return false; }
    return true;
  });
  if (!images.length) return;
  const gallery = document.createElement("section");
  gallery.className = `detail-gallery${images.some(image => image.type === "pdf") ? " has-pdf" : ""}`;
  const galleryItems = images.map(image => `<figure class="${image.type === "pdf" ? "pdf-figure" : ""}">${image.type === "video" ? `<video controls preload="metadata" src="${escapeHtml(image.src)}"></video>` : image.type === "pdf" ? `<iframe class="pdf-embed" src="${escapeHtml(image.src)}#view=FitH" title="${escapeHtml(project.title)} PDF" loading="lazy"></iframe><a class="pdf-fallback" href="${escapeHtml(image.src)}" target="_blank" rel="noreferrer">open PDF in a new tab <i class="external-link-icon" data-lucide="arrow-up-right" aria-hidden="true"></i></a>` : `<img src="${escapeHtml(image.src)}" alt="Additional image from ${escapeHtml(project.title)}" loading="lazy" decoding="async" role="button" tabindex="0" aria-label="Open project image full screen" />`}${image.caption ? `<figcaption>${richText(image.caption)}</figcaption>` : ""}</figure>`).join("");
  gallery.innerHTML = `<div class="detail-gallery-track">${galleryItems}</div>`;
  app.querySelector(".detail-image, .detail-gallery-anchor")?.after(gallery);
}

function openImageViewer(clickedImage) {
  document.querySelector(".image-viewer")?.closeViewer?.();
  const images = [...document.querySelectorAll(".detail-image img, .detail-gallery-track img")];
  if (!images.length) return;
  const previousFocus = document.activeElement;
  let currentIndex = Math.max(0, images.indexOf(clickedImage));
  const viewer = document.createElement("div");
  viewer.className = "image-viewer";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", "Full-screen image viewer");
  viewer.innerHTML = `<button class="image-viewer-close" type="button" aria-label="Close full-screen image"><i data-lucide="x"></i></button><button class="image-viewer-nav image-viewer-prev" type="button" aria-label="Previous image"><i data-lucide="arrow-left"></i></button><figure><img alt="" /><figcaption></figcaption></figure><button class="image-viewer-nav image-viewer-next" type="button" aria-label="Next image"><i data-lucide="arrow-right"></i></button>`;
  const fullImage = viewer.querySelector("img");
  const counter = viewer.querySelector("figcaption");
  const previous = viewer.querySelector(".image-viewer-prev");
  const next = viewer.querySelector(".image-viewer-next");
  const update = () => {
    const source = images[currentIndex];
    fullImage.src = source.currentSrc || source.src;
    fullImage.alt = source.alt || "Project image";
    counter.textContent = `${currentIndex + 1} / ${images.length}`;
    previous.disabled = images.length < 2;
    next.disabled = images.length < 2;
  };
  const move = direction => {
    currentIndex = (currentIndex + direction + images.length) % images.length;
    update();
  };
  const close = () => {
    document.removeEventListener("keydown", onKeyDown);
    document.body.classList.remove("viewer-open");
    viewer.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  const onKeyDown = event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
    if (event.key === "Tab") {
      const focusable = [...viewer.querySelectorAll("button:not(:disabled)")];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  viewer.querySelector(".image-viewer-close").addEventListener("click", close);
  viewer.addEventListener("click", event => { if (event.target === viewer) close(); });
  let pointerStart = 0;
  viewer.addEventListener("pointerdown", event => { pointerStart = event.clientX; }, { passive: true });
  viewer.addEventListener("pointerup", event => {
    const distance = event.clientX - pointerStart;
    if (Math.abs(distance) > 55) move(distance > 0 ? -1 : 1);
  }, { passive: true });
  document.addEventListener("keydown", onKeyDown);
  viewer.closeViewer = close;
  document.body.append(viewer);
  document.body.classList.add("viewer-open");
  createIcons(); update();
  viewer.querySelector(".image-viewer-close").focus();
}

function renderReading(books) {
  const about = app.querySelector(".about");
  if (!about) return;
  about.querySelector(".currently-reading")?.remove();
  const section = document.createElement("section");
  section.className = "currently-reading";
  section.innerHTML = `<p class="eyebrow">currently reading</p><ol>${books.map(book => `<li><a href="${escapeHtml(book.url)}" target="_blank" rel="noreferrer"><em>${escapeHtml(book.title)}</em></a><span>by ${escapeHtml(book.author)}</span></li>`).join("")}</ol><a class="reading-profile" href="https://www.goodreads.com/user/show/34056305-tz" target="_blank" rel="noreferrer">view my goodreads <i class="external-link-icon" data-lucide="arrow-up-right" aria-hidden="true"></i></a>`;
  about.append(section);
  createIcons();
}

function loadReading() {
  renderReading(fallbackReading);
  fetch("data/current-reading.json", { cache: "no-store" }).then(response => response.ok ? response.json() : Promise.reject()).then(payload => { if (Array.isArray(payload.books) && payload.books.length) renderReading(payload.books); }).catch(() => {});
}

function updatePageMetadata(page, project) {
  const pageName = labels[page]?.toLowerCase();
  const title = project?.title
    ? `${project.title} — tiona zeng`
    : page === "home" ? "tiona zeng — portfolio" : `${pageName} — tiona zeng`;
  const description = project?.description
    || (page === "home"
      ? "Fine art, creative writing, and design work by Tiona Zeng."
      : listingCopy[page]);
  document.title = title;
  const metadata = [
    ['meta[name="description"]', description],
    ['meta[property="og:title"]', title],
    ['meta[property="og:description"]', description],
    ['meta[name="twitter:title"]', title],
    ['meta[name="twitter:description"]', description]
  ];
  metadata.forEach(([selector, content]) => document.querySelector(selector)?.setAttribute("content", content));
  document.querySelectorAll(".site-header .nav-link").forEach(link => {
    const active = link.getAttribute("href") === `#${page}`;
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function renderPublic() {
  const [category = "home", id] = location.hash.slice(1).split("/");
  const page = ["home", "fine-art", "writing", "projects"].includes(category) ? category : "home";
  const project = id && data.projects.find(item => item.id === id);
  document.querySelector(".image-viewer")?.closeViewer?.();
  app.classList.remove("page-enter"); void app.offsetWidth;
  app.innerHTML = `${id ? detail(page, id) : page === "home" ? home() : listing(page)}<div class="marquee marquee-bottom"><div class="marquee-track">${marqueeContent()}</div></div>`;
  if (project) renderGallery(project);
  if (page === "home") loadReading();
  updatePageMetadata(page, project);
  app.classList.add("page-enter");
  createIcons(); scrollTo(0, 0);
}

function populateEditor() {
  document.querySelector("#about-copy").value = data.about;
  document.querySelector("#about-annotations").value = data.annotations.join("\n");
  document.querySelector("#about-email").value = data.email;
  document.querySelector("#linkedin-url").value = data.links.linkedin;
  document.querySelector("#rednote-url").value = data.links.rednote;
  document.querySelector("#instagram-url").value = data.links.instagram;
  document.querySelector("#resume-url").value = data.links.resume;
  document.querySelector("#studio-name").value = data.studioName;
  document.querySelector("#accent-color").value = data.accent;
  document.querySelector("#font-name").textContent = data.fontName || "Sneaky Times selected — upload its file to embed it";
}

function renderProjectList() {
  const list = document.querySelector("#project-list");
  const groups = [["fine-art", "fine art"], ["writing", "writing"], ["projects", "design"]];
  list.innerHTML = data.projects.length ? groups.map(([category, title]) => {
    const projects = data.projects.filter(project => project.category === category);
    return `<section class="project-section"><div class="project-section-heading"><h4>${title}</h4><span>drag to reorder</span></div><div class="project-table" data-project-category="${category}">${projects.length ? projects.map(project => `<article class="project-item" data-edit="${project.id}" draggable="true" tabindex="0"><button class="project-drag" type="button" aria-label="Drag ${escapeHtml(project.title)} to reorder"><i data-lucide="grip-vertical"></i></button><b>${escapeHtml(project.title)}</b><span>${escapeHtml(project.year)}</span><i data-lucide="pencil"></i></article>`).join("") : `<p class="empty">No ${title} projects yet.</p>`}</div></section>`;
  }).join("") : emptyShelf();
  createIcons();
  setupProjectReordering();
}

function setupProjectReordering() {
  document.querySelectorAll(".project-table").forEach(table => {
    table.querySelectorAll(".project-item[draggable]").forEach(item => {
      item.addEventListener("dragstart", event => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.dataset.edit);
        item.classList.add("is-dragging");
      });
      item.addEventListener("dragend", () => item.classList.remove("is-dragging"));
      item.addEventListener("keydown", event => {
        if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button")) {
          event.preventDefault();
          openProjectForm(item.dataset.edit);
        }
      });
      item.addEventListener("dragover", event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      item.addEventListener("drop", async event => {
        event.preventDefault();
        const draggedId = event.dataTransfer.getData("text/plain");
        const targetId = item.dataset.edit;
        if (!draggedId || draggedId === targetId) return;
        const category = table.dataset.projectCategory;
        const items = data.projects.filter(project => project.category === category);
        const from = items.findIndex(project => project.id === draggedId);
        const to = items.findIndex(project => project.id === targetId);
        if (from < 0 || to < 0) return;
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        let index = 0;
        data.projects = data.projects.map(project => project.category === category ? items[index++] : project);
        try { await saveArchive(); renderProjectList(); }
        catch (error) { showFormNotice(document.querySelector("#content-tab"), error.message || "Unable to save the new project order."); }
      });
    });
  });
}

function mediaPreview(item) {
  if (item.type === "video") return `<span class="media-library-icon"><i data-lucide="video"></i></span>`;
  if (item.type === "pdf") return `<span class="media-library-icon"><i data-lucide="file-text"></i></span>`;
  return `<img src="${escapeHtml(item.src)}" alt="" loading="lazy" />`;
}

function renderMediaLibrary() {
  const library = document.querySelector("#media-library");
  if (!library) return;
  const linked = storedMedia();
  const all = new Map(linked.map(item => [item.src, item]));
  mediaLibrary.forEach(item => {
    const existing = all.get(item.src);
    all.set(item.src, {
      ...existing,
      ...item,
      projects: item.projects?.length ? item.projects : (existing?.projects || [])
    });
  });
  const items = [...all.values()];
  const folders = [
    ["images", "image"],
    ["videos", "video"],
    ["PDFs", "pdf"]
  ];
  library.innerHTML = `${mediaLibraryMessage ? `<p class="media-library-message">${escapeHtml(mediaLibraryMessage)}</p>` : ""}${folders.map(([title, type]) => {
    const folderItems = items.filter(item => item.type === type);
    return `<section class="media-folder"><div class="media-folder-heading"><h4>${title}</h4><span>${folderItems.length}</span></div>${folderItems.length ? `<div class="media-grid">${folderItems.map(item => `<article class="media-item"><div class="media-thumb">${mediaPreview(item)}</div><p title="${escapeHtml(mediaName(item.src))}">${escapeHtml(mediaName(item.src))}</p><small>${item.projects.length ? `used in ${escapeHtml(item.projects.join(", "))}` : "not used in a project"}</small><button class="text-button media-delete" type="button" data-delete-media="${escapeHtml(item.src)}">delete file</button></article>`).join("")}</div>` : `<p class="empty">No ${title.toLowerCase()} uploaded yet.</p>`}</section>`;
  }).join("")}`;
  createIcons();
}

async function refreshMediaLibrary(force = false) {
  const library = document.querySelector("#media-library");
  library?.setAttribute("aria-busy", "true");
  try {
    mediaLibrary = storedMedia();
    mediaLibraryMessage = mediaLibrary.length ? "Refreshing media library…" : "Looking for files in your storage…";
    renderMediaLibrary();
    if (!sb || !currentUser || (mediaLibraryLoaded && !force)) {
      mediaLibraryMessage = mediaLibrary.length ? "" : "No project media found yet.";
      renderMediaLibrary();
      return;
    }
    const { data: files, error } = await sb.storage.from(MEDIA_BUCKET).list(currentUser.id, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw error;
    mediaLibraryLoaded = true;
    const linked = storedMedia();
    mediaLibrary = (files || []).filter(file => file.name && file.name !== ".emptyFolderPlaceholder").map(file => {
      const path = `${currentUser.id}/${file.name}`;
      const { data: publicUrl } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path);
      const src = publicUrl.publicUrl;
      return { src, path, type: mediaKind(file.name), projects: linked.find(item => item.src === src)?.projects || [] };
    });
    mediaLibraryMessage = mediaLibrary.length || linked.length ? "" : "No uploads yet. Add files to a project and they’ll appear here automatically.";
    renderMediaLibrary();
  } catch (error) {
    mediaLibraryMessage = `Media library could not load: ${error.message || "Please try again."}`;
    renderMediaLibrary();
  } finally {
    library?.removeAttribute("aria-busy");
  }
}

function openProjectForm(id = "") {
  editingId = id || null;
  const form = document.querySelector("#project-form");
  const project = data.projects.find(item => item.id === id);
  form.reset();
  form.elements.id.value = "";
  form.elements.id.defaultValue = "";
  clearAttachedMedia(); form.classList.remove("hidden");
  document.querySelector("#form-title").textContent = project ? "edit project" : "new project";
  document.querySelector(".delete-project").style.visibility = project ? "visible" : "hidden";
  if (project) {
    Object.entries(project).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
  }
  renderGalleryOrder(project);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderGalleryOrder(project) {
  const order = document.querySelector("#gallery-order");
  if (!order) return;
  const items = project ? projectImages(project) : [];
  order.innerHTML = items.length
    ? `<p class="eyebrow">gallery files</p>${items.map((item, index) => `<div class="gallery-order-item"><div class="gallery-order-preview">${mediaPreview(item)}</div><div class="gallery-order-copy"><span>${index + 1}. ${escapeHtml(mediaName(item.src))}</span><label>caption <div class="format-tools"><button class="text-button" type="button" data-format-for="galleryCaption${index}" data-format="bold"><strong>B</strong> bold</button><button class="text-button" type="button" data-format-for="galleryCaption${index}" data-format="italic"><em>I</em> italic</button></div><input name="galleryCaption${index}" data-gallery-caption="${index}" value="${escapeHtml(item.caption || "")}" placeholder="Optional caption" /></label></div><div class="gallery-order-actions"><button class="text-button" type="button" data-move-gallery="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>move up</button><button class="text-button" type="button" data-move-gallery="${index}" data-direction="1" ${index === items.length - 1 ? "disabled" : ""}>move down</button><button class="text-button" type="button" data-remove-gallery="${index}">remove</button></div></div>`).join("")}`
    : "";
  createIcons();
}

function setupEditor() {
  if (!modal) return;
  modal.showModal(); modal.append(cursor);
  modal.addEventListener("cancel", event => event.preventDefault());
  activateEditorTab(document.querySelector(".editor-tab.active"));
  populateEditor(); renderProjectList(); refreshMediaLibrary();
  document.addEventListener("click", handleEditorClick);
  document.querySelector(".editor-tabs")?.addEventListener("keydown", event => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll(".editor-tab")];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
      : (current + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    activateEditorTab(tabs[next]);
  });
  document.querySelector("#project-form").addEventListener("submit", saveProject);
  document.querySelector("#studio-name").addEventListener("input", event => { data.studioName = event.target.value || defaults.studioName; saveLocalArchive(); });
  document.querySelector("#accent-color").addEventListener("input", event => { data.accent = event.target.value; saveLocalArchive(); });
  document.querySelector("#font-upload").addEventListener("change", uploadFont);
  document.querySelector("#gallery-upload").addEventListener("change", showAttachedMedia);
  document.querySelector("#editor-password")?.addEventListener("submit", changeEditorPassword);
}

function activateEditorTab(tab) {
  document.querySelectorAll(".editor-tab").forEach(button => {
    const selected = button === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll(".tab-panel").forEach(panel => {
    const selected = panel.id === `${tab.dataset.tab}-tab`;
    panel.classList.toggle("active", selected);
    panel.hidden = !selected;
  });
}

function showAttachedMedia(event) {
  const display = document.querySelector("#gallery-file-names");
  if (!display) return;
  const incoming = [...event.target.files];
  const known = new Set(pendingMediaFiles.map(file => `${file.name}-${file.size}-${file.lastModified}`));
  pendingMediaFiles.push(...incoming.filter(file => !known.has(`${file.name}-${file.size}-${file.lastModified}`)));
  event.target.value = "";
  const names = pendingMediaFiles.map(file => file.name);
  display.textContent = names.length ? `${names.length} file${names.length === 1 ? "" : "s"} attached: ${names.join(", ")}` : "";
}

function clearAttachedMedia() {
  pendingMediaFiles = [];
  const upload = document.querySelector("#gallery-upload");
  const display = document.querySelector("#gallery-file-names");
  if (upload) upload.value = "";
  if (display) display.textContent = "";
}

function renderEditorGate(message = "Sign in to manage your portfolio.") {
  app.innerHTML = `<section class="editor-auth"><p class="eyebrow">YOUR BACKSTAGE</p><h1>studio<br /><em>editor</em></h1><p>${escapeHtml(message)}</p><form id="editor-login"><label>Email<input name="email" type="email" autocomplete="email" required /></label><label>Password<input name="password" type="password" autocomplete="current-password" required /></label><button class="button dark" type="submit">sign in</button><button class="text-button request-reset" type="button">forgot password?</button><p class="form-notice" aria-live="polite"></p></form></section>`;
  document.querySelector("#editor-login")?.addEventListener("submit", signInEditor);
  document.querySelector(".request-reset")?.addEventListener("click", requestPasswordReset);
}

function renderPasswordRecovery() {
  app.innerHTML = `<section class="editor-auth"><p class="eyebrow">YOUR BACKSTAGE</p><h1>new<br /><em>password</em></h1><p>Choose a new password for the studio editor.</p><form id="editor-recovery"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" required /></label><label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /></label><button class="button dark" type="submit">save new password</button><p class="form-notice" aria-live="polite"></p></form></section>`;
  document.querySelector("#editor-recovery")?.addEventListener("submit", finishPasswordRecovery);
}

async function finishPasswordRecovery(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const notice = form.querySelector(".form-notice");
  if (values.password !== values.confirmPassword) { notice.textContent = "Those passwords do not match."; return; }
  const { error } = await sb.auth.updateUser({ password: values.password });
  if (error) { notice.textContent = error.message; return; }
  await sb.auth.signOut();
  history.replaceState({}, "", location.pathname);
  renderEditorGate("Password updated. Sign in with your new password.");
}

async function changeEditorPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const notice = form.querySelector(".form-notice");
  if (values.password !== values.confirmPassword) { notice.textContent = "Those passwords do not match."; return; }
  const { error } = await sb.auth.updateUser({ password: values.password });
  if (error) { notice.textContent = error.message; return; }
  await sb.auth.signOut();
  modal?.close();
  app.innerHTML = "";
  renderEditorGate("Password updated. Sign in with your new password.");
}

async function requestPasswordReset(event) {
  const form = event.currentTarget.closest("form");
  const email = form.elements.email.value.trim();
  const notice = form.querySelector(".form-notice");
  if (!email) { notice.textContent = "Enter your email first, then choose forgot password."; return; }
  notice.textContent = "Sending reset link…";
  const resetRequest = sb.auth.resetPasswordForEmail(email, { redirectTo: "https://tiona.studio/applepie/" });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("The email service did not respond. Try again later or change your password after signing in.")), 10000));
  try {
    const { error } = await Promise.race([resetRequest, timeout]);
    notice.textContent = error ? error.message : "Reset link sent. Check your email, then open the newest link.";
  } catch (error) {
    notice.textContent = error.message;
  }
}

async function preparePasswordRecovery() {
  const code = recoveryQuery.get("code");
  if (!code || !sb) return;
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    isRecoveringPassword = false;
    recoveryLinkError = "This reset link is invalid or expired. Request a new one below.";
    return;
  }
  history.replaceState({}, "", `${location.pathname}#type=recovery`);
}

async function signInEditor(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const notice = form.querySelector(".form-notice");
  if (!sb) { notice.textContent = "The hosted archive is not configured yet."; return; }
  notice.textContent = "Signing in…";
  const { data: auth, error } = await sb.auth.signInWithPassword(values);
  if (error) { notice.textContent = error.message; return; }
  currentUser = auth.user;
  try {
    await hydrateArchive();
    if (archiveOwner && archiveOwner !== currentUser.id) {
      renderEditorGate("This editor belongs to a different account.");
      return;
    }
    app.innerHTML = "";
    setupEditor();
  } catch (loadError) {
    notice.textContent = loadError.message || "Unable to load the hosted archive.";
  }
}

async function handleEditorClick(event) {
  const target = event.target;
  if (target.closest(".close-editor")) location.href = "../";
  if (target.closest(".add-project")) openProjectForm();
  if (target.closest(".cancel-edit, .collapse-edit")) document.querySelector("#project-form").classList.add("hidden");
  const edit = target.closest("[data-edit]"); if (edit && !target.closest(".project-drag")) openProjectForm(edit.dataset.edit);
  if (target.closest(".preview-project")) {
    const project = data.projects.find(item => item.id === editingId);
    if (!project) showFormNotice(document.querySelector("#project-form"), "Save the project once before previewing it.");
    else window.open(`../#${project.category}/${project.id}`, "_blank", "noopener");
  }
  const formatter = target.closest("[data-format]");
  if (formatter) formatText(formatter.dataset.formatFor, formatter.dataset.format);
  const moveGallery = target.closest("[data-move-gallery]");
  if (moveGallery && editingId) {
    const project = data.projects.find(item => item.id === editingId);
    syncGalleryCaptions(project);
    const items = projectImages(project);
    const from = Number(moveGallery.dataset.moveGallery);
    const to = from + Number(moveGallery.dataset.direction);
    if (items[to]) {
      [items[from], items[to]] = [items[to], items[from]];
      project.gallery = items;
      project.images = items.map(item => item.src);
      project.image = items.find(item => item.type === "image")?.src || "";
      try { await saveArchive(); openProjectForm(editingId); }
      catch (error) { showFormNotice(document.querySelector("#project-form"), error.message || "Unable to reorder the gallery."); }
    }
  }
  const removeGallery = target.closest("[data-remove-gallery]");
  if (removeGallery && editingId) {
    const project = data.projects.find(item => item.id === editingId);
    syncGalleryCaptions(project);
    const item = projectImages(project)[Number(removeGallery.dataset.removeGallery)];
    if (item && confirm(`Remove ${mediaName(item.src)} from this project? The file will remain in your media library.`)) {
      project.gallery = projectImages(project).filter((_, index) => index !== Number(removeGallery.dataset.removeGallery));
      project.images = project.gallery.map(image => image.src);
      if (project.image === item.src) project.image = project.gallery.find(image => image.type === "image")?.src || "";
      try { await saveArchive(); openProjectForm(editingId); renderMediaLibrary(); }
      catch (error) { showFormNotice(document.querySelector("#project-form"), error.message || "Unable to remove this file."); }
    }
  }
  const deleteMedia = target.closest("[data-delete-media]");
  if (deleteMedia) await deleteMediaFile(deleteMedia.dataset.deleteMedia);
  const tab = target.closest(".editor-tab");
  if (tab) {
    activateEditorTab(tab);
    if (tab.dataset.tab === "media") refreshMediaLibrary(true);
  }
  if (target.closest(".refresh-media")) {
    const refresh = target.closest(".refresh-media");
    refresh.disabled = true;
    refresh.textContent = "refreshing…";
    mediaLibraryLoaded = false;
    try { await refreshMediaLibrary(true); }
    finally { refresh.disabled = false; refresh.textContent = "refresh library"; }
  }
  if (target.closest(".delete-project") && editingId) {
    if (!confirm("Delete this project? Its uploaded files will stay in your media library.")) return;
    data.projects = data.projects.filter(project => project.id !== editingId);
    try { await saveArchive(); document.querySelector("#project-form").classList.add("hidden"); renderProjectList(); renderMediaLibrary(); }
    catch (error) { showFormNotice(document.querySelector("#project-form"), error.message || "Unable to delete this project."); }
  }
  if (target.closest(".save-about")) {
    data.about = document.querySelector("#about-copy").value;
    data.annotations = document.querySelector("#about-annotations").value.split("\n").map(note => note.trim()).filter(Boolean);
    data.email = document.querySelector("#about-email").value;
    data.links = { linkedin: externalUrl(document.querySelector("#linkedin-url").value), rednote: externalUrl(document.querySelector("#rednote-url").value), instagram: externalUrl(document.querySelector("#instagram-url").value), resume: externalUrl(document.querySelector("#resume-url").value) };
    try { await saveArchive(); showFormNotice(document.querySelector("#about-tab"), "changes saved.", "success"); }
    catch (error) { showFormNotice(document.querySelector("#about-tab"), error.message || "Unable to save changes."); }
  }
  if (target.closest(".save-appearance")) {
    data.studioName = document.querySelector("#studio-name").value.trim() || defaults.studioName;
    data.accent = document.querySelector("#accent-color").value;
    try { await saveArchive(); showFormNotice(document.querySelector("#appearance-tab"), "appearance saved.", "success"); }
    catch (error) { showFormNotice(document.querySelector("#appearance-tab"), error.message || "Unable to save appearance."); }
  }
  if (target.closest(".export-data")) {
    const download = document.createElement("a");
    download.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    download.download = "tiona-zeng-archive.json"; download.click(); URL.revokeObjectURL(download.href);
  }
}

function syncGalleryCaptions(project) {
  if (!project) return;
  const captions = [...document.querySelectorAll("[data-gallery-caption]")];
  if (!captions.length) return;
  project.gallery = projectImages(project).map((item, index) => ({ ...item, caption: captions.find(field => Number(field.dataset.galleryCaption) === index)?.value || "" }));
  project.images = project.gallery.map(item => item.src);
}

async function deleteMediaFile(source) {
  const path = storagePathFromUrl(source);
  const library = document.querySelector("#media-library");
  if (!path) {
    showFormNotice(library, "Only files uploaded through this editor can be deleted here.");
    return;
  }
  if (!confirm(`Delete ${mediaName(source)} everywhere? This permanently removes the file from your storage and every project using it.`)) return;
  try {
    const { error } = await sb.storage.from(MEDIA_BUCKET).remove([path]);
    if (error) throw error;
    data.projects.forEach(project => {
      project.gallery = projectImages(project).filter(item => item.src !== source);
      project.images = project.gallery.map(item => item.src);
      if (project.image === source) project.image = project.gallery.find(item => item.type === "image")?.src || "";
    });
    mediaLibrary = mediaLibrary.filter(item => item.src !== source);
    await saveArchive(); renderProjectList(); renderMediaLibrary();
    showFormNotice(library, "file deleted from your media library.", "success");
  } catch (error) {
    showFormNotice(library, error.message || "Unable to delete this file.");
  }
}

function formatText(fieldName, format) {
  const field = document.querySelector(`[name="${fieldName}"]`);
  if (!field) return;
  const marker = format === "bold" ? "**" : "*";
  const start = field.selectionStart;
  const end = field.selectionEnd;
  const selected = field.value.slice(start, end);
  field.value = `${field.value.slice(0, start)}${marker}${selected}${marker}${field.value.slice(end)}`;
  const cursor = selected ? end + marker.length * 2 : start + marker.length;
  field.focus();
  field.setSelectionRange(cursor, cursor);
}

function showFormNotice(form, message, type = "error") {
  if (!form) return;
  form.querySelector(".form-notice")?.remove();
  const notice = `<p class="form-notice ${type}" role="status">${escapeHtml(message)}</p>`;
  const actions = form.querySelector(".form-actions");
  if (actions) actions.insertAdjacentHTML("beforebegin", notice);
  else form.insertAdjacentHTML("beforeend", notice);
}

function safeMediaName(file) {
  return file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "upload";
}

async function uploadMedia(file) {
  if (!sb || !currentUser) throw new Error("Sign in to upload files.");
  const path = `${currentUser.id}/${Date.now()}-${crypto.randomUUID()}-${safeMediaName(file)}`;
  const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false
  });
  if (error) throw error;
  const { data: publicUrl } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return publicUrl.publicUrl;
}

async function saveProject(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  if (submit?.disabled) return;
  submit?.setAttribute("aria-busy", "true");
  if (submit) submit.disabled = true;
  try {
    const files = [...pendingMediaFiles];
    const values = Object.fromEntries(new FormData(form));
    const existing = data.projects.find(project => project.id === values.id);
    const uploads = [];
    if (files.length) {
      for (const [index, file] of files.entries()) {
        showFormNotice(form, `Uploading ${index + 1} of ${files.length}: ${file.name}`, "success");
        uploads.push(await uploadMedia(file));
      }
    } else {
      showFormNotice(form, "Saving project…", "success");
    }
    const urls = values.galleryUrls.split(/\n|,/).map(url => url.trim()).filter(Boolean);
    const previous = existing ? projectImages(existing) : [];
    const sources = [...new Set([...previous.map(image => image.src), ...urls, ...uploads])];
    const captions = [...form.querySelectorAll("[data-gallery-caption]")].reduce((all, field) => ({ ...all, [Number(field.dataset.galleryCaption)]: field.value }), {});
    delete values.galleryFiles; delete values.galleryUrls;
    Object.keys(values).filter(key => key.startsWith("galleryCaption")).forEach(key => delete values[key]);
    const slug = values.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
    values.id = values.id || `${slug}-${crypto.randomUUID().slice(0, 8)}`;
    values.gallery = sources.map((src, index) => ({ src, type: mediaKind(src), caption: captions[index] ?? previous.find(image => image.src === src)?.caption ?? "" }));
    values.images = sources;
    values.image = values.image || sources.find(source => !isVideoSource(source) && !isPdfSource(source)) || existing?.image || "";
    values.color = existing?.color || ["#f2d591", "#d6ddec", "#d9c6e8", "#c3d8bd"][data.projects.length % 4];
    const index = data.projects.findIndex(project => project.id === values.id);
    if (index >= 0) data.projects[index] = values; else data.projects.unshift(values);
    await saveArchive(); editingId = values.id; clearAttachedMedia(); renderProjectList(); await refreshMediaLibrary(true);
    openProjectForm(values.id);
    showFormNotice(document.querySelector("#project-form"), existing ? "project updated — preview it on the site or keep editing." : "project saved — preview it on the site or keep editing.", "success");
  } catch (error) {
    const message = error.message || "That file could not be uploaded. Try again or use a public media URL.";
    showFormNotice(form, message);
  } finally {
    submit?.removeAttribute("aria-busy");
    if (submit) submit.disabled = false;
  }
}

function uploadFont(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    data.font = reader.result;
    data.fontName = file.name;
    saveLocalArchive();
    document.querySelector("#font-name").textContent = file.name;
    showFormNotice(document.querySelector("#appearance-tab"), "font ready — save appearance to publish it.", "success");
  };
  reader.readAsDataURL(file);
}

function setupCursor() {
  if (!cursor) return;
  let nextFrame = null;
  let pointerX = -100;
  let pointerY = -100;
  const drawCursor = () => {
    nextFrame = null;
    cursor.style.transform = `translate3d(${pointerX - 5}px, ${pointerY - 5}px, 0)`;
  };
  window.addEventListener("pointermove", event => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    cursor.classList.add("is-visible");
    if (!nextFrame) nextFrame = requestAnimationFrame(drawCursor);
  }, { passive: true });
  window.addEventListener("pointerleave", () => cursor.classList.remove("is-visible"));
  window.addEventListener("pointerenter", () => cursor.classList.add("is-visible"));
  window.addEventListener("blur", () => cursor.classList.remove("is-visible"));
  document.addEventListener("pointerover", event => cursor.classList.toggle("is-hovering", Boolean(event.target.closest("a, button, input, select, textarea, label"))));
}

function setupHaptics() {
  document.addEventListener("click", event => {
    if (!event.target.closest("button, .button")) return;
    navigator.vibrate?.(8);
  });
}

function setupAnnotations() {
  document.addEventListener("click", event => {
    const annotation = event.target.closest(".annotation");
    document.querySelectorAll(".annotation.open").forEach(item => {
      if (item !== annotation) { item.classList.remove("open"); item.setAttribute("aria-expanded", "false"); }
    });
    if (!annotation) return;
    const open = annotation.classList.toggle("open");
    annotation.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("keydown", event => {
    const image = event.target.closest?.('.detail-image img, .detail-gallery-track img');
    if (image && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openImageViewer(image);
      return;
    }
    if (event.key === "Escape") {
      document.querySelectorAll(".annotation.open").forEach(item => {
        item.classList.remove("open");
        item.setAttribute("aria-expanded", "false");
      });
    }
  });
  document.addEventListener("click", event => {
    const image = event.target.closest(".detail-image img, .detail-gallery-track img");
    if (image) openImageViewer(image);
  });
}

async function startApp() {
  try { await hydrateArchive(); }
  catch (error) { console.warn("Unable to load the hosted archive:", error); }
  applyTheme(); setupCursor(); setupHaptics();
  if (isAdmin) {
    if (!sb) { renderEditorGate("The hosted editor connection is missing."); return; }
    await preparePasswordRecovery();
    if (isRecoveringPassword) { renderPasswordRecovery(); return; }
    const { data: auth } = await sb.auth.getUser();
    currentUser = auth.user;
    if (!currentUser) { renderEditorGate(recoveryLinkError || undefined); return; }
    if (archiveOwner && archiveOwner !== currentUser.id) { renderEditorGate("This editor belongs to a different account."); return; }
    setupEditor();
    return;
  }
  window.addEventListener("hashchange", renderPublic);
  setupAnnotations(); renderPublic();
}

if (isAdmin && sb) {
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      isRecoveringPassword = true;
      renderPasswordRecovery();
    }
  });
}

startApp();
