// Recta de tendencia (mínimos cuadrados) y correlación de Pearson de los análisis de dispersión: los barrios de Asunción
// (participacion_ipm.js) y los distritos del país (ADR-023).

// puntos: [{ x, y }]. null con menos de dos puntos o sin variación en x o en y.
export function tendencia(puntos) {
    const n = puntos.length;
    if (n < 2) return null;
    const mx = puntos.reduce((a, p) => a + p.x, 0) / n, my = puntos.reduce((a, p) => a + p.y, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of puntos) {
        sxx += (p.x - mx) ** 2;
        syy += (p.y - my) ** 2;
        sxy += (p.x - mx) * (p.y - my);
    }
    if (!sxx || !syy) return null;
    const pendiente = sxy / sxx;
    return { pendiente, ordenada: my - pendiente * mx, r: sxy / Math.sqrt(sxx * syy) };
}

// La fuerza de una correlación, en palabras.
export function fuerza(r) {
    const a = Math.abs(r);
    const grado = a < 0.1 ? 'prácticamente nula' : a < 0.3 ? 'débil' : a < 0.5 ? 'moderada' : 'fuerte';
    return a < 0.1 ? grado : `${grado} y ${r < 0 ? 'negativa' : 'positiva'}`;
}
