// Configuration for the Bitcoin "Should I Give a Fuck" Meter
export const CONFIG = {
    // --- Data Source ---
    CSV_URL: "../../data/btc-price-history-data.csv",
    GENESIS_DATE: new Date("2009-01-03T00:00:00Z"),

    // --- UI & Verdict Thresholds ---
    UI_CONFIG: {
        finalScoreScale: 15,
        positiveThreshold: 8,
        negativeThreshold: -8,
    },

    // --- Geometric Model Parameters ---
    GEO_MODEL_CONFIG: {
        // pulls the model towards shorter horizons
        steepeningLookbackConfig: {
            startCycles: 50,
            endCycles: 200,
        },

        // pulls the model towards longer horizons
        flatteningLookbackConfig: {
            startCycles: 30,
            endCycles: 150,
        },

        // Controls the movement between steepening and flattening curves.
        // Higher values make the model more sensitive to curvature changes.
        curvatureSensitivity: 1,

        // Number of final lookbacks to consider for curvature analysis.
        numFinalLookbacks: 5,

        // % of the total lookback range to consider for curvature analysis.
        lookbackRangeDenominator: 0.25,
    },
}; 