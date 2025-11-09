export const JSONSafeParse = (data: any, isArray = false): any => {
    let obj = isArray ? [] : {};
    try {
        obj = JSON.parse(data);
    } catch (error) {
        // do nothing
    }
    finally{
        return obj;
    }
}