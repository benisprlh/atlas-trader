import { generateSampleCandles, type Candle } from "./trading";

export type SymbolName = "ETH" | "BTC";
export type MarketSource = { kind: "sample" | "live" | "import"; label: string; asOf: string; fetchedAt: string; timeframe: "1h"; executionModel: string };
export function validSymbol(value: unknown): SymbolName {
  if (value !== "ETH" && value !== "BTC") throw new Error("Symbol harus ETH atau BTC.");
  return value;
}
export async function getMarket(symbol: SymbolName, source: "sample" | "live") {
  if(source === "sample") {
    const candles=generateSampleCandles(symbol,720,42);
    return {candles,source:{kind:"sample",label:"Synthetic sample · seeded scenario",asOf:new Date(candles.at(-1)!.time+3600000).toISOString(),fetchedAt:new Date().toISOString(),timeframe:"1h",executionModel:"Candle simulation; not historical market performance"} as MarketSource};
  }
  const pair = symbol === "BTC" ? "XBTUSD" : "ETHUSD";
  // Fixed provider URL: never accept arbitrary upstream URLs from visitors.
  let response: Response;
  try {
    response = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=60`, {headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)});
  } catch {
    throw new Error("Koneksi ke feed Kraken gagal atau timeout. Siklus dihentikan; harga sintetis tidak digunakan sebagai pengganti.");
  }
  if(!response.ok) throw new Error(`Market provider unavailable (${response.status}). Data sample tidak digunakan otomatis.`);
  const payload = await response.json() as {error?: string[]; result?: Record<string, unknown>};
  if(payload.error?.length || !payload.result) throw new Error("Provider tidak mengembalikan data valid.");
  const raw = Object.entries(payload.result).find(([key,value])=>key!=="last" && Array.isArray(value))?.[1] as unknown[][]|undefined;
  if(!raw) throw new Error("Format candle provider tidak valid.");
  const now=Date.now();
  const candles:Candle[] = raw.map(row=>({time:Number(row[0])*1000,open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[6])})).filter(c=>c.time+3600000<=now).sort((a,b)=>a.time-b.time);
  if(candles.length<60) throw new Error("Histori belum cukup untuk indikator.");
  if(now-(candles.at(-1)!.time+3600000)>90*60000) throw new Error("Feed harga stale; entry baru diblokir.");
  return {candles,source:{kind:"live",label:"Kraken spot USD · live price proxy",asOf:new Date(candles.at(-1)!.time+3600000).toISOString(),fetchedAt:new Date(now).toISOString(),timeframe:"1h",executionModel:"CEX candle proxy; not a DEX fill, gas or liquidity simulation"} as MarketSource};
}
