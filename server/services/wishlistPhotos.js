import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from './db.js'

// Wishlist photos are downloaded and kept next to the DB rather than
// hotlinked, so they survive shops changing their pages or blocking
// referrers. Served at /api/wishlist-images/<file> (see server/index.js).
export const PHOTO_DIR = join(DATA_DIR, 'wishlist-images')
mkdirSync(PHOTO_DIR, { recursive: true })

const MAX_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 10000
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }
// Many shops serve a bot wall to unknown user agents; a normal browser UA
// gets the same HTML (and og:image tag) a person would see.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  'Accept-Language': 'en-GB,en;q=0.9'
}

export class PhotoError extends Error {}

// Pages used only as a source for a general picture (a festival, "running
// shoes") - not somewhere to buy it, so never kept as the item's shop link.
const PHOTO_LIBRARIES = /(^|\.)(wikipedia\.org|wikimedia\.org|unsplash\.com|pexels\.com|flickr\.com)$/

function checkUrl(raw) {
  let url
  try { url = new URL(raw) } catch { throw new PhotoError('That doesn\'t look like a link') }
  if (!/^https?:$/.test(url.protocol)) throw new PhotoError('Only http(s) links work')
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|\[::1\])/.test(url.hostname)) throw new PhotoError('Local addresses aren\'t allowed')
  return url
}

async function get(url, accept) {
  const r = await fetch(url, { headers: { ...HEADERS, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!r.ok) throw new PhotoError(`The site answered ${r.status}${r.status === 403 ? ' (it blocks automated visits)' : ''}`)
  return r
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x2F;/gi, '/')

// The product photo a shop advertises for link previews: og:image, then
// twitter:image, then a JSON-LD Product image, then <link rel=image_src>.
export function findImageInHtml(html) {
  const meta = name => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i')
    const tag = html.match(re)?.[0]
    return tag?.match(/content=["']([^"']+)["']/i)?.[1]
  }
  const fromMeta = meta('og:image:secure_url') || meta('og:image') || meta('twitter:image') || meta('twitter:image:src')
  if (fromMeta) return decode(fromMeta)

  for (const [, json] of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const found = json.match(/"image"\s*:\s*(?:\[\s*)?(?:\{[^}]*?"url"\s*:\s*)?"([^"]+)"/)
    if (found) return decode(found[1].replace(/\\\//g, '/'))
  }
  return html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i)?.[1]
}

function save(itemId, buffer, type) {
  const ext = EXTENSIONS[type.split(';')[0].trim()]
  if (!ext) throw new PhotoError('That isn\'t a supported image (jpg, png, webp, gif, avif)')
  if (buffer.length > MAX_BYTES) throw new PhotoError('That image is over 8 MB')
  const file = `${itemId}-${Date.now()}.${ext}`
  writeFileSync(join(PHOTO_DIR, file), buffer)
  return file
}

async function download(itemId, url) {
  const r = await get(url, 'image/*')
  const type = r.headers.get('content-type') || ''
  return save(itemId, Buffer.from(await r.arrayBuffer()), type)
}

/**
 * Saves a photo for an item from a link - either straight to an image, or
 * to a product page whose preview image is used. Returns { file, page },
 * where page is the link when it was a product page (worth keeping as the
 * item's shop link).
 */
export async function photoFromUrl(itemId, raw) {
  const url = checkUrl(raw)
  const r = await get(url, 'text/html,image/*;q=0.9,*/*;q=0.8')
  const type = r.headers.get('content-type') || ''
  if (type.startsWith('image/')) {
    return { file: save(itemId, Buffer.from(await r.arrayBuffer()), type), page: null }
  }
  const html = (await r.text()).slice(0, 2_000_000)
  const src = findImageInHtml(html)
  if (!src) throw new PhotoError('Couldn\'t find a product photo on that page - try pasting the image itself')
  const imageUrl = checkUrl(new URL(src, r.url || url).href)
  return { file: await download(itemId, imageUrl), page: PHOTO_LIBRARIES.test(url.hostname) ? null : url.href }
}

/** Saves an uploaded image sent as a data: URL. */
export function photoFromDataUrl(itemId, dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl || '')
  if (!m) throw new PhotoError('Expected an image file')
  return save(itemId, Buffer.from(m[2], 'base64'), m[1])
}

export function removePhoto(file) {
  if (!file || file.includes('/') || file.includes('..')) return
  const path = join(PHOTO_DIR, file)
  if (existsSync(path)) unlinkSync(path)
}
