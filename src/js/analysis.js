// Core mathematical and analysis functions for Bitcoin price analysis

// --- Core Metrics & Normalization ---

/**
 * Utility: z-score normalisation + tanh → ∈ [-1, 1]
 * Converts a raw metric value into a standardized, bounded signal.
 * @param {number} value The raw metric value (e.g., curvature, angular ratio).
 * @param {object} stats Historical statistics for this metric: { mean, std }.
 * @param {number} sensitivity A multiplier to amplify or dampen the z-score.
 * @returns {number} A normalized value between -1 and 1.
 */
function normalizeMetric(value, stats = { mean: 0, std: 1 }, sensitivity = 1) {
    const { mean = 0, std = 1 } = stats;
    if (std === 0) return 0;
    // Calculate z-score and clamp to prevent extreme outlier influence
    const z = Math.max(-3, Math.min(3, (value - mean) / std));
    // Apply tanh to squash the value into the [-1, 1] range
    return Math.tanh(z * sensitivity);
}

/**
 * Calculates the coefficients for a quadratic least-squares fit (y = ax² + bx + c).
 * The 'a' coefficient represents the curvature of the trend.
 * @param {Array<{x: number, y: number}>} data An array of data points.
 * @returns {{a: number, b: number, c: number}} The coefficients of the parabola.
 */
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

    // Using Cramer's rule to solve the system of linear equations for [c, b, a]
    const det_c_matrix =
        Y[0]    * (S[1][1] * S[2][2] - S[1][2] * S[2][1]) -
        S[0][1] * (Y[1] * S[2][2]   - S[1][2] * Y[2]) +
        S[0][2] * (Y[1] * S[2][1]   - S[1][1] * Y[2]);

    const det_b_matrix =
        S[0][0] * (Y[1] * S[2][2] - S[1][2] * Y[2]) -
        Y[0]    * (S[1][0] * S[2][2] - S[1][2] * S[2][0]) +
        S[0][2] * (S[1][0] * Y[2]  - Y[1] * S[2][0]);

    const det_a_matrix =
        S[0][0] * (S[1][1] * Y[2] - Y[1] * S[2][1]) -
        S[0][1] * (S[1][0] * Y[2] - Y[1] * S[2][0]) +
        Y[0]    * (S[1][0] * S[2][1] - S[1][1] * S[2][0]);

    // CORRECTED: The determinants solve for c, b, and a respectively.
    return { c: det_c_matrix / detS, b: det_b_matrix / detS, a: det_a_matrix / detS };
}


/**
 * Calculates the geometric angle of a line segment on a 1x1 normalized plane.
 * @param {number} startBlock The starting block number.
 * @param {number} startPrice The starting price.
 * @param {number} endBlock The ending block number.
 * @param {number} endPrice The ending price.
 * @param {number} maxBlock The block number at the All-Time High (for normalization).
 * @param {number} maxPrice The price at the All-Time High (for normalization).
 * @returns {number} The angle in degrees (-90 to 90).
 */
function calculateNormalizedSegmentAngle(startBlock, startPrice, endBlock, endPrice, maxBlock, maxPrice) {
    if (maxBlock <= 0 || maxPrice <= 0 || endBlock <= startBlock) return 0;
    const startX = startBlock / maxBlock;
    const startY = startPrice / maxPrice;
    const endX   = endBlock   / maxBlock;
    const endY   = endPrice   / maxPrice;
    const rise = endY - startY;
    const run  = endX - startX;
    if (run === 0) return rise > 0 ? 90 : -90;
    return Math.atan2(rise, run) * (180 / Math.PI);
}


// --- DYNAMIC LOOKBACK GENERATION ---

/**
 * Generates dynamic lookback periods by blending macro signals.
 * This is the core of the macro-to-micro calibration.
 * @param {number} latestBlock The current latest block number.
 * @param {number} curvature The 'a' coefficient from the quadratic fit (measures acceleration).
 * @param {number} angularRatio The ratio of the current trend angle to the ideal 45° angle.
 * @param {object} config The geometric model configuration from CONFIG.
 * @returns {number[]} An array of dynamically generated lookback periods (in blocks).
 */
