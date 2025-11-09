export const getForexInsights = (pair: string): string => {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = now.getHours(); // Lagos time assumed

    // Block insights on weekends
    if (day === 0 || day === 6) {
        return "Market is closed — forex trading does not occur on weekends.";
    }

    // Sessions (in Lagos/WAT time)
    const sessions = {
        Sydney: { open: 23, close: 6 },
        Tokyo: { open: 1, close: 10 },
        London: { open: 9, close: 18 },
        NewYork: { open: 14, close: 23 },
    };

    const isInSession = (open: number, close: number, h: number): boolean => {
        return open < close
            ? h >= open && h < close
            : h >= open || h < close;
    };

    const activeSessions: string[] = [];
    for (const [name, { open, close }] of Object.entries(sessions)) {
        if (isInSession(open, close, hour)) {
            activeSessions.push(name);
        }
    }

    const overlaps: string[] = [];
    const overlapIf = (a: string, b: string) => {
        if (activeSessions.includes(a) && activeSessions.includes(b)) {
            overlaps.push(`${a}/${b}`);
        }
    };

    overlapIf("Sydney", "Tokyo");
    overlapIf("Tokyo", "London");
    overlapIf("London", "NewYork");

    const base = pair.slice(0, 3).toUpperCase();
    const quote = pair.slice(3, 6).toUpperCase();
    const isJPY = base === "JPY" || quote === "JPY";
    const isUSD = base === "USD" || quote === "USD";
    const isEUR = base === "EUR" || quote === "EUR";
    const isGBP = base === "GBP" || quote === "GBP";
    const isAUD = base === "AUD" || quote === "AUD";
    const isNZD = base === "NZD" || quote === "NZD";

    const insights: string[] = [];

    if (activeSessions.includes("London") && activeSessions.includes("NewYork")) {
        insights.push("High volatility window; ideal for USD, GBP, and EUR pairs.");
    }

    if (activeSessions.includes("Tokyo") && isJPY) {
        insights.push("JPY is active. Expect volatility driven by Tokyo market flows.");
    }

    if (activeSessions.includes("Sydney") && (isAUD || isNZD)) {
        insights.push("AUD/NZD pairs may experience moderate movement during Sydney session.");
    }

    if (activeSessions.includes("Tokyo") && !isJPY) {
        insights.push("Non-JPY pairs may experience lower volatility during Tokyo hours.");
    }

    if ((isUSD || isGBP || isEUR) && (activeSessions.includes("London") || activeSessions.includes("NewYork"))) {
        insights.push("Session supports strong moves for majors. Monitor for macro events.");
    }

    if (overlaps.includes("London/NewYork")) {
        insights.push("Most liquid overlap — breakout and trend continuations likely.");
    }

    if (overlaps.includes("Tokyo/London")) {
        insights.push("Early London open meets late Tokyo — watch for directional setups.");
    }

    if (overlaps.includes("Sydney/Tokyo")) {
        insights.push("Low volatility overlap — suitable for scalping AUD/JPY pairs.");
    }

    if (insights.length === 0) {
        insights.push("Likely a consolidation period. Volatility expected to pick up in later sessions.");
    }

    return insights.join("\n");
}