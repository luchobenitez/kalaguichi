/** Adaptador opcional. Requiere los archivos locales indicados en docs/PARQUET.md.
 * El camino DuckDB-Wasm no fue ejecutado en el entorno de entrega: faltó el runtime.
 * No hay fallback silencioso a datos sin cifrar.
 */
let runtimePromise;
async function runtime(base) {
    if (!runtimePromise) runtimePromise = (async () => {
        const root = new URL('assets/vendor/duckdb/', base);
        const duckdb = await import(new URL('duckdb-browser.mjs', root).href);
        const worker = new Worker(new URL('duckdb-browser-mvp.worker.js', root));
        const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
        await db.instantiate(new URL('duckdb-mvp.wasm', root).href);
        return db;
    })().catch(() => { runtimePromise = null; throw new Error('Falta instalar o validar DuckDB-Wasm; revisá docs/PARQUET.md.'); });
    return runtimePromise;
}
export async function selectEncryptedRow(bytes, lookupId, base) {
    if (!/^[0-9a-f]{64}$/.test(lookupId)) throw new Error('Identificador inválido.');
    const db = await runtime(base);
    const name = `shard_${crypto.randomUUID().replaceAll('-', '')}.parquet`;
    let conn; let stmt;
    try {
        await db.registerFileBuffer(name, bytes);
        conn = await db.connect();
        // El nombre lo genera el código; la entrada de búsqueda siempre es un parámetro.
        stmt = await conn.prepare(`SELECT lookup_id, nonce, ciphertext FROM read_parquet('${name}') WHERE lookup_id = ?`);
        const result = await stmt.query(lookupId);
        if (result.numRows > 1) throw new Error('Identificador duplicado en Parquet.');
        if (!result.numRows) return null;
        const row = result.get(0);
        return { lookup_id: row.lookup_id, nonce: new Uint8Array(row.nonce), ciphertext: new Uint8Array(row.ciphertext) };
    } finally {
        if (stmt) await stmt.close();
        if (conn) await conn.close();
        await db.dropFile(name);
    }
}
