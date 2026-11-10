import { paperAction } from "../../../lib/paper-service";
import { readPayload,json,fail } from "../../../lib/server-store";
export async function POST(request:Request){try{return json(await paperAction(await readPayload(request)));}catch(error){return fail(error);}}
