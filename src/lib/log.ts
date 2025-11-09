import { Site } from "../site"
import { getDateTime } from "./date_time";

export class Log {
    static dev = (...message: any) => {
        if(!Site.PRODUCTION){
            console.log(getDateTime(), ...message);
        }
    }

    static flow = (message: string[], weight: number = 2) => {
        if((weight >= 0 && weight <= Site.MAX_ALLOWED_FLOG_LOG_WEIGHT) || weight == -2 || Site.MAX_ALLOWED_FLOG_LOG_WEIGHT == -2){
            console.log(`${getDateTime()}: ${message.join(" => ")}`);
        }
    }
}