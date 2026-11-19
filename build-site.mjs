import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const source = 'https://www.metrodebogota.gov.co/noticias';
const pages = 6;
const citySource = 'https://bogota.gov.co/tag/metro-de-bogota';
const archive = [{
  title: 'Bogotá recibe el tren número 21 en el Patio Taller de Bosa y el tren 22 en Cartagena',
  url: 'https://www.metrodebogota.gov.co/noticias/bogota-recibe-tren-numero-21-patio-taller-bosa-y-tren-22-cartagena',
  publishedAt: '2026-10-22T12:00:00.000Z',
  tags: ['mantenimiento', 'trenes'],
  publisher: 'Empresa Metro de Bogotá',
  archived: true
}];
const entities = { amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', rsquo: '’', ldquo: '“', rdquo: '”' };

function plain(value) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, symbol) => {
    if (symbol.startsWith('#')) {
      const hex = symbol[1]?.toLowerCase() === 'x';
      const point = Number.parseInt(symbol.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return entities[symbol] || match;
  }).replace(/\s+/g, ' ').trim();
}

export const normalize = text => text.normalize('NFD').replace(/\p{Mark}/gu, '').toLowerCase();

export function topics(title, teaser) {
  const heading = normalize(title);
  if (/\btransmilenio\b/.test(heading) && !/\b(tren(?:es)?|ferroviari[oa]|linea [12] del metro)\b/.test(heading)) return [];
  const text = normalize(`${title} ${teaser}`);
  const result = [];
  if (/\b(operacion (ferroviaria|comercial|del metro|y mantenimiento|de los trenes)|puesta en servicio|puesta en marcha|inicio de la operacion|marcha blanca|operacion sin conductor|centro de control)\b/.test(text)) result.push('operacion');
  if (/\b(mantenimiento (ferroviario|preventivo|correctivo|de trenes|de los trenes|y operacion|del metro)|operacion y mantenimiento|taller de mantenimiento|talleres de mantenimiento)\b/.test(text) || /\bmantenimiento\b/.test(heading) && !/\b(malla vial|calzada|cierre vial|espacio publico)\b/.test(heading) || /\bpatio[ -]taller\b/.test(heading) && /\b(tren(?:es)?|mantenimiento|equipos|inicio|instalacion)\b/.test(heading)) result.push('mantenimiento');
  if (/\b(pruebas (dinamicas|estaticas|operativas|tecnicas|de marcha|de los trenes|del tren)|periodo de pruebas|fase de pruebas|recorridos de prueba|pruebas en via|homologacion ferroviaria|tren(?:es)? (inicia[n]?|comienza[n]?) (?:sus )?pruebas|marcha blanca|senalizacion ferroviaria|cbtc)\b/.test(text) || /\bpruebas\b/.test(heading) && /\b(tren(?:es)?|metro|ferroviari[oa])\b/.test(heading)) result.push('pruebas');
  if (/\b(tren(?:es)?|flota ferroviaria|material rodante)\b/.test(heading) && !/\b(tren de cercanias|regiotram|maqueta)\b/.test(heading)) result.push('trenes');
  return result;
}

