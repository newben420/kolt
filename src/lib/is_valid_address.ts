import bs58 from 'bs58';

export const isValidAddress = (address: string) => {
    try {
        const bytes = bs58.decode(address);
        return bytes.length === 32;
    } catch (error) {
        return false;
    }
}