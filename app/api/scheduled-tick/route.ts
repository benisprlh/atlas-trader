import { paperAction } from "../../../lib/paper-service";
import { readPayload,json,fail,readWorkspace,saveWorkspace,addEvent } from "../../../lib/server-store";

/** Owner-private shared updater. The Sites dispatch access policy authenticates
 * the owner or a scoped service-access bearer BEFORE reaching this route.
 * Never expose this endpoint publicly or relax the Site's owner-only access. */
export async function POST(request:Request){try{
  const body=await readPayload(request);
  if(body.action==="register-schedule"){
    if(typeof body.taskId!=="string"||body.taskId.length>200)throw new Error("Task ID diperlukan.");
    const {data,revision}=await readWorkspace();
    data.schedule={...data.schedule,status:"connected",taskId:body.taskId};
    addEvent(data,"schedule","Scheduler paper terhubung. Hanya memproses sesi paper yang running.");
    await saveWorkspace(data,revision);return json({success:true,schedule:data.schedule});
  }
  return json(await paperAction({action:"tick"},true));
}catch(error){return fail(error,503);}}
