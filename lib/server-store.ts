import { env } from "cloudflare:workers";

export type EventRecord = {id:string;time:string;type:string;message:string};
export type WorkspaceData = {session:any|null;settings:any;events:EventRecord[];schedule:{status:"external-required"|"connected";lastHeartbeat:string|null;taskId?:string}};
export function database(){if(!env.DB) throw new Error("Penyimpanan belum tersedia.");return env.DB;}
export async function readWorkspace():Promise<{data:WorkspaceData;revision:number}> {
  const row=await database().prepare("SELECT payload, revision FROM workspace WHERE id = ?").bind("owner").first<{payload:string;revision:number}>();
  if(row) return {data:JSON.parse(row.payload),revision:row.revision};
  return {data:{session:null,settings:{},events:[],schedule:{status:"external-required",lastHeartbeat:null}},revision:-1};
}
export async function saveWorkspace(data:WorkspaceData,revision:number){
  data.events=data.events.slice(-250);
  const now=new Date().toISOString();
  const result=revision<0
    ?await database().prepare("INSERT OR IGNORE INTO workspace (id,payload,revision,updated_at) VALUES (?,?,?,?)").bind("owner",JSON.stringify(data),0,now).run()
    :await database().prepare("UPDATE workspace SET payload=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?").bind(JSON.stringify(data),now,"owner",revision).run();
  if(!result.meta.changes) throw new Error("State berubah oleh worker lain. Refresh dan coba lagi; order tidak digandakan.");
}
export function addEvent(data:WorkspaceData,type:string,message:string){data.events.push({id:crypto.randomUUID(),time:new Date().toISOString(),type,message});}
export function checkMutationOrigin(request:Request){
  const origin=request.headers.get("origin");
  const site=new URL(request.url);
  if(origin && origin!==site.origin) throw new Error("Cross-origin mutation ditolak.");
  const fetchSite=request.headers.get("sec-fetch-site");
  if(fetchSite==="cross-site") throw new Error("Cross-site mutation ditolak.");
}
export async function readPayload(request:Request){
  checkMutationOrigin(request);
  const raw=await request.text();
  if(raw.length>2_000_000)throw new Error("Payload terlalu besar.");
  return JSON.parse(raw||"{}");
}
export function fail(error:unknown,status=400){
  const message=error instanceof Error?error.message:"Unexpected error";
  // Credentials, complete upstream responses, and internal stack traces are never returned.
  return Response.json({error:message.slice(0,400)},{status,headers:{"Cache-Control":"no-store"}});
}
export function json(data:unknown){return Response.json(data,{headers:{"Cache-Control":"no-store"}});}
