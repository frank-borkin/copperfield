// Generates the service worker (public/sw.js) at *container start time*, not
// build time, so the precache list always reflects whatever media files are
// actually present in the image/volume when the server boots.
//
// The worker precaches every file under public/media so the room screen can
// play intro/outro videos, background music and clue sounds even if the
// network is slow or briefly drops. The list is embedded in the worker and the
// cache name is derived from a hash of that list, so a changed media set
// produces a new cache and evicts the old one.

import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import fs from 'fs'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PUBLIC_DIR = path.join(__dirname, 'public')
const MEDIA_DIR = path.join(PUBLIC_DIR, 'media')
const SW_PATH = path.join(PUBLIC_DIR, 'sw.js')

// Files we never want to cache (OS cruft, VCS metadata).
const IGNORED = new Set(['.DS_Store', '.gitattributes', '.gitignore'])

// Recursively collect every file under `dir`, returning absolute paths. Uses
// statSync (which follows symlinks) rather than the dirent type, because the
// media subfolders are often symlinks to game asset directories, and a symlink
// reports neither isDirectory() nor isFile().
function collectFiles(dir) {
    let out = []
    let entries
    try {
        entries = fs.readdirSync(dir)
    } catch {
        // Media dir may not exist in some deployments; just precache nothing.
        return out
    }
    for (const name of entries) {
        if (IGNORED.has(name)) {
            continue
        }
        const full = path.join(dir, name)
        let stat
        try {
            stat = fs.statSync(full) // follows symlinks
        } catch {
            continue // broken symlink or unreadable entry
        }
        if (stat.isDirectory()) {
            out = out.concat(collectFiles(full))
        } else if (stat.isFile()) {
            out.push(full)
        }
    }
    return out
}

// Turn an absolute filesystem path into the URL the browser requests. Media
// lives under public/, which is the static root, so the URL is the path
// relative to public/ with POSIX separators and each segment encoded.
function toUrl(absPath) {
    const rel = path.relative(PUBLIC_DIR, absPath)
    const parts = rel.split(path.sep).map((seg) => encodeURIComponent(seg))
    return '/' + parts.join('/')
}

export function generateServiceWorker() {
    const files = collectFiles(MEDIA_DIR)
    const urls = files.map(toUrl).sort()

    // Cache name is tied to the content of the precache list. A different media
    // set -> different hash -> new cache -> old one cleaned up on activate.
    const hash = createHash('sha256')
        .update(urls.join('\n'))
        .digest('hex')
        .slice(0, 12)
    const cacheName = `copperfield-media-${hash}`

    const sw = `// AUTO-GENERATED at container start by generate-sw.js. Do not edit by hand.
const CACHE_NAME = ${JSON.stringify(cacheName)}
const PRECACHE_URLS = ${JSON.stringify(urls, null, 4)}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) =>
                // Add each URL individually so one missing/oversized file does
                // not abort the whole install (cache.addAll is all-or-nothing).
                Promise.all(
                    PRECACHE_URLS.map((url) =>
                        cache.add(url).catch((err) => {
                            console.warn('[sw] precache failed', url, err)
                        })
                    )
                )
            )
            .then(() => self.skipWaiting())
    )
})

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter(
                            (key) =>
                                key.startsWith('copperfield-media-') &&
                                key !== CACHE_NAME
                        )
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    )
})

self.addEventListener('fetch', (event) => {
    const request = event.request
    const url = new URL(request.url)

    // Only handle same-origin media requests; everything else (sockets, HTML,
    // Google Fonts, etc.) goes straight to the network.
    if (url.origin !== self.location.origin || !url.pathname.startsWith('/media/')) {
        return
    }

    // Cache-first: media is effectively immutable, so a cache hit wins. On a
    // miss we fetch, and if it's a full (200) response we stash a copy. Range
    // requests (206) are passed through without caching to keep media seeking
    // working correctly.
    event.respondWith(
        caches.open(CACHE_NAME).then((cache) =>
            cache.match(request).then((cached) => {
                if (cached) {
                    return cached
                }
                return fetch(request).then((response) => {
                    if (response && response.status === 200) {
                        cache.put(request, response.clone())
                    }
                    return response
                })
            })
        )
    )
})
`

    fs.writeFileSync(SW_PATH, sw)
    return { cacheName, count: urls.length }
}
