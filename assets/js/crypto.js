import { associatedData, lookupMessage } from './domain.js';
const encoder = new TextEncoder();
export const hex = (data) => Array.from(new Uint8Array(data), n => n.toString(16).padStart(2, '0')).join('');
export function fromBase64(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Codificación inválida.');
    return Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
}
export async function deriveKeys(raw, saltBase64) {
    if (raw.byteLength !== 32) throw new Error('Longitud de clave incorrecta.');
    if (!globalThis.crypto?.subtle) throw new Error('Se requiere HTTPS o localhost y Web Crypto.');
    const material = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
    const derive = async (context) => crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256',
        salt: fromBase64(saltBase64), info: encoder.encode(context) }, material, 256);
    const searchBits = await derive('kalaguichi:v1:busqueda');
    const dataBits = await derive('kalaguichi:v1:datos');
    const search = await crypto.subtle.importKey('raw', searchBits,
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const data = await crypto.subtle.importKey('raw', dataBits, 'AES-GCM', false, ['decrypt']);
    new Uint8Array(searchBits).fill(0); new Uint8Array(dataBits).fill(0);
    return { search, data };
}
export async function getLookupId(keys, manifest, cedula, nacimiento) {
    return hex(await crypto.subtle.sign('HMAC', keys.search,
        encoder.encode(lookupMessage(manifest, cedula, nacimiento))));
}
export async function decryptRecord(keys, manifest, row) {
    const iv = typeof row.nonce === 'string' ? fromBase64(row.nonce) : new Uint8Array(row.nonce);
    const data = typeof row.ciphertext === 'string' ? fromBase64(row.ciphertext) : new Uint8Array(row.ciphertext);
    if (iv.byteLength !== 12 || data.byteLength < 16) throw new Error('Ficha cifrada inválida.');
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128,
        additionalData: encoder.encode(associatedData(manifest, row.lookup_id)) }, keys.data, data);
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clear));
    } finally { new Uint8Array(clear).fill(0); }
}
export async function sha256(data) { return hex(await crypto.subtle.digest('SHA-256', data)); }
