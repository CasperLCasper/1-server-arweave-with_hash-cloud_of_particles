import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startCleanupCron } from './cron-runner.js';

if (!globalThis.File) {
    const { File, Blob } = await import('node:buffer');
    globalThis.File = File;
    globalThis.Blob = Blob;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use((req, res, next) => {
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        let data = [];
        req.on('data', chunk => data.push(chunk));
        req.on('end', () => { req.rawBody = Buffer.concat(data); next(); });
    } else { next(); }
});

app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net chrome-extension:; connect-src 'self' https: wss: chrome-extension:; img-src 'self' data: https: blob:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; media-src 'self' blob:; video-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; manifest-src 'self'; worker-src 'self' blob:; upgrade-insecure-requests;");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

function parseBoundary(contentType) {
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    return match ? '--' + (match[1] || match[2]) : null;
}

function parsePartHeaders(headerStr) {
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const typeMatch = headerStr.match(/Content-Type:\s*([^\s\r\n]+)/);
    return {
        key: nameMatch ? nameMatch[1] : null,
        filename: filenameMatch ? filenameMatch[1] : null,
        mimeType: typeMatch ? typeMatch[1] : 'image/png'
    };
}

function extractParts(buffer, boundary) {
    const parts = [];
    let offset = 0;
    while ((offset = buffer.indexOf(boundary, offset)) !== -1) {
        offset += boundary.length;
        if (buffer[offset] === 0x2d && buffer[offset + 1] === 0x2d) break;
        offset += 2;
        const nextBoundary = buffer.indexOf(boundary, offset);
        if (nextBoundary === -1) break;
        const part = buffer.subarray(offset, nextBoundary);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
            parts.push({
                headerStr: part.subarray(0, headerEnd).toString('utf-8'),
                body: part.subarray(headerEnd + 4, part.length - 2)
            });
        }
        offset = nextBoundary;
    }
    return parts;
}

function parseMultipartFormData(rawBody, contentType) {
    const storage = {};
    const boundary = parseBoundary(contentType);
    if (!boundary) return storage;
    const parts = extractParts(rawBody, boundary);
    for (const part of parts) {
        const { key, filename, mimeType } = parsePartHeaders(part.headerStr);
        if (!key) continue;
        if (filename) {
            storage[key] = new File([part.body], filename, { type: mimeType });
        } else {
            storage[key] = part.body.toString('utf-8');
        }
    }
    return storage;
}

function createCloudflareAdapter(handler) {
    return async (req, res) => {
        try {
            const headersEmulator = { ...req.headers, get: (headerName) => req.headers[headerName.toLowerCase()] || null };
            const context = {
                env: process.env,
                request: {
                    json: async () => req.body,
                    formData: async () => {
                        const storage = req.rawBody ? parseMultipartFormData(req.rawBody, req.headers['content-type']) : {};
                        if (req.body) Object.keys(req.body).forEach(key => { storage[key] = req.body[key]; });
                        return { get: (key) => storage[key] || null, has: (key) => key in storage };
                    },
                    url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
                    headers: headersEmulator
                },
                params: req.params
            };

            const cfResponse = await handler(context);
            if (cfResponse && (cfResponse instanceof Response || typeof cfResponse.json === 'function')) {
                res.status(cfResponse.status || 200);
                if (cfResponse.headers && typeof cfResponse.headers.forEach === 'function') {
                    cfResponse.headers.forEach((value, key) => res.setHeader(key, value));
                } else { res.setHeader('Content-Type', 'application/json'); }
                try { return res.json(await cfResponse.json()); } catch { return res.send(await cfResponse.text()); }
            }
            if (cfResponse && typeof cfResponse === 'object') return res.json(cfResponse);
            res.status(200).end();
        } catch (err) {
            console.error('Kļūda adapterī izpildot maršrutu:', err);
            res.status(500).json({ error: "Internal Server Error", message: err.message });
        }
    };
}

function registerRoute(app, fullRoute, module) {
    const getHandler = module.onRequestGet || module.onRequestGET || module.onrequestget;
    const postHandler = module.onRequestPost || module.onRequestPOST || module.onrequestpost;
    const genericHandler = module.onRequest || module.onRequestGeneric;
    const defaultHandler = module.default;
    if (getHandler) app.get(fullRoute, createCloudflareAdapter(getHandler));
    if (postHandler) app.post(fullRoute, createCloudflareAdapter(postHandler));
    if (genericHandler) app.all(fullRoute, createCloudflareAdapter(genericHandler));
    if (defaultHandler && !getHandler && !postHandler && !genericHandler) app.all(fullRoute, defaultHandler);
}

async function walkRoutes(dir, routePrefix = '/api') {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            await walkRoutes(fullPath, `${routePrefix}/${file}`);
        } else if (file.endsWith('.js')) {
            const routeName = file === 'index.js' ? '' : `/${file.slice(0, -3)}`;
            const fullRoute = `${routePrefix}${routeName}`.toLowerCase();
            try {
                const module = await import(new URL(`file://${fullPath}`).href);
                registerRoute(app, fullRoute, module);
                console.log(`Reģistrēts maršruts: ${fullRoute}`);
            } catch (e) {
                console.error(`Kļūda ielādējot maršrutu ${fullRoute}:`, e);
            }
        }
    }
}

await walkRoutes(path.join(__dirname, 'functions', 'api'));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => { console.log(`Serveris aktīvs uz porta ${PORT}`); startCleanupCron(); });
