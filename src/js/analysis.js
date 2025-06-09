// Core mathematical and analysis functions for Bitcoin price analysis

// Parse CSV data into normalized block-based format
function parseCsvLines(lines, calibratedBlockTimeMs) {
    if (calibratedBlockTimeMs <= 0) return [];
    const genesisTime = CONFIG.GENESIS_DATE.getTime();
    return lines
        .map((line) => {
            const cells = line.split(",");
            let date, price;
            if (cells[0].includes("-") && cells[0].length === 10)
                date = new Date(cells[0] + "T00:00:00Z");
            else if (!isNaN(cells[0]) && cells[0].length > 8)
                date = new Date(Number(cells[0]));
            else date = new Date(cells[0]);
            price = parseFloat(cells[1]);
            if (isNaN(date.getTime()) || isNaN(price)) return null;
            const block = Math.floor(
                (date.getTime() - genesisTime) /
                calibratedBlockTimeMs,
            );
            return { block, price, date };
        })
        .filter((d) => d && d.block >= 0);
}

// Calculate quadratic fit coefficients for a dataset
function calculateQuadraticFit(data) {
    const n = data.length;
    if (n < 3) return { a: 0, b: 0, c: 0 };

    let sumX = 0,
        sumY = 0,
        sumX2 = 0,
        sumX3 = 0,
        sumX4 = 0,
        sumXY = 0,
        sumX2Y = 0;

    for (const point of data) {
        const x = point.x;
        const y = point.y;
        const x2 = x * x;
        sumX += x;
        sumY += y;
        sumX2 += x2;
        sumX3 += x * x2;
        sumX4 += x2 * x2;
        sumXY += x * y;
        sumX2Y += x2 * y;
    }

    const S = [
        [n, sumX, sumX2],
        [sumX, sumX2, sumX3],
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
        Y[0] * (S[1][0] * S[2][1] - S[1][1] * S[2][0]);
    const detB =
        S[0][0] * (Y[1] * S[2][2] - S[1][2] * Y[2]) -
        Y[0] * (S[1][0] * S[2][2] - S[1][2] * S[2][0]) +
        S[0][2] * (S[1][0] * Y[2] - Y[1] * S[2][0]);
    const detC =
        Y[0] * (S[1][1] * S[2][2] - S[1][2] * S[2][1]) -
        S[0][1] * (Y[1] * S[2][2] - S[1][2] * Y[2]) +
        S[0][2] * (Y[1] * S[2][1] - S[1][1] * Y[2]);

    return { a: detA / detS, b: detB / detS, c: detC / detS };
}

// Generate lookback periods based on macro trend and curvature
function generateLookbacksAlongMacroActual(
    latestBlock,
    curvature,
    config,
    macroActualSlope,
) {
    const {
        steepeningLookbackConfig,
        flatteningLookbackConfig,
        curvatureSensitivity,
        numFinalLookbacks,
        lookbackRangeDenominator,
    } = config;

    // Create modulation factor from curvature
    const modulationFactor = Math.tanh(
        curvature * curvatureSensitivity,
    );

    // Map modulation factor to alpha (0 to 1)
    const alpha = (modulationFactor + 1) / 2;

    // Lerp between lookback configs
    const startCycles =
        flatteningLookbackConfig.startCycles * (1 - alpha) +
        steepeningLookbackConfig.startCycles * alpha;
    const endCycles =
        flatteningLookbackConfig.endCycles * (1 - alpha) +
        steepeningLookbackConfig.endCycles * alpha;

    const f0 = startCycles;
    const k = endCycles - startCycles;
    const candidates = [];

    // Limit to recent half of Bitcoin's history for more relevant timeframes
    const maxLookbackRange =
        latestBlock * config.lookbackRangeDenominator;

    // Generate up to numFinalLookbacks peaks (starting from most recent)
    let n = 0;
    while (candidates.length < numFinalLookbacks) {
        const A = k;
        const B = 2 * f0;
        const C = -(n + 0.5);
        const discriminant = B * B - 4 * A * C;
        if (discriminant < 0) break;
        const x = (-B + Math.sqrt(discriminant)) / (2 * A);
        if (x > 1.0) break;
        if (x > 0) {
            const lookback = Math.round(x * maxLookbackRange);
            if (lookback > 10) candidates.push(lookback);
        }
        n++;
    }

    // Sort from shortest to longest for display
    return candidates.sort((a, b) => a - b);
}

// Calculate angle of a normalized segment
function calculateNormalizedSegmentAngle(
    startBlock,
    startPrice,
    endBlock,
    endPrice,
    maxBlock,
    maxPrice,
) {
    if (maxBlock <= 0 || maxPrice <= 0 || endBlock <= startBlock)
        return 0;
    const startX = startBlock / maxBlock;
    const startY = startPrice / maxPrice;
    const endX = endBlock / maxBlock;
    const endY = endPrice / maxPrice;
    const rise = endY - startY;
    const run = endX - startX;
    if (run === 0) return 90;
    return Math.atan2(rise, run) * (180 / Math.PI);
}

// Calculate standard deviation of an array
function calculateStdDev(arr) {
    if (!arr || arr.length < 2) return 0;
    const n = arr.length;
    const mean = arr.reduce((a, b) => a + b) / n;
    const variance =
        arr
            .map((x) => Math.pow(x - mean, 2))
            .reduce((a, b) => a + b) /
        (n - 1);
    return Math.sqrt(variance);
}

// Categorize signal based on standard deviations
function sigCatStdDev(diff, stdDev) {
    if (stdDev === 0) return { text: "meh", cls: "sig-meh" };
    const devs = diff / stdDev;
    if (devs > 1.5) return { text: "party", cls: "sig-party" };
    if (devs < -1.5)
        return { text: "no bueno", cls: "sig-no-bueno" };
    if (devs > 0.5) return { text: "peachy", cls: "sig-peachy" };
    if (devs < -0.5) return { text: "watch", cls: "sig-watch" };
    return { text: "meh", cls: "sig-meh" };
}

// Export all functions
export {
    parseCsvLines,
    calculateQuadraticFit,
    generateLookbacksAlongMacroActual,
    calculateNormalizedSegmentAngle,
    calculateStdDev,
    sigCatStdDev
}; 