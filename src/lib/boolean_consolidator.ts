export const booleanConsolidator = (arr: boolean[], type: number) => {
    if (!Array.isArray(arr) || arr.some(val => typeof val !== 'boolean')) {
        return false;
    }

    const trueCount = arr.filter(Boolean).length;
    const total = arr.length;

    if (type === 1) {
        return trueCount === total;
    } else if (type === 0) {
        return trueCount > 0;
    } else if (typeof type === 'number' && type > 0 && type < 1) {
        return trueCount / total >= type;
    } else {
        return false;
    }
}