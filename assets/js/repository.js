import { normalizeCedula, validISODate, triState } from './domain.js';
import { fromBase64, deriveKeys, getLookupId, decryptRecord, sha256, hex } from './crypto.js';

/** Modos admitidos. El padrón cifrado (tools/cifrar_padron.py) solo corre en localhost:
 * publicarlo sigue bloqueado hasta resolver plan.md P7. La clave servida no es un secreto. */
const MODES = {
    'synthetic-demo': { kind: 'synthetic-demo', keySource: 'same-origin-demo-file', keyHash: 'demo_key_sha256', synthetic: true },
    'nominal-local': { kind: 'nominal', keySource: 'same-origin-file', keyHash: 'key_sha256', synthetic: false }
};
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;

const HEADER = 12;  // "KLG3", bits de bloque, reservado y cantidad; sigue el índice de bloques.

function compatibleManifest(m, mode) {
    const common = m.kind === mode.kind && m.algorithm === 'AES-256-GCM' && m.kdf === 'HKDF-SHA-256'
        && ID.test(m.dataset_id) && ID.test(m.eleccion_id);
    const v1 = m.schema_version === 1 && ['encrypted-json', 'encrypted-parquet'].includes(m.format)
        && [1, 2, 3].includes(m.shard_prefix_length) && m.shards && typeof m.shards === 'object';
    const v3 = m.schema_version === 3 && m.format === 'encrypted-bin-ranges' && m.lookup_bytes === 16
        && Number.isInteger(m.file_bits) && m.file_bits >= 0 && m.file_bits <= 4
        && Array.isArray(m.files) && m.files.length === 2 ** m.file_bits
        && m.files.every((f, i) => f?.file === `padron-${i.toString(16)}.bin` && Number.isInteger(f.bucket_bits)
            && f.bucket_bits >= 0 && f.bucket_bits <= 20 && Number.isInteger(f.bytes) && f.bytes >= HEADER + 4 * (2 ** f.bucket_bits + 1))
        && Array.isArray(m.ficha) && m.ficha.every(f => typeof f === 'string' && NAME.test(f.replace(/^@/, '')))
        && /^catalogo-[0-9a-f]{16}\.json$/.test(m.catalogo?.file ?? '') && /^[0-9a-f]{64}$/.test(m.catalogo.sha256 ?? '')
        && m.catalogo.file.slice(9, 25) === m.catalogo.sha256.slice(0, 16) && Number.isInteger(m.catalogo.bytes);
    return common && (v1 || v3);
}

/** Bloque v3 (tools/cifrar_padron.py): fichas ordenadas con identificador de 16 bytes, nonce de 12,
 * largo uint16 LE y ciphertext. Todas deben pertenecer al bloque pedido (mismos bits iniciales). */
export function findBucketRow(bytes, lookupId, shift) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const bucketOf = id => Math.floor(parseInt(id.slice(0, 8), 16) / 2 ** shift);
    const expected = bucketOf(lookupId);
    let offset = 0, previous = '', row = null;
    while (offset < bytes.length) {
        if (offset + 30 > bytes.length) throw new Error('Contenedor inválido.');
        const id = hex(bytes.subarray(offset, offset + 16));
        const length = view.getUint16(offset + 28, true);
        const end = offset + 30 + length;
        if (id <= previous || bucketOf(id) !== expected || length < 16 || end > bytes.length) throw new Error('Contenedor inválido.');
        if (id === lookupId) row = { lookup_id: id, nonce: bytes.slice(offset + 16, offset + 28), ciphertext: bytes.slice(offset + 30, end) };
        previous = id; offset = end;
    }
    return row;
}

/** Reconstruye registros de ficha posicional: valores propios + filas del catálogo público; faltante = NULL. */
export function expandRecords(payload, ficha, catalog, cedula, nacimiento) {
    if (!Array.isArray(payload) || !payload.length) throw new Error('Ficha sin registros válidos.');
    return payload.map((values) => {
        if (!Array.isArray(values) || values.length > ficha.length) throw new Error('Ficha incompatible con la consulta.');
        const record = { cedula, nacimiento };
        ficha.forEach((field, i) => {
            const value = values[i] ?? null;
            if (!field.startsWith('@')) { record[field] = value; return; }
            const group = catalog[field.slice(1)];
            const entry = value === null ? null : group.valores[value];
            if (value !== null && (!Number.isInteger(value) || !Array.isArray(entry))) throw new Error('Ficha incompatible con la consulta.');
            group.campos.forEach((name, k) => { record[name] = entry ? entry[k] ?? null : null; });
        });
        return record;
    });
}

