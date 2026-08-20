/* The public site and editor share one hosted archive, with a small local backup. */
const STORAGE_KEY = "tiona-portfolio";
const LEGACY_STORAGE_KEY = "moss-archive";
const CONTENT_TABLE = "portfolio_content";
const MEDIA_BUCKET = "portfolio-media";
const isAdmin = ["/admin", "/applepie"].includes(location.pathname.replace(/\/+$/, ""));
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

const defaults = {
  studioName: "Tiona Zeng",
  accent: "#f2d591",
  about: "I’m a student artist making pictures, poems, and playful things for the internet. I’m interested in soft colors, hard feelings, and the little worlds we carry around with us.",
  email: "hello@example.com",
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

function loadArchive() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
    if (!saved) return cloneDefaults();
    const archive = { ...cloneDefaults(), ...saved, links: { ...defaults.links, ...(saved.links || {}) } };
    archive.annotations = Array.isArray(saved.annotations) ? saved.annotations : defaults.annotations;
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
  const url = value.trim();
  return url && !/^https?:\/\//i.test(url) ? `https://${url.replace(/^\/+/, "")}` : url;
}

function isVideoSource(source = "") {
  return /^data:video\//i.test(source) || /\.mp4(?:[?#].*)?$/i.test(source);
}

function projectImages(project) {
  return (project.gallery || project.images || []).map(item => {
    const media = typeof item === "string" ? { src: item, caption: "" } : item;
    return { ...media, type: media.type || (isVideoSource(media.src) ? "video" : "image") };
  });
}

function saveLocalArchive() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
  const content = remote.content || {};
  data = { ...cloneDefaults(), ...content, links: { ...defaults.links, ...(content.links || {}) } };
  data.annotations = Array.isArray(content.annotations) ? content.annotations : defaults.annotations;
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
  document.title = `${data.studioName} — ${isAdmin ? "Studio Editor" : "Portfolio"}`;
  const wordmark = document.querySelector(".wordmark");
  if (wordmark) wordmark.innerHTML = `${escapeHtml(data.studioName).replace(" ", "<br />")}<span>✶</span>`;
}

function createIcons() { window.lucide?.createIcons(); }
function emptyShelf() { return '<p class="empty">This shelf is ready for your work.</p>'; }

function card(project) {
  const imageStyle = project.image ? `background-image:url(&quot;${escapeHtml(project.image)}&quot;)` : `background:${escapeHtml(project.color || "#f2d591")}`;
  return `<a class="work-card" href="#${project.category}/${project.id}"><div class="card-image" style="${imageStyle}"></div><div class="card-meta"><span>${labels[project.category]}</span><span>${escapeHtml(project.year)}</span></div><h3 class="card-title">${escapeHtml(project.title)}</h3></a>`;
}