function generateLookbacks(latestBlock, curvature, angularRatio, config) {
    const {
        steepeningLookbackConfig,
        flatteningLookbackConfig,

        curvatureStats,
        angularRatioStats,
        curvatureSensitivity,
        angularRatioSensitivity,
        angularRatioWeight,

        numFinalLookbacks,
        lookbackRangeDenominator,
        maxLookbackBlocks,
        loopSafetyLimit,
    } = config;

    // 1. Normalize each macro signal into a [-1, 1] range.
    const curvatureInput = normalizeMetric(curvature, curvatureStats, curvatureSensitivity);
    const angularRatioInput = normalizeMetric(angularRatio, angularRatioStats, angularRatioSensitivity);

    // 2. Blend the signals into a single value representing the market's "character".
    //    `angularRatioWeight` determines the influence of trend strength vs. acceleration.
    const blend = curvatureInput * (1 - angularRatioWeight) + angularRatioInput * angularRatioWeight; // ∈ [-1,1]

    // 3. Map the blended signal to an interpolation factor `alpha` ∈ [0,1].
    //    alpha = 0 -> Max flattening (broaden view)
    //    alpha = 1 -> Max steepening (dial-in view)
    const alpha = (blend + 1) / 2;

    // 4. Interpolate between the two lookback behaviors based on `alpha`.
    const startCycles = flatteningLookbackConfig.startCycles * (1 - alpha) + steepeningLookbackConfig.startCycles * alpha;
    const endCycles = flatteningLookbackConfig.endCycles * (1 - alpha) + steepeningLookbackConfig.endCycles * alpha;

    // 5. Generate "chirp" lookbacks. This non-linear generation method is sensitive
    //    to the interpolated cycle configs, producing shorter lookbacks for steepening
    //    markets and longer ones for flattening/stable markets.
    const f0 = startCycles;
    const k  = endCycles - startCycles;
    const maxRange = latestBlock * lookbackRangeDenominator;
    const candidates = [];
    let n = 0;

    while (candidates.length < numFinalLookbacks && n < loopSafetyLimit) {
        // Solve kx² + 2f₀x - (n + 0.5) = 0 for x
        const disc = (2 * f0) ** 2 - 4 * k * -(n + 0.5);
        if (disc < 0) break;

        const x = (-(2 * f0) + Math.sqrt(disc)) / (2 * k);
        if (x <= 0 || x > 1) break;

        const lookback = Math.round(x * maxRange);
        if (lookback > 10 && lookback <= maxLookbackBlocks) {
            if (!candidates.includes(lookback)) { // Ensure uniqueness
                candidates.push(lookback);
            }
        }
        n++;
    }

    return candidates.sort((a, b) => a - b);
}


// --- MISC UTILITIES ---

/**
 * Parses raw CSV lines into structured data objects.
 */
function parseCsvLines(lines, calibratedBlockTimeMs) {
    if (calibratedBlockTimeMs <= 0) return [];
    const genesisTime = new Date("2009-01-03T00:00:00Z").getTime();

    return lines
        .map((line) => {
            const cells = line.split(",");
            let date, price;

            if (cells[0].includes("-") && cells[0].length === 10) date = new Date(cells[0] + "T00:00:00Z");
            else if (!isNaN(cells[0]) && cells[0].length > 8) date = new Date(Number(cells[0]));
            else date = new Date(cells[0]);

            price = parseFloat(cells[1]);
            if (isNaN(date.getTime()) || isNaN(price)) return null;

            const block = Math.floor((date.getTime() - genesisTime) / calibratedBlockTimeMs);
            return { block, price, date };
        })
        .filter((d) => d && d.block >= 0);
}

/**
 * Optional helper: map a normalised curvature value to a UX label.
 */
function describeCurvature(curvature, thresholds = { high: 0.002, low: -0.002 }) {
    if (curvature > thresholds.high)  return "High momentum growth";
    if (curvature < thresholds.low)   return "Momentum loss / Deceleration";
    return "Flat / Consolidating";
}

/**
 * Calculates the standard deviation of an array of numbers.
 */
function calculateStdDev(arr) {
    if (!arr || arr.length < 2) return 0;
    const n = arr.length;
    const mean = arr.reduce((a, b) => a + b) / n;
    const variance = arr.map((x) => (x - mean) ** 2).reduce((a, b) => a + b, 0) / (n - 1);
    return Math.sqrt(variance);
}

/**
 * Categorizes a value based on its standard deviation from a mean.
 */
function sigCatStdDev(diff, stdDev) {
    if (stdDev === 0) return { text: "meh", cls: "sig-meh" };
    const devs = diff / stdDev;
    if (devs >  1.5) return { text: "party",    cls: "sig-party" };
    if (devs < -1.5) return { text: "no bueno", cls: "sig-no-bueno" };
    if (devs >  0.5) return { text: "peachy",   cls: "sig-peachy" };
    if (devs < -0.5) return { text: "watch",    cls: "sig-watch" };
    return { text: "meh", cls: "sig-meh" };
}

// --- Exports ---
export {
    // Core Functions
    parseCsvLines,
    calculateQuadraticFit,
    calculateNormalizedSegmentAngle,
    generateLookbacks,
    normalizeMetric,

    // Helpers
    describeCurvature,
    calculateStdDev,
    sigCatStdDev,
};