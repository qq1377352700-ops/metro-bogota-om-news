import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const source = 'https://www.metrodebogota.gov.co/noticias';
const pages = 6;
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
  const text = normalize(`${title} ${teaser}`);
  const result = [];
  if (/\b(operacion (ferroviaria|comercial|del metro|y mantenimiento|de los trenes)|puesta en servicio|puesta en marcha|inicio de la operacion|marcha blanca|operacion sin conductor|centro de control)\b/.test(text)) result.push('operacion');
  if (/\b(mantenimiento (ferroviario|preventivo|correctivo|de trenes|de los trenes|y operacion|del metro)|operacion y mantenimiento|patio[ -]taller|taller de mantenimiento|talleres de mantenimiento)\b/.test(text) || /\bmantenimiento\b/.test(heading) && !/\b(malla vial|calzada|cierre vial|espacio publico)\b/.test(heading)) result.push('mantenimiento');
  if (/\b(pruebas (dinamicas|estaticas|operativas|tecnicas|de marcha|de los trenes|del tren)|periodo de pruebas|tren(?:es)? (inicia[n]?|comienza[n]?) (?:sus )?pruebas|marcha blanca|senalizacion ferroviaria|cbtc)\b/.test(text) || /\bpruebas\b/.test(heading) && /\b(tren(?:es)?|metro|ferroviari[oa])\b/.test(heading)) result.push('pruebas');
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
    hits.push({ title, url: url.origin + url.pathname, publishedAt: new Date(stamp).toISOString(), tags });
  }
  if (!hits.length) throw new Error('El listado oficial no devolvió noticias reconocibles');
  return hits;
}

export async function fetchSnapshot(fetchPage = fetch) {
  const listings = await Promise.all(Array.from({ length: pages }, async (_, index) => {
    const url = new URL(source);
    if (index) url.searchParams.set('page', String(index));
    const response = await fetchPage(url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(18_000) });
    if (!response.ok) throw new Error(`Índice oficial ${index + 1}: HTTP ${response.status}`);
    return parseListing(await response.text());
  }));
  const all = new Map();
  for (const record of listings.flat()) if (!all.has(record.url)) all.set(record.url, record);
  if (all.size < pages * 5) throw new Error('La paginación oficial devolvió demasiados duplicados');
  const items = [...all.values()].filter(item => item.tags.length).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title, 'es'));
  return { version: 1, syncedAt: new Date().toISOString(), scanned: all.size, items };
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
