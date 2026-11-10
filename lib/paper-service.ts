import { env } from "cloudflare:workers";
import { defaultConfig,validateConfig,paperStep,startPaperFromHistory,setPaperProposal,evaluateAgents,type StrategyConfig } from "./trading";
import { getMarket,validSymbol,type SymbolName } from "./market";
import { runModelReview, analystConfiguration } from "./agent-provider";
import { readWorkspace,saveWorkspace,addEvent,type WorkspaceData } from "./server-store";

async function review(session:any,candles:any[]) {
  if(session.reviewedPendingAt === session.paperState.pendingCompletedAt && session.reviewedConfiguration === analystConfiguration(env)) return session.modelReview;
  const baseline=evaluateAgents(candles,session.config);
  const facts=baseline.indicators;
  const model=await runModelReview({symbol:session.symbol,asOf:baseline.asOf||Date.now(),evidence:[
    {id:"close",label:"Latest closed candle USD",value:candles.at(-1)!.close},
    {id:"fast_sma",label:"Fast SMA",value:facts.fastSma??"unavailable"},
    {id:"slow_sma",label:"Slow SMA",value:facts.slowSma??"unavailable"},
    {id:"volatility",label:"Per-bar volatility percent",value:facts.volatilityPct},
    {id:"momentum",label:"24-hour momentum percent",value:facts.momentumPct},
  ]},{...baseline,asOf:baseline.asOf??Date.now(),action:session.paperState.pendingAction,reason:session.paperState.pendingReason},session.config,env);
  session.modelReview=model;
  session.reviewedConfiguration=analystConfiguration(env);
  // Optional LLM can only veto baseline entries; deterministic exits/risk remain.
  if(model.configured && session.paperState.pendingAction === "ENTER") {
    session.paperState=setPaperProposal(session.paperState,model.analysis.action,model.analysis.reason,Date.now());
  }
  session.reviewedPendingAt=session.paperState.pendingCompletedAt;
  session.agents=model.analysis;
  return model;
}

export async function paperAction(body:any,scheduled=false){
  const {data,revision}=await readWorkspace();
  const now=new Date().toISOString();
  if(scheduled)data.schedule={...data.schedule,lastHeartbeat:now};
  if(body.action==="reset"){
    if(data.session?.status==="running")throw new Error("Pause sesi terlebih dahulu sebelum reset.");
    data.session=null;addEvent(data,"reset","Buku virtual direset; tidak ada aset wallet yang berubah.");
  } else if(body.action==="pause"){
    if(data.session){data.session.status="paused";data.session.pausedAt=now;addEvent(data,"pause","Sesi paper dihentikan. Posisi virtual disimpan; tidak ada transaksi nyata.");}
  } else if(body.action==="start"){
    if(data.session?.status==="running")return {session:data.session,schedule:data.schedule,skipped:"already-running"};
    const symbol=validSymbol(body.symbol||data.session?.symbol||"ETH");
    const config={...defaultConfig,...(body.config||data.settings.risk||{})};validateConfig(config);
    const source=body.source==="sample"?"sample":"live";
    if(source==="sample")throw new Error("Auto paper memerlukan live data. Sample tersedia di Backtest Lab.");
    const market=await getMarket(symbol,"live");
    if(market.source.kind!=="live")throw new Error("Auto paper hanya menerima live price proxy; sample tidak boleh menjadi feed otomatis.");
    // Every Start creates a fresh experiment. Paused state is not silently replayed.
    if(data.session?.status==="paused")throw new Error("Reset buku yang paused sebelum memulai eksperimen baru.");
    data.session={id:crypto.randomUUID(),status:"running",symbol,config,paperState:startPaperFromHistory(market.candles,config,Date.now()),lastTick:now,source:market.source,error:null,createdAt:now,mode:"paper",historyRetention:{maxEvents:2000,retained:"latest",lifetimeCounters:true}};
    await review(data.session,market.candles);
    addEvent(data,"start","Auto paper dimulai pada data baru. Histori hanya untuk warm-up; tidak ada trade historis yang ditambahkan.");
  } else if(body.action==="tick"){
    if(!data.session||data.session.status!=="running"){
      if(scheduled)await saveWorkspace(data,revision);
      return {session:data.session,schedule:data.schedule,skipped:"not-running"};
    }
    try{
      const candidate=structuredClone(data.session);
      const market=await getMarket(candidate.symbol,"live");
      if(market.source.kind!=="live")throw new Error("Auto paper hanya menerima live price proxy; sample tidak boleh menjadi feed otomatis.");
      const latest=market.candles.at(-1)!.time;
      const prior=candidate.paperState.lastProcessedTime;
      // Review a newly activated provider before processing a deferred proposal.
      // This preserves the current ledger and prevents an unreviewed entry from filling.
      if(candidate.reviewedConfiguration !== analystConfiguration(env)) {
        await review(candidate,market.candles);
        addEvent(data,"ai_configuration","Konfigurasi AI diterapkan pada sesi paper yang sedang berjalan.");
      }
      if(latest>prior){
        candidate.paperState=paperStep(candidate.paperState,market.candles,candidate.config,Date.now());
        // A deferred entry is not allowed to survive a newer rule invalidation.
        // Cancelling a proposal does not invent an earlier execution or fill.
        if(candidate.paperState.pendingAction==="ENTER" && candidate.paperState.latestDecision?.action!=="ENTER"){
          candidate.paperState=setPaperProposal(candidate.paperState,"HOLD","Proposal entry dibatalkan oleh bukti candle terbaru.",Date.now());
        }
        await review(candidate,market.candles);
        addEvent(data,"cycle",`Candle baru diproses: ${candidate.symbol}. Keputusan ${candidate.paperState.pendingAction}; saldo sepenuhnya virtual.`);
      }
      candidate.lastTick=now;candidate.source=market.source;candidate.error=null;
      // The displayed journal retains the latest 2000 events; cumulative PnL,
      // fee and closed-trade counters remain in the engine state.
      candidate.paperState.equityCurve=candidate.paperState.equityCurve.slice(-2000);
      candidate.paperState.trades=candidate.paperState.trades.slice(-2000);
      candidate.historyRetention={maxEvents:2000,retained:"latest",lifetimeCounters:true};
      data.session=candidate;
    }catch(error){
      data.session.error=error instanceof Error?error.message:"Feed unavailable";
      addEvent(data,"error","Siklus gagal; entry baru tidak dibuat. "+data.session.error);
      await saveWorkspace(data,revision);
      return {session:data.session,schedule:data.schedule,error:data.session.error};
    }
  }else throw new Error("Action paper tidak dikenal.");
  await saveWorkspace(data,revision);
  return {session:data.session,schedule:data.schedule};
}