export function parseListing(html) {
  if (!html.includes('view-pagina-noticias')) throw new Error('No se encontró la vista oficial de noticias');
  const rows = html.split(/<div\s+class=["']views-row["']\s*>/i).slice(1);
  const hits = [];
  for (const row of rows) {
    const heading = row.match(/views-field-title["'][^>]*>[\s\S]*?<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const time = row.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i);
    if (!heading || !time) continue;
    const url = new URL(heading[1], source);
    if (url.origin !== new URL(source).origin || !url.pathname.startsWith('/noticias/')) continue;
    const stamp = Date.parse(time[1]);
    const title = plain(heading[2]);
    if (!Number.isFinite(stamp) || !title) continue;
    const teaser = row.match(/views-field-field-copete["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const tags = topics(title, plain(teaser));
    hits.push({ title, url: url.origin + url.pathname, publishedAt: new Date(stamp).toISOString(), tags, publisher: 'Empresa Metro de Bogotá' });
  }
  if (!hits.length) throw new Error('El listado oficial no devolvió noticias reconocibles');
  return hits;
}

function parseCityListing(html) {
  const hits = [];
  const cards = html.split(/<div class="tarjeta tarjeta-3 interna-entidades">/i).slice(1);
  for (const card of cards) {
    const anchor = card.match(/<h2\b[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*title="([^"]+)"/i);
    const time = card.match(/<time\b[^>]*datetime="([^"]+)"/i);
    if (!anchor || !time) continue;
    const url = new URL(anchor[1], citySource);
    const stamp = Date.parse(time[1]);
    const title = plain(anchor[2]);
    if (url.origin !== 'https://bogota.gov.co' || !url.pathname.startsWith('/mi-ciudad/movilidad/') || !title || !Number.isFinite(stamp)) continue;
    hits.push({ title, url: url.origin + url.pathname, publishedAt: new Date(stamp).toISOString(), tags: topics(title, ''), publisher: 'Portal Bogotá' });
  }
  return hits;
}

async function officialListings(url) {
  // Use the native HTTPS trust store and keep request concurrency low.
  const command = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $results = @()
    for ($index = 0; $index -lt $env:METRO_PAGE_COUNT; $index++) {
      $url = $env:METRO_SOURCE_URL
      if ($index -gt 0) { $url += '?page=' + $index }
      $response = Invoke-WebRequest -Uri $url -TimeoutSec 15 -MaximumRetryCount 1 -RetryIntervalSec 2
      $results += $response.Content
    }
    ConvertTo-Json -InputObject $results -Compress
  `;
  const { stdout } = await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, METRO_SOURCE_URL: url, METRO_PAGE_COUNT: String(pages) },
    timeout: 180_000,
    maxBuffer: 4_000_000,
    windowsHide: true
  });
  return JSON.parse(stdout);
}

async function collect(url, parse, minimum, fetchListings) {
  const documents = await fetchListings(url);
  if (!Array.isArray(documents) || documents.length !== pages) throw new Error('Faltan páginas en el listado oficial');
  const all = new Map();
  for (const document of documents) {
    for (const record of parse(document)) if (!all.has(record.url)) all.set(record.url, record);
  }
  if (all.size < minimum) throw new Error('Hay pocas noticias válidas en las páginas consultadas');
  return all;
}

export async function fetchSnapshot(fetchListings = officialListings) {
  let all, activeSource;
  try {
    all = await collect(source, parseListing, pages * 5, fetchListings);
    activeSource = 'Empresa Metro de Bogotá';
  } catch (error) {
    console.warn('Fuente principal no disponible:', error.message.slice(0, 650));
    all = await collect(citySource, parseCityListing, pages, fetchListings);
    activeSource = 'Portal Bogotá';
  }
  const items = [...all.values()].filter(item => item.tags.length);
  const liveMatches = items.length;
  const urls = new Set(items.map(item => item.url));
  items.push(...archive.filter(item => !urls.has(item.url)));
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title, 'es'));
  return { version: 1, syncedAt: new Date().toISOString(), activeSource, scanned: all.size, liveMatches, items };
}

async function build() {
  const snapshot = await fetchSnapshot();
  const template = await readFile(new URL('index.html', import.meta.url), 'utf8');
  const slot = '<script id="snapshot" type="application/json">null</script>';
  if (!template.includes(slot)) throw new Error('Falta el espacio para los datos iniciales');
  const data = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  const index = template.replace(slot, () => slot.replace('>null<', '>' + data + '<'));
  const out = new URL('_site/', import.meta.url);
  await mkdir(out, { recursive: true });
  await Promise.all([
    writeFile(new URL('index.html', out), index),
    writeFile(new URL('news.json', out), data + '\n')
  ]);
  console.log(`Consultadas ${snapshot.scanned} noticias oficiales. Coincidencias: ${snapshot.items.length}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  build().catch(error => { console.error(error); process.exitCode = 1; });
}
