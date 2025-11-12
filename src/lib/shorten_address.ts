export const shortenAddress = (address: string, limit: number = 8) => {
    limit = Math.min(8, Math.max(2, limit));
    const sep = "_";
    if(address.length <= limit){
        return address;
    }
    else{
        const half = Math.floor(limit / 2);
        return `${address.slice(0, half)}${sep}${address.slice(address.length - half)}`;
    } 
}