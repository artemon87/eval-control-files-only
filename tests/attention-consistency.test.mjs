import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['previousComparableRun','isDegradedRun','isNeedsAttentionRun','isBlockedRun','effectiveRunVerdict','runRequiresAttention'];
const code=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const ctx=vm.createContext({});vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const run=(extra={})=>({evalType:'unit',runId:'now',githubRepository:'ORG/REPO',stage:'dev',target:'skill',environment:'staging',unitConfig:{targetEnvironment:'target'},executionStatus:'completed',verdict:'passed',startedAt:'2026-11-04T12:00:00Z',summary:{total:2,meanScore:4,meanScoreRecorded:true},...extra});
test('passed score regressions and XPASS require attention; blocked runs stay separate',()=>{
 const old=run({runId:'old',startedAt:'2026-11-03T12:00:00Z',summary:{total:2,meanScore:5,meanScoreRecorded:true}});
 assert.equal(ctx.isNeedsAttentionRun(run(),[old]),true);
 assert.equal(ctx.runRequiresAttention(run(),[old]),true);
 assert.equal(ctx.isNeedsAttentionRun(run({verdict:'xpassed'}),[]),true);
 assert.equal(ctx.isNeedsAttentionRun(run({verdict:'blocked'}),[old]),false);
 assert.equal(ctx.isNeedsAttentionRun(run({executionStatus:'error'}),[]),true);
});
test('missing scores, future/same-time runs and unrelated contexts cannot create degradation',()=>{
 for(const change of [{startedAt:'2026-11-04T12:00:00Z'},{startedAt:'2026-11-05T12:00:00Z'},{githubRepository:undefined},{stage:'other'},{target:'other'},{environment:'other'},{unitConfig:{targetEnvironment:'other'}}]){
 const old=run({startedAt:'2026-11-03T12:00:00Z',summary:{total:2,meanScore:5,meanScoreRecorded:true},...change});assert.equal(ctx.isDegradedRun(run(),[old]),false,JSON.stringify(change));
 }
 assert.equal(ctx.isDegradedRun(run({summary:{total:2,meanScore:0,meanScoreRecorded:false}}),[]),false);
});
test('attention is a combined filter and navigation carries scope after resetting filters',()=>{
 assert.match(source,/verdict === "attention"\s*\? isNeedsAttentionRun\(run, sourceRuns\)/);
 assert.match(source,/issueResultsPending \? \[\] : issueCollection.runs/);
 assert.match(source,/resetMoreFilters\(\);\s*setSearch\(""\)/);
 assert.match(source,/setTimeWindowAnchor\(overviewAnchor\)/);
 assert.match(source,/comparisonRuns=\{issueFilterActive \? issueCollection.runs : runs\}/);
});
test('47 attention runs beyond the loaded batch remain visible; pending collections are withheld',()=>{
 let memo;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='filteredRuns')memo=n.initializer;ts.forEachChild(n,visit);}visit(ast);
 const loaded=Array.from({length:200},(_,i)=>run({runId:`healthy-${i}`}));
 const attention=Array.from({length:47},(_,i)=>run({runId:`failed-${i}`,verdict:'failed'}));
 const context={...Object.fromEntries(['type','executionStatus','category','skillFilter','targetEnvironment','agentName','trigger','actor'].map(k=>[k,'all'])),runs:loaded,search:'',runIdLookup:{query:'',run:null},runListFilters:{},runTimeWindow:null,selectedStages:[],minimumGateThreshold:'',minimumPassRate:'',minimumMeanScore:'',sortOrder:'newest',verdict:'attention',issueFilterActive:true,issueResultsPending:false,issueCollection:{runs:[...loaded,...attention]},isNeedsAttentionRun:ctx.isNeedsAttentionRun,isBlockedRun:ctx.isBlockedRun,effectiveRunVerdict:ctx.effectiveRunVerdict};
 const evaluate=c=>vm.runInNewContext(ts.transpileModule(`(${memo.arguments[0].getText(ast)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c)();
 assert.equal(evaluate(context).length,47);
 assert.equal(evaluate({...context,issueResultsPending:true}).length,0);
 assert.equal(evaluate({...context,issueFilterActive:false,verdict:'all'}).length,200);
});
