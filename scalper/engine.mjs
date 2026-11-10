// Separate paper experiment. Pure deterministic agents; no signer/order endpoint.
export const defaults = Object.freeze({initialCash:10000, feeBps:80, slippageBps:10, maxPositionPct:10, stopBps:30, maxHoldMs:300000, cooldownMs:60000, maxSpreadBps:10, dailyLossPct:1, maxDrawdownPct:3, maxEntriesPerDay:30, minNetBps:10});
export function config(input={}) {
 const c={...defaults,...input};
 for(const [k,v] of Object.entries(c)) if(!(k in defaults)||!Number.isFinite(v)||v<=0) throw Error('Invalid config '+k);
 if(c.maxPositionPct>15||c.dailyLossPct>2||c.maxDrawdownPct>8||c.feeBps>500||c.slippageBps>100||c.maxEntriesPerDay>100||!Number.isInteger(c.maxEntriesPerDay)||c.maxHoldMs>900000)throw Error('Risk config outside candidate limits');
 return c;
}
export function initial(c=defaults) {return {cash:c.initialCash,qty:0,cost:0,entryPrice:0,entryTime:0,equity:c.initialCash,peak:c.initialCash,fees:0,realized:0,closed:0,wins:0,lastBar:0,lastExit:0,day:'',dayStart:c.initialCash,entries:0,halted:false};}
export function step(previous,{now,bars,bid,ask,quoteAt},c=defaults) {
 const s=structuredClone(previous), events=[];
 const result=(reason)=>({state:s,events,reason});
 if(![now,bid,ask,quoteAt].every(Number.isFinite)||bid<=0||ask<bid||quoteAt>now||now-quoteAt>10000)return result('DATA_BLOCK: invalid or stale quote');
 // Liquidation mark includes simulated exit cost. Raw REST ticker has no exchange timestamp.
 s.equity=s.cash+s.qty*bid*(1-c.slippageBps/10000)*(1-c.feeBps/10000);
 s.peak=Math.max(s.peak,s.equity);
 const day=new Date(now).toISOString().slice(0,10);
 if(day!==s.day){s.day=day;s.dayStart=s.equity;s.entries=0;}
 const dd=(1-s.equity/s.peak)*100, loss=(1-s.equity/s.dayStart)*100;
 if(dd>=c.maxDrawdownPct)s.halted=true;
 const sell=(reason)=>{const price=bid*(1-c.slippageBps/10000),gross=s.qty*price,fee=gross*c.feeBps/10000,pnl=gross-fee-s.cost;
 events.push({side:'SELL',price,qty:s.qty,fee,pnl,reason,time:now});s.cash+=gross-fee;s.fees+=fee;s.realized+=pnl;s.closed++;if(pnl>0)s.wins++;s.qty=0;s.cost=0;s.equity=s.cash;s.lastExit=now;return result(reason);};
 if(s.qty){
  if(s.halted||loss>=c.dailyLossPct)return sell('RISK_EXIT');
  if(bid<=s.entryPrice*(1-c.stopBps/10000))return sell('STOP');
  if(bid>=s.target)return sell('TARGET');
  if(now-s.entryTime>=c.maxHoldMs)return sell('TIME_EXIT');
  return result('MANAGE_POSITION');
 }
 if(s.halted||loss>=c.dailyLossPct)return result('RISK_BLOCK');
 if(s.entries>=c.maxEntriesPerDay||now-s.lastExit<c.cooldownMs)return result('COOLDOWN_OR_LIMIT');
 if((ask/bid-1)*10000>c.maxSpreadBps)return result('SPREAD_BLOCK');
 if(!Array.isArray(bars)||bars.length<21)return result('WARMUP');
 const a=bars.slice(-21);
 if(a.some((b,i)=>![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.time+60000>now||(i&&b.time-a[i-1].time!==60000)))return result('CANDLE_BLOCK');
 const last=a.at(-1);
 if(now-(last.time+60000)>90000)return result('STALE_CANDLE');
 if(last.time<=s.lastBar)return result('SAME_CANDLE');
 s.lastBar=last.time; // Decision cannot be replayed after restart.
 const mean=v=>v.reduce((x,y)=>x+y,0)/v.length;
 const fast=mean(a.slice(-5).map(b=>b.close)),slow=mean(a.slice(-20).map(b=>b.close));
 const breakout=last.close>Math.max(...a.slice(-6,-1).map(b=>b.high));
 const rebound=a.at(-2).close<a.at(-3).close&&last.close>a.at(-2).high&&last.close>slow;
 const atr=mean(a.slice(-14).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-a[a.length-15+i].close),Math.abs(b.low-a[a.length-15+i].close))));
 const potentialBps=3*atr/ask*10000, costBps=2*(c.feeBps+c.slippageBps)+(ask/bid-1)*10000;
 if(!(fast>slow&&(breakout||rebound)))return result('SIGNAL_WAIT');
 if(potentialBps<=costBps+c.minNetBps)return result('COST_BLOCK'); // Volatility proxy, NOT expected profit.
 const price=ask*(1+c.slippageBps/10000),budget=Math.min(s.cash,s.equity*c.maxPositionPct/100),qty=budget/(price*(1+c.feeBps/10000)),fee=qty*price*c.feeBps/10000;
 s.cash-=budget;s.qty=qty;s.cost=budget;s.entryPrice=price;s.entryTime=now;s.target=price*(1+potentialBps/10000);s.entries++;s.fees+=fee;
 s.equity=s.cash+qty*bid*(1-c.slippageBps/10000)*(1-c.feeBps/10000);
 events.push({side:'BUY',time:now,price,qty,fee,pnl:null,reason:breakout?'BREAKOUT':'REBOUND'});
 return result('ENTER');
}
