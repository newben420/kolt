import {v4 as uuidv4, validate} from "uuid";

export class UUIDHelper {
    static generate = (): string =>  uuidv4();

    static short = (): string => UUIDHelper.generate().split("-")[0];

    static validate = (ud: string): boolean =>  validate(ud);
}