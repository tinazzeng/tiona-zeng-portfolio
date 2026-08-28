#!/usr/bin/env python3
"""Generate indexable routes, responsive media, social cards, and a sitemap.

The public Supabase archive remains the editorial source of truth. This build
turns its current state into crawlable GitHub Pages files without putting any
private credentials in the repository.
"""

from __future__ import annotations

import hashlib
import html
import io
import json
import math
import re
import shutil
import textwrap
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://tiona.studio"
SUPABASE_URL = "https://cglxyzcyfvbpsznntzar.supabase.co"
SUPABASE_KEY = "sb_publishable_wSfpWvIhl7EMr_ayLKw6dg_WQmh51dd"
CONTENT_ENDPOINT = f"{SUPABASE_URL}/rest/v1/portfolio_content?id=eq.site&select=content"
INK = "#312421"
PAPER = "#f2efe8"
ACCENT = "#f2d591"
SECTION_PATHS = {"fine-art": "fine-art", "writing": "writing", "projects": "design"}
SECTION_TITLES = {"fine-art": "fine art", "writing": "writing", "projects": "design"}
IMAGE_WIDTHS = (480, 880, 1440, 1760)


def request_bytes(url: str, headers: dict[str, str] | None = None) -> bytes:
    request = urllib.request.Request(url, headers=headers or {"User-Agent": "tiona.studio-builder/1"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def fetch_archive() -> dict[str, Any]:
    payload = json.loads(request_bytes(CONTENT_ENDPOINT, {"apikey": SUPABASE_KEY}).decode("utf-8"))
    if not payload or not isinstance(payload[0].get("content"), dict):
        raise RuntimeError("The Supabase portfolio archive was empty or malformed.")
    return payload[0]["content"]


def slugify(value: str) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "untitled-project"


def unique_slug(value: str, used: set[str]) -> str:
    base = slugify(value)
    slug = base
    number = 2
    while slug in used:
        slug = f"{base}-{number}"
        number += 1
    used.add(slug)
    return slug


def project_media(project: dict[str, Any]) -> list[dict[str, Any]]:
    gallery = project.get("gallery") or project.get("images") or []
    media: list[dict[str, Any]] = []
    for item in gallery:
        entry = {"src": item} if isinstance(item, str) else dict(item)
        if entry.get("src"):
            media.append(entry)
    cover = project.get("image")
    if cover and not any(item.get("src") == cover for item in media):
        media.insert(0, {"src": cover, "type": "image"})
    return media


def is_image(item: dict[str, Any]) -> bool:
    src = str(item.get("src", ""))
    return item.get("type") == "image" or not re.search(r"\.(?:mp4|pdf)(?:[?#].*)?$", src, re.I)


def reset_generated_output() -> None:
    for relative in ("fine-art", "writing", "design", "projects", "assets/media", "assets/social"):
        target = ROOT / relative
        if target.exists():
            shutil.rmtree(target)
    (ROOT / "assets/media").mkdir(parents=True, exist_ok=True)
    (ROOT / "assets/social").mkdir(parents=True, exist_ok=True)


def normalize_image(image: Image.Image) -> tuple[Image.Image, bool]:
    """Apply orientation while retaining meaningful source transparency."""
    image = ImageOps.exif_transpose(image)
    may_have_alpha = "A" in image.getbands() or "transparency" in image.info
    if may_have_alpha:
        rgba = image.convert("RGBA")
        has_alpha = rgba.getchannel("A").getextrema()[0] < 255
        return (rgba if has_alpha else rgba.convert("RGB")), has_alpha
    return image.convert("RGB"), False


def download_images(projects: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, Image.Image]]:
    records: dict[str, dict[str, Any]] = {}
    originals: dict[str, Image.Image] = {}
    for project in projects:
        for item in project_media(project):
            src = item.get("src", "")
            if not src or src in records or not is_image(item):
                continue
            try:
                raw = request_bytes(src)
                image, has_alpha = normalize_image(Image.open(io.BytesIO(raw)))
                width, height = image.size
                digest = hashlib.sha256(src.encode("utf-8")).hexdigest()[:14]
                variants: dict[str, list[dict[str, Any]]] = {"avif": [], "webp": []}
                widths = sorted(set(min(width, candidate) for candidate in IMAGE_WIDTHS if candidate <= width) | {width})
                widths = [candidate for candidate in widths if candidate <= max(IMAGE_WIDTHS)] or [width]
                for variant_width in widths:
                    variant_height = max(1, round(height * variant_width / width))
                    resized = image if variant_width == width else image.resize((variant_width, variant_height), Image.Resampling.LANCZOS)
                    for extension, options in (
                        ("avif", {"quality": 55, "speed": 6}),
                        ("webp", {"quality": 80, "method": 6}),
                    ):
                        filename = f"{digest}-{variant_width}.{extension}"
                        output = ROOT / "assets/media" / filename
                        resized.save(output, format=extension.upper(), **options)
                        variants[extension].append({"src": f"/assets/media/{filename}", "width": variant_width})
                records[src] = {"width": width, "height": height, "hasAlpha": has_alpha, "variants": variants}
                originals[src] = image
                print(f"optimized {src.rsplit('/', 1)[-1]} ({width}×{height})")
            except Exception as error:  # Keep the original remote URL as a safe fallback.
                print(f"warning: unable to optimize {src}: {error}")
    return records, originals


def load_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(ROOT / "assets/fonts/Sneaky Times 400.otf", size=size)


def draw_star(draw: ImageDraw.ImageDraw, center: tuple[int, int], radius: int, color: str) -> None:
    points: list[tuple[float, float]] = []
    for index in range(12):
        angle = -math.pi / 2 + index * math.pi / 6
        current_radius = radius if index % 2 == 0 else radius * 0.34
        points.append((center[0] + math.cos(angle) * current_radius, center[1] + math.sin(angle) * current_radius))
    draw.polygon(points, fill=color)


def fit_text(draw: ImageDraw.ImageDraw, text: str, box_width: int, max_size: int = 104) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    for size in range(max_size, 44, -2):
        font = load_font(size)
        words = text.split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if draw.textbbox((0, 0), candidate, font=font)[2] <= box_width or not current:
                current = candidate
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)
        if len(lines) <= 4:
            return font, lines
    return load_font(44), textwrap.wrap(text, 24)[:4]


