export async function GET(){return Response.json({app:"Atlas Trader",mode:"paper-only",liveTrading:false,version:"0.1.0",time:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});}
