const progress = new Map<string, number>();

export const setConversionProgress = (itemId: string, percent: number): void => {
    progress.set(itemId, percent);
};

export const getConversionProgress = (itemId: string): number | undefined => {
    return progress.get(itemId);
};

export const clearConversionProgress = (itemId: string): void => {
    progress.delete(itemId);
};
