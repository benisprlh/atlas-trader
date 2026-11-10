"""Read-only audit of copied Atlas snapshots. No network or session mutation.
Usage: python3 Atlas_Trader_Audit_2026-11-10.py CURRENT PRIOR ENROLLMENT
Output: JSON to stdout. Windows: (capture-24h,capture], and matched hourly marks.
"""
import sys, json, hashlib, re
from datetime import datetime, timedelta
from collections import Counter

def ts(x):
    return datetime.fromisoformat(x.replace('Z', '+00:00'))

def unique(rows, key):
    result = {}
    for row in rows:
        k = key(row)
        if k in result and row != result[k]:
            raise ValueError('Conflicting duplicate: ' + str(k))
        result[k] = row
    return list(result.values()), len(rows)-len(result)

def audit(cur, prev, enroll):
    s, old = cur['state'], prev['state']
    q, p, b = s['session'], old['session'], enroll['session']
    a, o, e = q['paperState'], p['paperState'], b['paperState']
    curve, dc = unique(a['equityCurve'], lambda x:x['time'])
    curve.sort(key=lambda x:x['time'])
    events, de = unique(s['events'], lambda x:x.get('id') or (x['time'],x['type'],x['message']))
    events.sort(key=lambda x:x['time'])
    trades, dt = unique(a['trades'], lambda x:x.get('id') or x.get('time') or x['timestamp'])
    end = curve[-1]; start = next(x for x in curve if x['time']==end['time']-86400000)
    captured = ts(cur['fetchedAt']); cutoff = captured-timedelta(days=1)
    window = [x for x in events if cutoff < ts(x['time']) <= captured]
    cycles = [x for x in events if x['type']=='cycle']
    gaps = [{'previous':l['time'],'next':r['time'],'minutes':(ts(r['time'])-ts(l['time'])).total_seconds()/60}
            for l,r in zip(cycles,cycles[1:]) if (ts(r['time'])-ts(l['time'])).total_seconds()>90*60]
    recoveries = []
    for er in [x for x in window if x['type']=='error']:
        after = next((x for x in cycles if x['time']>er['time']),None)
        recoveries.append({'error':er,'nextSuccess':after['time'] if after else None})
    old_events = {x.get('id') or (x['time'],x['type'],x['message']):x for x in old['events']}
    new_events = [x for x in events if (x.get('id') or (x['time'],x['type'],x['message'])) not in old_events]
    old_curve = {x['time']:x for x in o['equityCurve']}
    changed = [x['time'] for x in curve if x['time'] in old_curve and x != old_curve[x['time']]]
    missing_old = sorted(set(old_curve)-{x['time'] for x in curve})
    peak = curve[0]['equity']; dd = 0
    for x in curve:
        peak=max(peak,x['equity']); dd=max(dd,(peak-x['equity'])/peak*100)
    cfg_hash=hashlib.sha256(json.dumps(q['config'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    checks = {
        'session_matches':q['id']==p['id']==b['id']=='35c81bc0-26c6-4174-8b3e-e4e416e22767',
        'config_matches':q['config']==p['config']==b['config'],
        'reviewed_configuration_matches_prior':q.get('reviewedConfiguration')==p.get('reviewedConfiguration'),
        'owner_private_verified':cur['ownerPrivateVerified'],
        'hourly_marks_contiguous':all(y['time']-x['time']==3600000 for x,y in zip(curve,curve[1:])),
        'prior_marks_unchanged':not changed,
        'prior_marks_retained':not missing_old,
        'equity_cash_flat_reconciliation':a['quantity']==0 and a['positionCost']==0 and a['cash']==a['equity']==10000,
        'closed_trade_counter_matches_empty_history':a['closedTrades']==len(trades)==0,
        'no_drawdown_breach_observed':dd<=q['config']['maxDrawdownPct'],
        'no_exposure_breach_observed':a['quantity']==0,
    }
    return {
        'capturedAt':cur['fetchedAt'],'sessionId':q['id'],'checks':checks,
        'configurationSha256':cfg_hash,
        'counts':{'equity':len(curve),'events':len(events),'trades':len(trades),'newEquity':len(curve)-len(old_curve),'newEvents':len(new_events)},
        'duplicatesRemoved':{'equity':dc,'events':de,'trades':dt},
        'windowOperational':{'start':cutoff.isoformat(),'end':captured.isoformat(),'events':len(window),'types':dict(Counter(x['type'] for x in window)),
            'actions':dict(Counter(re.search(r'Keputusan (\w+)',x['message']).group(1) for x in window if x['type']=='cycle'))},
        'windowMarks':{'start':start,'end':end,'hours':24},
        'pnlNetSimulated24h':end['equity']-start['equity'],'pnlNetSimulatedCumulative':a['equity']-q['config']['initialCash'],
        'return24hPct':(end['equity']/start['equity']-1)*100,'returnCumulativePct':(a['equity']/10000-1)*100,
        'realizedPnl':a['realizedPnl'],'unrealizedPnl':a['equity']-a['cash']-a['positionCost'],
        'feesSimulated':a['totalFees'],'apiCost':None,'pnlAllCosts':None,
        'closedTrades':a['closedTrades'],'winRate':None if not a['closedTrades'] else a['wins']/a['closedTrades'],
        'maxDrawdownPctFromCurve':dd,'cash':a['cash'],'quantity':a['quantity'],'exposureUsd':a['equity']-a['cash'],
        'benchmark':{'first':curve[0],'last':end,'delta24h':end['benchmark']-start['benchmark'],
            'return24hPct':(end['benchmark']/start['benchmark']-1)*100,'cumulativePnl':end['benchmark']-10000,
            'cumulativePct':(end['benchmark']/10000-1)*100,'enrollmentLast':e['equityCurve'][-1],
            'returnSinceEnrollmentLastMarkPct':(end['benchmark']/e['equityCurve'][-1]['benchmark']-1)*100,
            'cashReturnAssumptionNoInterestPct':0},
        'heartbeatAgeMinutes':(captured-ts(s['schedule']['lastHeartbeat'])).total_seconds()/60,
        'feedFetchAgeMinutes':(captured-ts(q['source']['fetchedAt'])).total_seconds()/60,
        'heartbeatAdvancedVsPrior':ts(s['schedule']['lastHeartbeat'])>ts(old['schedule']['lastHeartbeat']),
        'sessionError':q.get('error'),'modelReviewStatus':q['modelReview']['status'],
        'modelReviewErrorFieldPresent':'error' in q['modelReview'],'modelReviewError':q['modelReview'].get('error'),
        'recoveries24h':recoveries,'successfulCycleGapsOver90Minutes':gaps,
        'costStressFixedNotional1500':[{'feeBps':f,'slippageBps':sl,'roundtripCostUsd':2*1500*(f+sl)/10000} for f,sl in [(10,10),(40,10),(80,10),(80,25)]],
        'oldBacktestsExcluded':len(s.get('runs',[])),
        'limitations':['No raw OHLC payload or arrival log: candle finality and full feed availability unverified.',
            'No fill/position history with trades: stops/execution controls untested.',
            'Only latest AI review retained; no complete hourly AI archive.',
            'Cash baseline assumes no interest; buy-and-hold is dashboard price proxy, fee handling unverified.']
    }

if __name__=='__main__':
    out=audit(*(json.load(open(p)) for p in sys.argv[1:4]))
    print(json.dumps(out,indent=2,ensure_ascii=False))
    if not all(out['checks'].values()):
        raise SystemExit('One or more data audit checks failed; inspect output.')
