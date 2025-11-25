export function parseHexFloat(hex: string): number {
    if (!hex) return 0;

    let negative = false;
    if (hex.startsWith("-")) {
        negative = true;
        hex = hex.slice(1);
    }

    hex = hex.replace(/^0x/i, "");

    if (!hex.includes(".")) return negative ? -parseInt(hex, 16) : parseInt(hex, 16);

    const [intPart, fracPart] = hex.split(".");
    const intVal = intPart ? parseInt(intPart, 16) : 0;

    let fracVal = 0;
    if (fracPart) {
        for (let i = 0; i < fracPart.length; i++) {
            const digit = parseInt(fracPart[i], 16);
            fracVal += digit / Math.pow(16, i + 1);
        }
    }

    const result = intVal + fracVal;
    return negative ? -result : result;
}
