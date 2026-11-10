import { env } from "cloudflare:workers";
import { readWorkspace,database,json,fail } from "../../../lib/server-store";
export async function GET(){try{
  const {data}=await readWorkspace();
  const rows=await database().prepare("SELECT id,created_at,symbol,source,config,result FROM backtests ORDER BY created_at DESC LIMIT 12").all<{id:string;created_at:string;symbol:string;source:string;config:string;result:string}>();
  return json({...data,events:[...data.events].reverse(),runs:rows.results.map(r=>({id:r.id,createdAt:r.created_at,symbol:r.symbol,source:JSON.parse(r.source),config:JSON.parse(r.config),result:JSON.parse(r.result)})),capabilities:{llmConfigured:!!(env.ANALYST_API_KEY&&env.ANALYST_MODEL),scheduler:data.schedule.status,liveTrading:false,wallet:"EVM read-only",delegation:"draft-only"}});
}catch(error){return fail(error,503);}}
