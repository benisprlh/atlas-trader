import { defaultConfig,validateConfig } from "../../../lib/trading";
import { readWorkspace,saveWorkspace,addEvent,readPayload,json,fail } from "../../../lib/server-store";
import { createPermissionDraft } from "../../../lib/delegation-policy";
export async function POST(request:Request){try{
  const body=await readPayload(request);const {data,revision}=await readWorkspace();
  if(body.risk){const risk={...defaultConfig,...body.risk};validateConfig(risk);data.settings.risk=risk;}
  if(body.permissionDraft){
    data.settings.permissionDraft=createPermissionDraft(body.permissionDraft);
  }
  addEvent(data,"settings","Draft pengaturan disimpan. Strategi paper aktif tidak diubah; delegasi on-chain tidak dibuat.");
  await saveWorkspace(data,revision);return json({success:true,settings:data.settings});
}catch(error){return fail(error);}}
