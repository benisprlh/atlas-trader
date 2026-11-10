import { getMarket,validSymbol } from "../../../lib/market";
import { fail,json } from "../../../lib/server-store";
export async function GET(request:Request){try{return json(await getMarket(validSymbol(new URL(request.url).searchParams.get("symbol")||"ETH"),"live"));}catch(error){return fail(error,503);}}