function aboutText() {
  let copy = escapeHtml(data.about);
  data.annotations.forEach((entry, index) => {
    const [phrase, ...note] = entry.split("|");
    if (!phrase?.trim() || !note.join("|").trim()) return;
    copy = copy.replace(escapeHtml(phrase.trim()), `<button class="annotation" type="button"><span>${escapeHtml(phrase.trim())}</span><sup>${index + 1}</sup><span class="annotation-note">${escapeHtml(note.join("|").trim())}</span></button>`);
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

function marqueeContent() {
  const phrase = '<span class="marquee-phrase">thanks for stopping by</span><span class="marquee-separator">✶</span>';
  const group = phrase.repeat(4);
  return `<span class="marquee-group">${group}</span><span class="marquee-group" aria-hidden="true">${group}</span>`;
}

function home() {
  const art = data.projects.filter(project => project.category === "fine-art").slice(0, 3);
  const writing = data.projects.filter(project => project.category === "writing").slice(0, 3);
  const design = data.projects.filter(project => project.category === "projects").slice(0, 3);
  const writingRows = writing.length ? writing.map(project => `<a class="writing-row" href="#writing/${project.id}"><span class="type">${escapeHtml(project.medium || "Writing")}</span><h3>${escapeHtml(project.title)}</h3><i data-lucide="arrow-up-right"></i></a>`).join("") : emptyShelf();
  return `<section class="hero"><div><h1><em>welcome.</em></h1><p class="intro">Thanks for stopping by and I hope you enjoy looking through some of my works. Please let me know if you have any comments, questions, and concerns. Feedback is always appreciated :)</p></div><div class="hero-art"><img src="assets/graphics/portfolio-graphic.svg?v=20260820-8" alt="" /></div><div class="hero-bottom"><span>scroll to explore my mind</span><span>student / artist / writer / designer <i data-lucide="arrow-down"></i></span></div></section><div class="marquee"><div class="marquee-track">${marqueeContent()}</div></div>${homeSection("01 / pieces that challenge me in every way", "fine art", "#fine-art", "see all work →", art.map(card).join("") || emptyShelf())}${homeSection("02 / shower & regular thoughts alike", "writing", "#writing", "read more →", writingRows)}${homeSection("03 / projects with clients", "design", "#projects", "see design work →", design.map(card).join("") || emptyShelf(), "design-preview")}<section class="about"><h2><em>nice to meet you, i’m tiona</em></h2><div class="about-copy"><p>${aboutText()}</p>${socialLinks()}</div></section>`;
}

function listing(category) {
  const title = { "fine-art": "Fine<br />art", writing: "Creative<br />writing", projects: "Design<br />work" }[category];
  const projects = data.projects.filter(project => project.category === category);
  return `<section class="page"><div class="page-head"><h1>${title}</h1><p>${listingCopy[category]}</p></div><div class="project-grid">${projects.length ? projects.map(card).join("") : emptyShelf()}</div></section>`;
}

function detail(category, id) {
  const project = data.projects.find(item => item.id === id);
  if (!project) return listing(category);
  const imageStyle = project.image ? `background-image:url(&quot;${escapeHtml(project.image)}&quot;)` : `background:${escapeHtml(project.color || "#f2d591")}`;
  return `<article class="detail"><a class="back" href="#${category}"><i data-lucide="arrow-left"></i> back to ${labels[category]}</a><div class="detail-head"><h1>${escapeHtml(project.title)}</h1><div class="detail-meta"><span>${escapeHtml(project.year)}</span><span>${escapeHtml(project.medium || "Mixed media")}</span></div></div><div class="detail-image" style="${imageStyle}"></div><div class="detail-copy"><p>${escapeHtml(project.description || "A work in progress.")}</p><div><h3>credits</h3><p>${escapeHtml(project.credits || "—")}</p><h3>process notes</h3><p>${escapeHtml(project.notes || "Notes coming soon.")}</p>${project.link ? `<a href="${escapeHtml(externalUrl(project.link))}" target="_blank" rel="noreferrer">visit external link ↗</a>` : ""}</div></div></article>`;
}

function renderGallery(project) {
  const images = projectImages(project).filter((image, index) => image.src !== project.image || index > 0);
  if (!images.length) return;
  const gallery = document.createElement("section");
  gallery.className = "detail-gallery";
  gallery.innerHTML = images.map(image => `<figure>${image.type === "video" ? `<video controls preload="metadata" src="${escapeHtml(image.src)}"></video>` : `<img src="${escapeHtml(image.src)}" alt="Additional image from ${escapeHtml(project.title)}" loading="lazy" />`}${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ""}</figure>`).join("");
  app.querySelector(".detail-image")?.after(gallery);
}

function renderReading(books) {
  const about = app.querySelector(".about");
  if (!about) return;
  about.querySelector(".currently-reading")?.remove();
  const section = document.createElement("section");
  section.className = "currently-reading";
  section.innerHTML = `<p class="eyebrow">currently reading</p><ol>${books.map(book => `<li><a href="${escapeHtml(book.url)}" target="_blank" rel="noreferrer"><em>${escapeHtml(book.title)}</em></a><span>by ${escapeHtml(book.author)}</span></li>`).join("")}</ol><a class="reading-profile" href="https://www.goodreads.com/user/show/34056305-tz" target="_blank" rel="noreferrer">view my goodreads →</a>`;
  about.append(section);
}

function loadReading() {
  renderReading(fallbackReading);
  fetch("data/current-reading.json", { cache: "no-store" }).then(response => response.ok ? response.json() : Promise.reject()).then(payload => { if (Array.isArray(payload.books) && payload.books.length) renderReading(payload.books); }).catch(() => {});
}

function renderPublic() {
  const [category = "home", id] = location.hash.slice(1).split("/");
  const page = ["home", "fine-art", "writing", "projects"].includes(category) ? category : "home";
  const project = id && data.projects.find(item => item.id === id);
  app.classList.remove("page-enter"); void app.offsetWidth;
  app.innerHTML = id ? detail(page, id) : page === "home" ? home() : listing(page);
  if (project) renderGallery(project);
  if (page === "home") loadReading();
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
  list.innerHTML = data.projects.length ? data.projects.map(project => `<button class="project-item" data-edit="${project.id}"><b>${escapeHtml(project.title)}</b><span>${escapeHtml(project.year)}</span><span>${labels[project.category]}</span><i data-lucide="pencil"></i></button>`).join("") : emptyShelf();
  createIcons();
}

function openProjectForm(id = "") {
  editingId = id || null;
  const form = document.querySelector("#project-form");
  const project = data.projects.find(item => item.id === id);
  form.reset(); form.classList.remove("hidden");
  document.querySelector("#form-title").textContent = project ? "edit project" : "new project";
  document.querySelector(".delete-project").style.visibility = project ? "visible" : "hidden";
  if (project) {
    Object.entries(project).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
    form.elements.galleryCaptions.value = projectImages(project).map(image => image.caption || "").join("\n");
  }
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setupEditor() {
  if (!modal) return;
  modal.showModal(); modal.append(cursor);
  populateEditor(); renderProjectList();
  document.addEventListener("click", handleEditorClick);
  document.querySelector("#project-form").addEventListener("submit", saveProject);
  document.querySelector("#studio-name").addEventListener("input", event => { data.studioName = event.target.value || defaults.studioName; saveLocalArchive(); });
  document.querySelector("#accent-color").addEventListener("input", event => { data.accent = event.target.value; saveLocalArchive(); });
  document.querySelector("#font-upload").addEventListener("change", uploadFont);
}

function renderEditorGate(message = "Sign in to manage your portfolio.") {
  app.innerHTML = `<section class="editor-auth"><p class="eyebrow">YOUR BACKSTAGE</p><h1>studio<br /><em>editor</em></h1><p>${escapeHtml(message)}</p><form id="editor-login"><label>Email<input name="email" type="email" autocomplete="email" required /></label><label>Password<input name="password" type="password" autocomplete="current-password" required /></label><button class="button dark" type="submit">sign in</button><p class="form-notice" aria-live="polite"></p></form></section>`;
  document.querySelector("#editor-login")?.addEventListener("submit", signInEditor);
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
  if (target.closest(".cancel-edit")) document.querySelector("#project-form").classList.add("hidden");
  const edit = target.closest("[data-edit]"); if (edit) openProjectForm(edit.dataset.edit);
  if (target.closest(".preview-project")) {
    const project = data.projects.find(item => item.id === editingId);
    if (!project) showFormNotice(document.querySelector("#project-form"), "Save the project once before previewing it.");
    else window.open(`../#${project.category}/${project.id}`, "_blank", "noopener");
  }
  const tab = target.closest(".editor-tab");
  if (tab) { document.querySelectorAll(".editor-tab, .tab-panel").forEach(element => element.classList.remove("active")); tab.classList.add("active"); document.querySelector(`#${tab.dataset.tab}-tab`).classList.add("active"); }
  if (target.closest(".delete-project") && editingId) {
    data.projects = data.projects.filter(project => project.id !== editingId);
    try { await saveArchive(); document.querySelector("#project-form").classList.add("hidden"); renderProjectList(); }
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
  if (target.closest(".export-data")) {
    const download = document.createElement("a");
    download.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    download.download = "tiona-zeng-archive.json"; download.click(); URL.revokeObjectURL(download.href);
  }
}

function showFormNotice(form, message, type = "error") {
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
  if (!sb || !currentUser) throw new Error("Sign in to upload images and videos.");
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
  try {
    const files = [...form.elements.galleryFiles.files].slice(0, 8);
    const values = Object.fromEntries(new FormData(form));
    const existing = data.projects.find(project => project.id === values.id);
    showFormNotice(form, files.length ? "Uploading media…" : "Saving project…", "success");
    const uploads = await Promise.all(files.map(uploadMedia));
    const urls = values.galleryUrls.split(/\n|,/).map(url => url.trim()).filter(Boolean);
    const previous = existing ? projectImages(existing) : [];
    const sources = [...new Set([...previous.map(image => image.src), ...urls, ...uploads])].slice(0, 8);
    const captions = values.galleryCaptions.split("\n");
    delete values.galleryFiles; delete values.galleryUrls; delete values.galleryCaptions;
    values.id = values.id || `${values.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString().slice(-4)}`;
    values.gallery = sources.map((src, index) => ({ src, type: isVideoSource(src) ? "video" : "image", caption: captions[index] || previous.find(image => image.src === src)?.caption || "" }));
    values.images = sources;
    values.image = values.image || sources.find(source => !isVideoSource(source)) || existing?.image || "";
    values.color = existing?.color || ["#f2d591", "#d6ddec", "#d9c6e8", "#c3d8bd"][data.projects.length % 4];
    const index = data.projects.findIndex(project => project.id === values.id);
    if (index >= 0) data.projects[index] = values; else data.projects.unshift(values);
    await saveArchive(); editingId = values.id; renderProjectList();
    showFormNotice(form, existing ? "project updated — preview it on the site or keep editing." : "project saved — preview it on the site or keep editing.", "success");
  } catch (error) {
    const message = error.message || "That file could not be uploaded. Try again or use a public media URL.";
    showFormNotice(form, message);
  }
}

function uploadFont(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { data.font = reader.result; data.fontName = file.name; const style = document.querySelector("#custom-font") || Object.assign(document.createElement("style"), { id: "custom-font" }); style.textContent = `@font-face{font-family:StudioCustom;src:url(${data.font})}`; document.head.append(style); document.documentElement.style.setProperty("--display", "StudioCustom, SneakyTimes, serif"); saveLocalArchive(); document.querySelector("#font-name").textContent = file.name; };
  reader.readAsDataURL(file);
}

function setupCursor() {
  if (!cursor) return;
  window.addEventListener("pointermove", event => { cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`; });
  document.addEventListener("pointerover", event => cursor.classList.toggle("is-hovering", Boolean(event.target.closest("a, button, input, select, textarea, label"))));
}

function setupAnnotations() {
  document.addEventListener("click", event => { const annotation = event.target.closest(".annotation"); if (!annotation) return; document.querySelectorAll(".annotation.open").forEach(item => { if (item !== annotation) item.classList.remove("open"); }); annotation.classList.toggle("open"); });
}

async function startApp() {
  try { await hydrateArchive(); }
  catch (error) { console.warn("Unable to load the hosted archive:", error); }
  applyTheme(); setupCursor();
  if (isAdmin) {
    if (!sb) { renderEditorGate("The hosted editor connection is missing."); return; }
    const { data: auth } = await sb.auth.getUser();
    currentUser = auth.user;
    if (!currentUser) { renderEditorGate(); return; }
    if (archiveOwner && archiveOwner !== currentUser.id) { renderEditorGate("This editor belongs to a different account."); return; }
    setupEditor();
    return;
  }
  const currentYear = document.querySelector("#current-year");
  if (currentYear) currentYear.textContent = new Date().getFullYear();
  window.addEventListener("hashchange", renderPublic);
  setupAnnotations(); renderPublic();
}

startApp();
