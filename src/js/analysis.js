// Core mathematical and analysis functions for Bitcoin price analysis


// Utility: z-score normalisation + tanh  →  ∈ [-1, 1]
function normalizeMetric(value, stats = { mean: 0, std: 1 }, sensitivity = 1) {
    const { mean = 0, std = 1 } = stats;
    if (std === 0) return 0;
    const z = Math.max(-3, Math.min(3, (value - mean) / std));
    return Math.tanh(z * sensitivity);
}

// Optional helper: map a normalised curvature value to a UX label
function describeCurvature(curvature, thresholds = { high: 0.002, low: -0.002 }) {
    if (curvature > thresholds.high)  return "High momentum growth";
    if (curvature < thresholds.low)   return "Momentum loss / Deceleration";
    return "Flat / Consolidating";
}

// Parse CSV data into block-time indexed records
function parseCsvLines(lines, calibratedBlockTimeMs) {
    if (calibratedBlockTimeMs <= 0) return [];
    const genesisTime = CONFIG.GENESIS_DATE.getTime();

    return lines
        .map((line) => {
            const cells = line.split(",");
            let date, price;

            // Flexible date parsing
            if (cells[0].includes("-") && cells[0].length === 10)
                date = new Date(cells[0] + "T00:00:00Z");
            else if (!isNaN(cells[0]) && cells[0].length > 8)
                date = new Date(Number(cells[0]));
            else
                date = new Date(cells[0]);

            price = parseFloat(cells[1]);
            if (isNaN(date.getTime()) || isNaN(price)) return null;

            const block = Math.floor(
                (date.getTime() - genesisTime) / calibratedBlockTimeMs
            );
            return { block, price, date };
        })
        .filter((d) => d && d.block >= 0);
}

// Quadratic least-squares fit  (y = ax² + bx + c)
function calculateQuadraticFit(data) {
    const n = data.length;
    if (n < 3) return { a: 0, b: 0, c: 0 };

    let sumX = 0, sumY = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0,
        sumXY = 0, sumX2Y = 0;

    for (const { x, y } of data) {
        const x2 = x * x;
        sumX   += x;
        sumY   += y;
        sumX2  += x2;
        sumX3  += x * x2;
        sumX4  += x2 * x2;
        sumXY  += x * y;
        sumX2Y += x2 * y;
    }

    const S = [
        [n,     sumX,  sumX2],
        [sumX,  sumX2, sumX3],
        [sumX2, sumX3, sumX4],
    ];

    const detS =
        S[0][0] * (S[1][1] * S[2][2] - S[1][2] * S[2][1]) -
        S[0][1] * (S[1][0] * S[2][2] - S[1][2] * S[2][0]) +
        S[0][2] * (S[1][0] * S[2][1] - S[1][1] * S[2][0]);
    if (Math.abs(detS) < 1e-9) return { a: 0, b: 0, c: 0 };

    const Y = [sumY, sumXY, sumX2Y];

    const detA =
        S[0][0] * (S[1][1] * Y[2] - Y[1] * S[2][1]) -
        S[0][1] * (S[1][0] * Y[2] - Y[1] * S[2][0]) +
        Y[0]    * (S[1][0] * S[2][1] - S[1][1] * S[2][0]);

    const detB =
        S[0][0] * (Y[1] * S[2][2] - S[1][2] * Y[2]) -
        Y[0]    * (S[1][0] * S[2][2] - S[1][2] * S[2][0]) +
        S[0][2] * (S[1][0] * Y[2]  - Y[1] * S[2][0]);

    const detC =
        Y[0]    * (S[1][1] * S[2][2] - S[1][2] * S[2][1]) -
        S[0][1] * (Y[1] * S[2][2]   - S[1][2] * Y[2]) +
        S[0][2] * (Y[1] * S[2][1]   - S[1][1] * Y[2]);

    return { a: detA / detS, b: detB / detS, c: detC / detS };
}

