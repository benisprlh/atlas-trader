import { runBacktest,defaultConfig,validateConfig } from "../../../lib/trading";
import { getMarket,validSymbol } from "../../../lib/market";
import { readPayload,database,json,fail } from "../../../lib/server-store";
export async function POST(request:Request){try{
  const body=await readPayload(request);const symbol=validSymbol(body.symbol||"ETH");
  if(body.source!==undefined&&!['live','sample'].includes(body.source))throw new Error("Source harus live atau sample.");
  const config={...defaultConfig,...body.config};validateConfig(config);
  const market=await getMarket(symbol,body.source==="live"?"live":"sample");
  const result=runBacktest(market.candles,config);
  const id=crypto.randomUUID();
  await database().prepare("INSERT INTO backtests (id,created_at,symbol,source,config,result) VALUES (?,?,?,?,?,?)").bind(id,new Date().toISOString(),symbol,JSON.stringify(market.source),JSON.stringify(config),JSON.stringify(result)).run();
  return json({result,candles:market.candles,source:market.source,runId:id});
}catch(error){return fail(error);}}
