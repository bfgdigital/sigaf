// Configuration for the Bitcoin "Should I Care" Meter
export const CONFIG = {
    // --- Data Source ---
    CSV_URL: "/data/btc-price-history-data.csv",
    GENESIS_DATE: new Date("2009-01-03T00:00:00Z"),

    // --- UI & Verdict Thresholds ---
    UI_CONFIG: {
        finalScoreScale: 15,
        positiveThreshold: 8,
        negativeThreshold: -8,
    },

    // --- Geometric Model Parameters ---
    GEO_MODEL_CONFIG: {
        // --- Lookback Window Behavior (Calibrated) ---
        // NOTE: The logic has been updated. Strong momentum now uses LONGER lookbacks
        // to see the context of a move, and slow momentum uses SHORTER lookbacks to
        // focus on the recent slowdown.

        // Behavior during strong/decisive momentum (Alpha ≈ 1).
        // Produces LONGER lookbacks (~21 days to ~6 months).
        // Counter-intuitively, smaller cycle values produce longer lookbacks.
        steepeningLookbackConfig: {
            startCycles: 17,
            endCycles: 34,
        },
        // Behavior during slow/consolidating momentum (Alpha ≈ 0).
        // Produces SHORTER lookbacks (~10 days to ~80 days).
        // Larger cycle values produce shorter lookbacks.
        flatteningLookbackConfig: {
            startCycles: 36,
            endCycles: 231,
        },


        // --- Macro Signal Blending & Sensitivity ---
        // Weighting of Angular Ratio vs. Curvature.
        // 0 = 100% Curvature, 1 = 100% Angular Ratio
        angularRatioWeight: 0.6,

        // Sensitivity multipliers for normalization
        curvatureSensitivity: 1.0,
        angularRatioSensitivity: 1.0,

        // --- Normalization Statistics ---
        // These values should ideally be calculated by analyzing the entire
        // historical data set for each metric. You would run the metric calculation
        // for every day in history, then find the mean and standard deviation
        // of the results. These are sensible defaults.
        curvatureStats: { mean: 0.0003, std: 0.0015 },
        // For Angular Ratio (Current Angle / 45). A healthy trend is ~1.0.
        angularRatioStats: { mean: 0.8, std: 0.5 },

        // --- Lookback Generation Parameters ---
        numFinalLookbacks: 5,
        lookbackRangeDenominator: 0.25, // Uses up to 25% of history for lookbacks
        maxLookbackBlocks: 210_000,     // Approx 4 years (one halving cycle)
        loopSafetyLimit: 10_000,

        // --- Final Score Weighting ---
        // A negative exponent gives MORE weight to LONGER lookbacks. This makes the
        // final score trust the established trend over short-term volatility.
        lookbackWeightExponent: -1.0,
        scoreScale: 15,               // Replaces UI_CONFIG.finalScoreScale
    },
};