def social_card(project: dict[str, Any] | None, cover: Image.Image | None, filename: str) -> str:
    canvas = Image.new("RGB", (1200, 630), PAPER)
    draw = ImageDraw.Draw(canvas)
    if cover:
        fitted = ImageOps.fit(cover, (610, 630), method=Image.Resampling.LANCZOS, centering=(0.5, 0.45))
        if "A" in fitted.getbands():
            canvas.paste(fitted, (0, 0), fitted.getchannel("A"))
        else:
            canvas.paste(fitted, (0, 0))
        draw.rectangle((590, 0, 610, 630), fill=ACCENT)
    else:
        draw.ellipse((-110, 85, 520, 715), fill=ACCENT)
        draw_star(draw, (300, 365), 185, INK)
        draw_star(draw, (300, 365), 58, PAPER)

    text_left = 660 if cover else 590
    draw.text((text_left, 64), "tiona zeng — portfolio", font=load_font(34), fill=INK)
    title = project.get("title", "art, writing, and design") if project else "art, writing, and design"
    font, lines = fit_text(draw, title, 1200 - text_left - 58)
    y = 162
    line_height = int(font.size * 0.92)
    for line in lines:
        draw.text((text_left, y), line, font=font, fill=INK)
        y += line_height
    if project:
        detail = " · ".join(str(value) for value in (project.get("year"), project.get("medium")) if value)
        draw.text((text_left, 535), detail.lower(), font=load_font(28), fill=INK)
    draw_star(draw, (1125, 72), 34, ACCENT)
    output = ROOT / "assets/social" / filename
    canvas.save(output, "JPEG", quality=88, optimize=True, progressive=True)
    return f"/assets/social/{filename}"


def replace_or_insert(source: str, pattern: str, replacement: str, before: str = "</head>") -> str:
    if re.search(pattern, source, re.I | re.S):
        return re.sub(pattern, replacement, source, count=1, flags=re.I | re.S)
    return source.replace(before, f"  {replacement}\n  {before}")


def shell_html(
    template: str,
    *,
    title: str,
    description: str,
    canonical: str,
    image_url: str,
    image_alt: str,
    robots: str = "index, follow",
    project: dict[str, Any] | None = None,
) -> str:
    page = template
    replacements = {
        r"<title>.*?</title>": f"<title>{html.escape(title)}</title>",
        r'<meta name="description"[^>]*>': f'<meta name="description" content="{html.escape(description, quote=True)}" />',
        r'<meta name="robots"[^>]*>': f'<meta name="robots" content="{robots}" />',
        r'<link rel="canonical"[^>]*>': f'<link rel="canonical" href="{canonical}" />',
        r'<meta property="og:url"[^>]*>': f'<meta property="og:url" content="{canonical}" />',
        r'<meta property="og:title"[^>]*>': f'<meta property="og:title" content="{html.escape(title, quote=True)}" />',
        r'<meta property="og:description"[^>]*>': f'<meta property="og:description" content="{html.escape(description, quote=True)}" />',
        r'<meta property="og:type"[^>]*>': f'<meta property="og:type" content="{"article" if project else "website"}" />',
        r'<meta name="twitter:title"[^>]*>': f'<meta name="twitter:title" content="{html.escape(title, quote=True)}" />',
        r'<meta name="twitter:description"[^>]*>': f'<meta name="twitter:description" content="{html.escape(description, quote=True)}" />',
        r'<meta name="twitter:card"[^>]*>': '<meta name="twitter:card" content="summary_large_image" />',
    }
    for pattern, replacement in replacements.items():
        page = replace_or_insert(page, pattern, replacement)
    image_absolute = f"{ORIGIN}{image_url}"
    og_tags = (
        f'<meta property="og:image" content="{image_absolute}" />\n'
        f'    <meta property="og:image:width" content="1200" />\n'
        f'    <meta property="og:image:height" content="630" />\n'
        f'    <meta property="og:image:alt" content="{html.escape(image_alt, quote=True)}" />\n'
        f'    <meta name="twitter:image" content="{image_absolute}" />'
    )
    for image_tag in (
        r'\s*<meta property="og:image"[^>]*>',
        r'\s*<meta property="og:image:width"[^>]*>',
        r'\s*<meta property="og:image:height"[^>]*>',
        r'\s*<meta property="og:image:alt"[^>]*>',
        r'\s*<meta name="twitter:image"[^>]*>',
    ):
        page = re.sub(image_tag, "", page, flags=re.I)
    page = page.replace("</head>", f"    {og_tags}\n  </head>")
    if project:
        schema = {
            "@context": "https://schema.org",
            "@type": "CreativeWork",
            "name": project.get("title"),
            "creator": {"@type": "Person", "name": "Tiona Zeng"},
            "dateCreated": project.get("year"),
            "artMedium": project.get("medium"),
            "description": description,
            "url": canonical,
            "image": image_absolute,
        }
        page = page.replace("</head>", f'    <script type="application/ld+json">{json.dumps(schema, ensure_ascii=False)}</script>\n  </head>')
    return page


