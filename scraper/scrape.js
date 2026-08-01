import * as cheerio from "cheerio";
import { writeFile, mkdir } from "node:fs/promises";
import { AREAS } from "./areas.js";

const BASE = "https://eiga.com";
const PREF = "14";
const UA =
  "Mozilla/5.0 (compatible; eiga-planner-bot/1.0; +https://github.com/) personal-non-commercial-schedule-fetch";

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function collectTheaters() {
  const theaters = new Map();
  for (const area of AREAS) {
    const url = `${BASE}/theater/${PREF}/${area.id}/`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    $(".area-theater li[data-id]").each((_, el) => {
      const id = $(el).attr("data-id");
      const name = $(el).find("a").first().text().trim();
      const address = $(el).find("p").first().text().trim();
      const href = $(el).find("a").first().attr("href");
      if (!id || !name || !href) return;
      if (!theaters.has(id)) {
        theaters.set(id, {
          id,
          name,
          area: area.name,
          areaId: area.id,
          address,
          url: `${BASE}${href}`,
        });
      }
    });
    await sleep(300);
  }
  return [...theaters.values()];
}

// Builds a unix timestamp (seconds) from a YYYYMMDD date + JST wall-clock
// hour/minute. Handles the "25:xx" style next-day-early-morning notation
// some theaters use for late-night shows.
function timestampFromJst(dateStr, hourStr, minuteStr) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10);
  const day = parseInt(dateStr.slice(6, 8), 10);
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  let dayOffset = 0;
  if (hour >= 24) {
    hour -= 24;
    dayOffset = 1;
  }
  const utcMs = Date.UTC(year, month - 1, day + dayOffset, hour - 9, minute);
  return Math.floor(utcMs / 1000);
}

function parseTheaterSchedule($, theater) {
  const screenings = [];
  $("section[id^='m'][data-title]").each((_, section) => {
    const $section = $(section);
    const runtimeText = $section.find(".movie-image p.data span").eq(1).text().trim();
    const runtimeMin = parseInt(runtimeText, 10) || null;
    const movieUrl = $section.find("h2 a").first().attr("href") || "";
    const movieId = (movieUrl.match(/\/movie\/(\d+)\//) || [])[1] || null;

    $section.find("div.movie-schedule").each((__, block) => {
      const $block = $(block);
      const title = $block.attr("data-title")?.trim();
      if (!title) return;
      const typeLabel = $block.find(".movie-type").text().trim() || null;

      $block.find("table.weekly-schedule td[data-date]").each((___, td) => {
        const $td = $(td);
        const date = $td.attr("data-date");
        if (!date) return;
        // Some chains (TOHO, HUMAX, ...) render times as plain <span> with
        // no booking link / no data-time timestamp, instead of <a data-time>.
        $td.children("a[data-time], span").each((____, node) => {
          const $node = $(node);
          const rawText = $node.text().trim();
          const match = rawText.match(/^(\d{1,2}):(\d{2})/);
          if (!match) return;
          const time = `${match[1]}:${match[2]}`;
          const explicitTimestamp = parseInt($node.attr("data-time"), 10);
          const timestamp = Number.isFinite(explicitTimestamp)
            ? explicitTimestamp
            : timestampFromJst(date, match[1], match[2]);
          screenings.push({
            theaterId: theater.id,
            movieId,
            title,
            typeLabel,
            runtimeMin,
            date,
            time,
            timestamp,
          });
        });
      });
    });
  });
  return screenings;
}

async function collectScreenings(theaters) {
  const all = [];
  for (const theater of theaters) {
    try {
      const html = await fetchHtml(theater.url);
      const $ = cheerio.load(html);
      const screenings = parseTheaterSchedule($, theater);
      all.push(...screenings);
      console.log(`  ${theater.name}: ${screenings.length} screenings`);
    } catch (err) {
      console.error(`  failed ${theater.name}: ${err.message}`);
    }
    await sleep(400);
  }
  return all;
}

async function main() {
  console.log("Collecting theaters...");
  const theaters = await collectTheaters();
  console.log(`Found ${theaters.length} theaters`);

  console.log("Collecting screenings...");
  const screenings = await collectScreenings(theaters);
  console.log(`Found ${screenings.length} screenings total`);

  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("../data/theaters.json", import.meta.url),
    JSON.stringify(theaters, null, 2),
  );
  await writeFile(
    new URL("../data/screenings.json", import.meta.url),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), screenings },
      null,
      2,
    ),
  );
  console.log("Wrote data/theaters.json and data/screenings.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
