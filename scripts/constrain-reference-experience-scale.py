#!/usr/bin/env python3
"""Test uniformly scaled native-table hypotheses without changing progression.

The unknown scale is constrained by both clear-credit transitions. Independent
boss credits and the earlier entry-room threshold interval are held out until
those fits have been computed. Feasibility is not identification of a server rule.
"""
import argparse,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--out',type=Path,default=ROOT/'docs/reference-evidence/128-experience-scale-constraints.json')
a=p.parse_args()
names=['41-client-experience.json','42-xp-stable-bars.json','43-boss-xp-measurement.json','121-entry-xp.json']
paths=[ROOT/'docs/reference-evidence'/n for n in names]
client,clear,boss,entry=[json.loads(f.read_text()) for f in paths]
values=client['clients'][0]['entries']['character/exptable.tbl']['raw_values']
def threshold(level,offset,semantics):
 index=level-1+offset
 return values[index] if semantics=='per_level' else values[index]-values[index-1]
def intersect(intervals):return [max(v[0] for v in intervals),min(v[1] for v in intervals)]
def model(error,offset,semantics):
 constraints=[]
 for report in clear['reports']:
  before,after=report['samples'];level=before['level'];current=threshold(level,offset,semantics);following=threshold(level+1,offset,semantics)
  pre=[(before['fill_pixels']-error)/160,(before['fill_pixels']+error)/160]
  post=[(after['fill_pixels']-error)/160,(after['fill_pixels']+error)/160]
  base=[(1-pre[1])*current+post[0]*following,(1-pre[0])*current+post[1]*following]
  payout=report['observed_clear_credit'];interval=[payout/base[1],payout/base[0]]
  constraints.append(dict(video=report['video'],level=level,unscaledThresholds=[current,following],
   unscaledRequiredCreditInterval=base,scaleInterval=interval))
 fitted=intersect([c['scaleInterval'] for c in constraints])
 held=[]
 for report in boss['reports']:
  current=threshold(report['level'],offset,semantics)
  held.append(dict(source=f"V{report['video']} boss",scaleInterval=[v/current for v in report['current_level_threshold_interval']]))
 # The entry threshold bound has its own documented ±2px uncertainty. It is
 # held fixed in this sensitivity check; clear-bar error is varied above.
 current=threshold(3,offset,semantics)
 held.append(dict(source='V1 entry Lv3',scaleInterval=[v/current for v in entry['v1ThresholdIntegerInterval']]))
 joint=intersect([fitted]+[h['scaleInterval'] for h in held])
 return dict(clearEndpointErrorPixels=error,semantics=semantics,indexOffset=offset,
  clearConstraints=constraints,clearFitScaleInterval=fitted,clearFitFeasible=fitted[0]<=fitted[1],
  heldOutConstraints=held,jointScaleInterval=joint,jointFeasible=joint[0]<=joint[1])
rows=[model(e,o,s) for e in [2,1] for o in [-1,0,1] for s in ['per_level','cumulative']]
for r in rows:
 if r['jointFeasible']:
  k=sum(r['jointScaleInterval'])/2
  r['illustrativeMidpointNotRuntimeValue']=k
  r['illustrativeLevel3to7Thresholds']={str(l):threshold(l,r['indexOffset'],r['semantics'])*k for l in range(3,8)}
report=dict(inputs=[dict(file=f.name,sha256=hashlib.sha256(f.read_bytes()).hexdigest()) for f in paths],models=rows,
 limits=['Clear intervals assume the displayed clear total is the only XP credit and exactly one level is crossed.',
  'No scale, index convention or cumulative-table interpretation is established as the original server rule.',
  'The ±1px sensitivity analysis changes only clear-bar uncertainty, not the independently derived holdout intervals.',
  'Feasible intervals can rely on opposite endpoint errors in the two recordings; they are weaker than a unique central-value fit.',
  'No runtime initial XP, enemy payout, threshold, clear-credit or asset data is changed by this script.'])
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(report,indent=2)+'\n')
for e in [2,1]:
 print('clear endpoint error',e,[(r['semantics'],r['indexOffset'],r['jointScaleInterval']) for r in rows if r['clearEndpointErrorPixels']==e and r['jointFeasible']])
