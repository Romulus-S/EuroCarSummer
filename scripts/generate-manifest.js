#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, 'posts-manifest.json');
const DATE_FILENAME_PATTERN = /^(\d{1,2})[-_](\d{1,2})[-_](\d{2})\.html$/i;

const DATE_FORMATTER = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtml(value = '') {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity) => {
    const lower = entity.toLowerCase();
    if (lower in ENTITY_MAP) {
      return ENTITY_MAP[lower];
    }
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return full;
  });
}

function stripTags(value = '') {
  return decodeHtml(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function normaliseAssetPath(src = '') {
  const trimmed = src.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('./')) return trimmed.slice(2);
  if (trimmed.startsWith('/')) return trimmed.replace(/^\/+/, '');
  return trimmed;
}

function parseDateFromFilename(filename) {
  const match = DATE_FILENAME_PATTERN.exec(filename);
  if (!match) return null;
  const [, monthRaw, dayRaw, yearRaw] = match;
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  if ([month, day, year].some((value) => Number.isNaN(value))) {
    return null;
  }
  const fullYear = 2000 + year;
  const date = new Date(Date.UTC(fullYear, month - 1, day, 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDisplayDate(filename) {
  const date = parseDateFromFilename(filename);
  return date ? DATE_FORMATTER.format(date) : '';
}

function extractFirstMatch(html, pattern) {
  const match = pattern.exec(html);
  return match ? match[1] : '';
}

function extractImage(html) {
  const imgMatch = html.match(/<img\s[^>]*>/i);
  if (!imgMatch) {
    return { src: '', alt: '' };
  }
  const tag = imgMatch[0];
  const srcMatch = tag.match(/\ssrc\s*=\s*"([^"]*)"/i) || tag.match(/\ssrc\s*=\s*'([^']*)'/i);
  const altMatch = tag.match(/\salt\s*=\s*"([^"]*)"/i) || tag.match(/\salt\s*=\s*'([^']*)'/i);
  return {
    src: srcMatch ? normaliseAssetPath(decodeHtml(srcMatch[1])) : '',
    alt: altMatch ? stripTags(altMatch[1]) : '',
  };
}

function collectPostMetadata(filename) {
  const filePath = path.join(ROOT, filename);
  const html = fs.readFileSync(filePath, 'utf8');

  const title = stripTags(extractFirstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i))
    || stripTags(extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i))
    || filename.replace(/\.html?$/i, '');

  const dateText = stripTags(
    extractFirstMatch(html, /<time[^>]*>([\s\S]*?)<\/time>/i)
    || extractFirstMatch(html, /<em[^>]*>([\s\S]*?)<\/em>/i),
  ) || formatDisplayDate(filename);

  const { src, alt } = extractImage(html);
  const parsedDate = parseDateFromFilename(filename);

  return {
    slug: filename.replace(/\.html?$/i, ''),
    href: filename,
    title,
    dateText,
    imageSrc: src,
    imageAlt: alt || title,
    isoDate: parsedDate ? parsedDate.toISOString() : null,
  };
}

function comparePosts(a, b) {
  const timeA = a.isoDate ? new Date(a.isoDate).getTime() : 0;
  const timeB = b.isoDate ? new Date(b.isoDate).getTime() : 0;
  if (timeA !== timeB) {
    return timeB - timeA;
  }
  return (b.title || '').localeCompare(a.title || '');
}

function main() {
  const entries = fs.readdirSync(ROOT)
    .filter((name) => DATE_FILENAME_PATTERN.test(name))
    .map((name) => ({ name, date: parseDateFromFilename(name) }))
    .filter((entry) => entry.date instanceof Date && !Number.isNaN(entry.date.getTime()));

  const posts = entries
    .map((entry) => collectPostMetadata(entry.name))
    .sort(comparePosts)
    .map((post) => ({
      slug: post.slug,
      href: post.href,
      title: post.title,
      dateText: post.dateText,
      imageSrc: post.imageSrc,
      imageAlt: post.imageAlt,
      isoDate: post.isoDate,
    }));

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(posts, null, 2)}\n`, 'utf8');
  console.log(`Generated ${posts.length} Macchina del Giorno entries.`);
}

main();
