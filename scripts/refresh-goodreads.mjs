import { writeFile } from "node:fs/promises";

const profileUrl = "https://www.goodreads.com/user/show/34056305-tz";
const response = await fetch(profileUrl, {
  headers: {
    "user-agent": "Tiona-Zeng-Portfolio-Reading-List/1.0",
    accept: "text/html,application/xhtml+xml"
  }
});

if (!response.ok) throw new Error("Goodreads responded with " + response.status);

const html = await response.text();
const books = [...html.matchAll(/<a class="bookTitle" href="([^"]+)">([^<]+)<\/a>[\s\S]{0,500}?<a class="authorName"[^>]*>([^<]+)<\/a>/g)]
  .slice(0, 8)
  .map(([, path, title, author]) => ({
    title: title.trim(),
    author: author.trim(),
    url: new URL(path, profileUrl).href
  }));

if (!books.length) throw new Error("Could not find any current-reading books on Goodreads.");

await writeFile(
  new URL("../data/current-reading.json", import.meta.url),
  JSON.stringify({ updatedAt: new Date().toISOString(), source: profileUrl, books }, null, 2) + "\n"
);
