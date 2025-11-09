export class Res {
    succ!: boolean;
    message!: any;
    extra!: any;
}

export class GRes {
    static succ = (message: any = "", extra: any = {}) => {
        let r: Res = {succ: true, message, extra};
        if(extra){
            r.extra = extra;
        }
        return r;
    }
    static err = (message: any = "", extra: any = {}) => {
        let r: Res = {succ: false, message, extra};
        if(extra){
            r.extra = extra;
        }
        return r;
    }
}