def write_route(relative: str, page: str) -> None:
    directory = ROOT / relative
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "index.html").write_text(page, encoding="utf-8")


def build_routes(archive: dict[str, Any], media: dict[str, Any], originals: dict[str, Image.Image]) -> dict[str, Any]:
    template = (ROOT / "index.html").read_text(encoding="utf-8")
    projects = archive.get("projects", [])
    used_by_section: dict[str, set[str]] = {key: set() for key in SECTION_PATHS}
    manifest_projects: dict[str, Any] = {}
    default_social = social_card(None, None, "tiona-zeng-portfolio.jpg")

    section_descriptions = {
        "fine-art": "Fine art, photography, drawing, and visual experiments by Tiona Zeng.",
        "writing": "Poems, fiction, articles, and other writing by Tiona Zeng.",
        "projects": "Selected design and client work by Tiona Zeng.",
    }
    for category, path in SECTION_PATHS.items():
        page_title = f"{SECTION_TITLES[category]} — tiona zeng"
        page = shell_html(
            template,
            title=page_title,
            description=section_descriptions[category],
            canonical=f"{ORIGIN}/{path}/",
            image_url=default_social,
            image_alt=f"Tiona Zeng {SECTION_TITLES[category]} portfolio",
        )
        write_route(path, page)

    for project in projects:
        category = project.get("category") if project.get("category") in SECTION_PATHS else "fine-art"
        slug = unique_slug(project.get("slug") or project.get("title", "untitled project"), used_by_section[category])
        path = f"/{SECTION_PATHS[category]}/{slug}/"
        cover_url = project.get("image")
        if not cover_url:
            cover_url = next((item.get("src") for item in project_media(project) if is_image(item)), "")
        cover = originals.get(cover_url)
        social = social_card(project, cover, f"{SECTION_PATHS[category]}-{slug}.jpg")
        description = (project.get("description") or project.get("challenge") or project.get("notes") or f"{project.get('title')} by Tiona Zeng.").strip()
        title = f"{project.get('title')} — tiona zeng"
        page = shell_html(
            template,
            title=title,
            description=description[:240],
            canonical=f"{ORIGIN}{path}",
            image_url=social,
            image_alt=f"Preview of {project.get('title')} by Tiona Zeng",
            project=project,
        )
        write_route(path.strip("/"), page)
        manifest_projects[project["id"]] = {
            "slug": slug,
            "route": path,
            "socialImage": social,
            "category": category,
        }

    redirect = '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="/design/"><meta http-equiv="refresh" content="0;url=/design/"><script>location.replace("/design/")</script>'
    write_route("projects", redirect)
    not_found = shell_html(
        template,
        title="tiona zeng — portfolio",
        description="Fine art, creative writing, and design work by Tiona Zeng.",
        canonical=f"{ORIGIN}/",
        image_url=default_social,
        image_alt="Tiona Zeng portfolio",
        robots="noindex, follow",
    )
    (ROOT / "404.html").write_text(not_found, encoding="utf-8")
    return {"projects": manifest_projects, "media": media, "defaultSocialImage": default_social}


def build_sitemap(manifest: dict[str, Any]) -> None:
    today = datetime.now(timezone.utc).date().isoformat()
    urls = ["/", "/fine-art/", "/writing/", "/design/"]
    urls.extend(entry["route"] for entry in manifest["projects"].values())
    body = "\n".join(
        f"  <url><loc>{ORIGIN}{route}</loc><lastmod>{today}</lastmod></url>" for route in urls
    )
    sitemap = f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{body}\n</urlset>\n'
    (ROOT / "sitemap.xml").write_text(sitemap, encoding="utf-8")


def main() -> None:
    archive = fetch_archive()
    reset_generated_output()
    media, originals = download_images(archive.get("projects", []))
    manifest = build_routes(archive, media, originals)
    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data/site-index.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    build_sitemap(manifest)
    print(f"generated {len(manifest['projects'])} project routes and {len(media)} responsive image records")


if __name__ == "__main__":
    main()