function validCatalog(catalog, ficha) {
    return !!catalog && typeof catalog === 'object' && ficha.filter(f => f.startsWith('@')).every((f) => {
        const group = Object.hasOwn(catalog, f.slice(1)) ? catalog[f.slice(1)] : null;
        return !!group && Array.isArray(group.campos) && group.campos.every(c => typeof c === 'string' && NAME.test(c))
            && Array.isArray(group.valores) && group.valores.every(v => Array.isArray(v) && v.length === group.campos.length);
    });
}

/** Una clave pública NO autoriza ni autentica al titular. */
export class ElectoralRepository {
    constructor(base = new URL('../../', import.meta.url)) { this.base = base; }
    resolve(path) {
        const url = new URL(path, this.base);
        if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname)
            || url.search || url.hash || url.username || url.password) {
            throw new Error('Origen o ruta de datos no autorizado.');
        }
        return url;
    }
    async load(path, signal, maxBytes = 2_000_000, cache = 'no-store') {
        const response = await fetch(this.resolve(path), { credentials: 'omit', cache,
            referrerPolicy: 'no-referrer', signal });
        if (!response.ok) throw new Error('No fue posible cargar los archivos de la consulta.');
        return this.read(response, maxBytes);
    }
    /** Lectura parcial HTTP Range: el servidor debe responder 206 con exactamente el rango pedido. */
    async range(path, start, length, total, signal) {
        const end = start + length - 1;
        const response = await fetch(this.resolve(path), { credentials: 'omit', cache: 'no-store',
            referrerPolicy: 'no-referrer', signal, headers: { Range: `bytes=${start}-${end}` } });
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
        if (response.status !== 206 || !match || Number(match[1]) !== start || Number(match[2]) !== end || Number(match[3]) !== total) {
            await response.body?.cancel();
            throw new Error('El servidor no devolvió la lectura parcial pedida (HTTP Range).');
        }
        const bytes = await this.read(response, length);
        if (bytes.length !== length) throw new Error('Respuesta parcial incompleta.');
        return bytes;
    }
    async read(response, maxBytes) {
        const length = Number(response.headers.get('Content-Length'));
        if (Number.isFinite(length) && length > maxBytes) throw new Error('Archivo demasiado grande.');
        const reader = response.body?.getReader();
        if (!reader) {
            const buf = new Uint8Array(await response.arrayBuffer());
            if (buf.length > maxBytes) throw new Error('Archivo demasiado grande.');
            return buf;
        }
        const chunks = []; let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > maxBytes) { await reader.cancel(); throw new Error('Archivo demasiado grande.'); }
            chunks.push(value);
        }
        const output = new Uint8Array(total); let offset = 0;
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
        return output;
    }
    async initialize(signal) {
        // Se recarga el manifiesto por consulta: no se conservan fichas descifradas en un caché.
        const config = JSON.parse(new TextDecoder().decode(await this.load('config/app.json', signal, 8192)));
        const mode = Object.hasOwn(MODES, config.mode) ? MODES[config.mode] : null;
        if (!mode || config.public_key_acknowledged !== true) {
            throw new Error('Publicación nominal bloqueada: este paquete solo admite datos sintéticos.');
        }
        if (!mode.synthetic && !LOCAL_HOSTS.has(this.base.hostname)) {
            throw new Error('Publicación nominal bloqueada: el padrón cifrado solo se consulta en localhost.');
        }
        const manifest = JSON.parse(new TextDecoder().decode(await this.load(config.manifest, signal, 1_000_000)));
        if (!compatibleManifest(manifest, mode)) throw new Error('Manifiesto de prueba incompatible.');
        if (config.key_source?.type !== mode.keySource) {
            throw new Error('Fuente de clave no admitida en este prototipo.');
        }
        const keyBytes = fromBase64(new TextDecoder().decode(await this.load(config.key_source.path, signal, 256)).trim());
        try {
            if (await sha256(keyBytes) !== manifest[mode.keyHash]) throw new Error('La clave no corresponde al conjunto publicado.');
            this.keys = await deriveKeys(keyBytes, manifest.salt_base64);
        }
        finally { keyBytes.fill(0); }
        this.mode = mode;
        this.manifest = manifest;
        this.manifestDir = config.manifest.slice(0, config.manifest.lastIndexOf('/') + 1);
    }
    async lookup(cedula, nacimiento, signal) {
        cedula = normalizeCedula(cedula);
        if (!validISODate(nacimiento)) throw new Error('Ingresá una fecha de nacimiento válida.');
        await this.initialize(signal);
        const registros = this.manifest.schema_version === 3
            ? await this.lookupRanges(cedula, nacimiento, signal)
            : await this.lookupJson(cedula, nacimiento, signal);
        for (const record of registros) {
            if (!record || (this.mode.synthetic && record._synthetic !== true) || normalizeCedula(record.cedula) !== cedula
                || record.nacimiento !== nacimiento) throw new Error('Ficha incompatible con la consulta.');
            triState(record.voto); triState(record.fallecido);
        }
        return registros;
    }
    async lookupRanges(cedula, nacimiento, signal) {
        const manifest = this.manifest;
        const id = (await getLookupId(this.keys, manifest, cedula, nacimiento)).slice(0, 32);
        const x = parseInt(id.slice(0, 8), 16);
        const file = manifest.files[Math.floor(x / 2 ** (32 - manifest.file_bits))];
        const shift = 32 - manifest.file_bits - file.bucket_bits;
        const bucket = Math.floor(x / 2 ** shift) % 2 ** file.bucket_bits;
        const path = this.manifestDir + file.file;
        // Se leen 8 bytes del índice (inicio y fin del bloque) y luego solo el bloque: nunca el archivo.
        const bounds = await this.range(path, HEADER + 4 * bucket, 8, file.bytes, signal);
        const view = new DataView(bounds.buffer, bounds.byteOffset, 8);
        const start = view.getUint32(0, true), end = view.getUint32(4, true);
        if (start < HEADER + 4 * (2 ** file.bucket_bits + 1) || end < start || end > file.bytes || end - start > 4_000_000) {
            throw new Error('Índice de archivos inválido.');
        }
        if (start === end) return [];
        const row = findBucketRow(await this.range(path, start, end - start, file.bytes, signal), id, shift);
        if (!row) return [];
        // Catálogo público, igual para todos y con nombre según su hash: el navegador puede reutilizarlo.
        const spec = manifest.catalogo;
        const raw = await this.load(this.manifestDir + spec.file, signal, 4_000_000, 'default');
        if (raw.length !== spec.bytes || await sha256(raw) !== spec.sha256) throw new Error('Falló la comprobación de integridad del archivo.');
        const catalog = JSON.parse(new TextDecoder().decode(raw));
        if (!validCatalog(catalog, manifest.ficha)) throw new Error('Catálogo incompatible.');
        return expandRecords(await decryptRecord(this.keys, manifest, row), manifest.ficha, catalog, cedula, nacimiento);
    }
    async lookupJson(cedula, nacimiento, signal) {
        const manifest = this.manifest;
        const id = await getLookupId(this.keys, manifest, cedula, nacimiento);
        const prefix = id.slice(0, manifest.shard_prefix_length);
        const shard = manifest.shards[prefix];
        if (!shard) return [];
        const ext = manifest.format === 'encrypted-json' ? 'json' : 'parquet';
        if (shard.file !== `shards/${prefix}.${ext}` || !/^[0-9a-f]{64}$/.test(shard.sha256)) {
            throw new Error('Índice de archivos inválido.');
        }
        const bytes = await this.load(this.manifestDir + shard.file, signal, 8_000_000);
        if (bytes.length !== shard.bytes || await sha256(bytes) !== shard.sha256) {
            throw new Error('Falló la comprobación de integridad del archivo.');
        }
        let row;
        if (manifest.format === 'encrypted-json') {
            const rows = JSON.parse(new TextDecoder().decode(bytes));
            if (!Array.isArray(rows) || rows.length !== shard.rows) throw new Error('Contenedor inválido.');
            const matched = rows.filter(item => item?.lookup_id === id);
            if (matched.length > 1) throw new Error('Índice duplicado: revisar la exportación.');
            row = matched[0];
        } else {
            const { selectEncryptedRow } = await import('./parquet-reader.js');
            row = await selectEncryptedRow(bytes, id, this.base);
        }
        if (!row) return [];
        const payload = await decryptRecord(this.keys, manifest, row);
        if (!payload || !Array.isArray(payload.registros) || !payload.registros.length) {
            throw new Error('Ficha sin registros válidos.');
        }
        return payload.registros;
    }
    get nominal() { return this.mode?.synthetic === false; }
    clear() { this.keys = null; this.manifest = null; this.mode = null; }
}
