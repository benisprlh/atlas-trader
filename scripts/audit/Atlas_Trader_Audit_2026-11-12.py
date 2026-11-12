"""Offline daily audit. Reads three archived copies; never calls a live service.

Usage: python3 scripts/audit/Atlas_Trader_Audit_2026-11-12.py CURRENT PRIOR ENROLLMENT
The inherited flat-account checks apply to this run's zero-trade session only.
They must be reviewed, not bypassed, when a future session has trades.
"""
import hashlib
import importlib.util
import json
import re
import sys
from datetime import timedelta
from pathlib import Path

sys.dont_write_bytecode = True
here = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('prior_audit', here / 'Atlas_Trader_Audit_2026-11-10.py')
prior_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior_audit)

def audit(current, previous, enrollment):
    out = prior_audit.audit(current, previous, enrollment)
    state = current['state']
    session = state['session']
    paper = session['paperState']
    prior_paper = previous['state']['session']['paperState']
    cutoff = prior_audit.ts(current['fetchedAt']) - timedelta(days=1)
    captured = prior_audit.ts(current['fetchedAt'])
    cycles = sorted((e for e in state['events'] if e['type'] == 'cycle'), key=lambda e:e['time'])
    # Include the predecessor outside the window when testing a boundary gap.
    out['cycleGapsOver90Minutes24h'] = [g for g in out['successfulCycleGapsOver90Minutes']
        if cutoff < prior_audit.ts(g['next']) <= captured]
    out['maxObservedCycleIntervalMinutes24h'] = max(
        ((prior_audit.ts(b['time']) - prior_audit.ts(a['time'])).total_seconds()/60
         for a,b in zip(cycles, cycles[1:]) if cutoff < prior_audit.ts(b['time']) <= captured), default=None)
    out['changeVsPreviousCapture'] = {k:paper[k]-prior_paper[k] for k in
        ['equity','cash','quantity','realizedPnl','totalFees','closedTrades']}
    out['oldBacktestsExcluded'] = current.get('excludedUnrelatedBacktests', out['oldBacktestsExcluded'])
    out['latestReviewUsageOnly'] = {k:session['modelReview'].get(k) for k in
        ['inputTokens','outputTokens','durationMs']}
    out['latestReviewUsageOnly']['dailyOrCumulativeUsageAvailable'] = False
    out['source'] = session['source']
    out['heartbeat'] = state['schedule']['lastHeartbeat']
    out['riskObserved'] = {'exposurePct':100*(paper['equity']-paper['cash'])/paper['equity'],
        'maxPositionPct':session['config']['maxPositionPct'],
        'maxDrawdownPct':session['config']['maxDrawdownPct'],
        'stopLossPct':session['config']['stopLossPct'], 'halted':paper['halted'],
        'stopExecutionTestedByForwardTrades':False}
    root = here.parent.parent
    service = (root / 'lib/paper-service.ts').read_text()
    # Static call-site audit, NOT a capture of the actual historical API requests.
    ids = re.findall(r'\{id:"([a-z_]+)"', service)
    out['sourceAudit'] = {
        'reviewEvidenceIds':ids,
        'positionAndTimeframeExplicitlyPresent':all(i in ids for i in ['position_quantity','timeframe']),
        'fileSha256':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in [root/'lib/paper-service.ts',root/'lib/market.ts',root/'lib/trading.ts',root/'lib/agent-provider.ts']},
        'scope':'Repository source at recorded sourceCommit; no production request transcript available.',
        'findings':[
            'Review evidence has five market indicators; explicit account state and timeframe absent.',
            'Baseline EXIT cannot be vetoed by the model; sell is a no-op with zero quantity.',
            'Live adapter filters candle close time and rejects stale/provider failure; no synthetic fallback.',
            'Paper benchmark initializes initialCash/latest.close without entry fees or slippage.',
        ],
    }
    out['limitations'][-1] = 'Cash assumes no interest. Source paper benchmark is gross price-only buy-and-hold, 100% exposure, not exposure-matched; baseline starts before session creation.'
    window_events = [e for e in state['events'] if cutoff < prior_audit.ts(e['time']) <= captured]
    errors = [e for e in window_events if e['type'] == 'error']
    attempts = [e for e in window_events if e['type'] in ('cycle','error')]
    previous_events = {e['id']:e for e in previous['state']['events']}
    current_events = {e['id']:e for e in state['events']}
    out['checks']['prior_events_unchanged_and_retained'] = all(current_events.get(k)==v for k,v in previous_events.items())
    out['feedDiagnostics'] = {
        'recordedAttempts24h':len(attempts), 'recordedErrors24h':len(errors),
        'observedFailureFraction':len(errors)/len(attempts) if attempts else None,
        'notAnUptimeEstimate':True,
        'providerCodePresentForEveryError':bool(errors) and all(re.search(r'[EW](?:General|API|Query|Order|Trade|Funding|Service):', e['message']) for e in errors),
        'rootCause':'unavailable: generic application message collapses provider error and absent result',
        'sourceBranchVerified':'payload.error?.length || !payload.result' in (root/'lib/market.ts').read_text(),
        'chronologicalDiagnosticEvaluation': {'calibrationThrough':previous['fetchedAt'], 'holdoutThrough':current['fetchedAt'],
            'genericErrorsWithoutProviderCode':sum('Provider tidak mengembalikan data valid.' in e['message'] for e in errors),
            'scope':'diagnostic audit only, no trade simulation or candidate profitability claim'},
    }
    out['candidateProfitabilityTestsRun'] = False
    return out

if __name__ == '__main__':
    paths = [Path(p) for p in sys.argv[1:4]]
    if len(paths) != 3:
        raise SystemExit('Supply CURRENT PRIOR ENROLLMENT')
    before = [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
    result = audit(*(json.loads(p.read_text()) for p in paths))
    result['inputFilesUnchanged'] = before == [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
    result['inputSha256'] = dict(zip((str(p) for p in paths), before))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if not all(result['checks'].values()) or not result['inputFilesUnchanged']:
        raise SystemExit('Snapshot audit failed: inspect result without changing source data.')