// Look-back “chirp” generator  – now blends curvature *and* macro slope
function generateLookbacksAlongMacroActual(
    latestBlock,
    curvature,
    config,
    macroActualSlope = 0
) {
    const {
        steepeningLookbackConfig,
        flatteningLookbackConfig,

        curvatureStats,
        slopeStats,
        curvatureSensitivity = 1,
        slopeSensitivity     = 1,
        slopeWeight          = 0.25,   // 0 → ignore slope

        numFinalLookbacks         = 5,
        lookbackRangeDenominator  = 0.25,
        maxLookbackBlocks         = Infinity,
        loopSafetyLimit           = 10_000,
    } = config;

    // 1 · Normalise each metric separately
    const curvatureInput = normalizeMetric(
        curvature,
        curvatureStats,
        curvatureSensitivity
    );
    const slopeInput = normalizeMetric(
        macroActualSlope,
        slopeStats,
        slopeSensitivity
    );

    // 2 · Blend them (weighted average)
    const blend = curvatureInput * (1 - slopeWeight) +
                  slopeInput     * slopeWeight;    // ∈ [-1,1]

    // 3 · Map to α ∈ [0,1]
    const alpha = (blend + 1) / 2;

    // 4 · Interpolate between steepening & flattening configs
    const startCycles =
        flatteningLookbackConfig.startCycles * (1 - alpha) +
        steepeningLookbackConfig.startCycles * alpha;

    const endCycles =
        flatteningLookbackConfig.endCycles * (1 - alpha) +
        steepeningLookbackConfig.endCycles * alpha;

    // 5 · Chirp-style candidate generation
    const f0 = startCycles;
    const k  = endCycles - startCycles;
    const maxRange = latestBlock * lookbackRangeDenominator;
    const candidates = [];

    let n = 0;
    while (
        candidates.length < numFinalLookbacks &&
        n < loopSafetyLimit
    ) {
        const disc = (2 * f0) ** 2 - 4 * k * -(n + 0.5);
        if (disc < 0) break;

        const x = (-(2 * f0) + Math.sqrt(disc)) / (2 * k);
        if (x <= 0 || x > 1) break;

        const lookback = Math.round(x * maxRange);
        if (lookback > 10 && lookback <= maxLookbackBlocks) {
            candidates.push(lookback);
        }
        n++;
    }

    return candidates.sort((a, b) => a - b);
}

// Misc helpers
function calculateNormalizedSegmentAngle(
    startBlock, startPrice,
    endBlock,   endPrice,
    maxBlock,   maxPrice
) {
    if (maxBlock <= 0 || maxPrice <= 0 || endBlock <= startBlock) return 0;
    const startX = startBlock / maxBlock;
    const startY = startPrice / maxPrice;
    const endX   = endBlock   / maxBlock;
    const endY   = endPrice   / maxPrice;
    const rise = endY - startY;
    const run  = endX - startX;
    if (run === 0) return 90;
    return Math.atan2(rise, run) * (180 / Math.PI);
}

function calculateStdDev(arr) {
    if (!arr || arr.length < 2) return 0;
    const n = arr.length;
    const mean = arr.reduce((a, b) => a + b) / n;
    const variance = arr
        .map((x) => (x - mean) ** 2)
        .reduce((a, b) => a + b, 0) / (n - 1);
    return Math.sqrt(variance);
}

function sigCatStdDev(diff, stdDev) {
    if (stdDev === 0) return { text: "meh", cls: "sig-meh" };
    const devs = diff / stdDev;
    if (devs >  1.5) return { text: "party",    cls: "sig-party" };
    if (devs < -1.5) return { text: "no bueno", cls: "sig-no-bueno" };
    if (devs >  0.5) return { text: "peachy",   cls: "sig-peachy" };
    if (devs < -0.5) return { text: "watch",    cls: "sig-watch" };
    return { text: "meh", cls: "sig-meh" };
}

// Exports
export {
    // core utilities
    parseCsvLines,
    calculateQuadraticFit,
    generateLookbacksAlongMacroActual,
    calculateNormalizedSegmentAngle,
    calculateStdDev,
    sigCatStdDev,
    normalizeMetric,
    describeCurvature,
};
