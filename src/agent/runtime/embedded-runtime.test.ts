import { describe, expect, it } from "vitest";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { LiteraAgentRuntime, type RuntimeConfig } from "./embedded-runtime";
import type { BookContentPort } from "@/agent/book/book-content";
import type { SessionPort } from "@/agent/sessions/session-port";
import type { DecodedPiSession, PiSessionEntry } from "@/agent/sessions/pi-session";

const now="2026-08-14T00:00:00Z";
function session():DecodedPiSession{return{header:{type:"session",version:3,id:"session-1",timestamp:now,cwd:""},entries:[],leafId:null};}

describe("LiteraAgentRuntime",()=>{
  it("persists the user before network and completed assistant after settlement",async()=>{
    const current=session();const order:string[]=[];const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{order.push(`append:${entries.map((entry)=>entry.type).join(",")}`);batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[{index:0,label:"One",hrefs:["one.xhtml"],chars:10}],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("answer")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{order.push("network");return faux.streamSimple(requestModel,context,options);})});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{});
    expect(order[0]).toBe("append:model_change,custom_message,message");
    expect(order[1]).toBe("network");
    expect(batches[0][2].message).toMatchObject({role:"user",content:"question"});
    expect(batches[1][0].message).toMatchObject({role:"assistant"});
  });

  it("drops the cached Agent after config invalidation and records the new model",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];const requestedModels:string[]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("one"),fauxAssistantMessage("two")]);
    let config:RuntimeConfig={provider:"custom-a",model:"model-a",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{requestedModels.push(requestModel.id);return faux.streamSimple(requestModel,context,options);})});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("first",{});
    config={...config,provider:"custom-b",model:"model-b"};
    runtime.invalidateConfig();
    await runtime.prompt("second",{});
    expect(requestedModels).toEqual(["model-a","model-b"]);
    const changes=batches.flat().filter((entry)=>entry.type==="model_change");
    expect(changes).toMatchObject([{provider:"custom-a",modelId:"model-a"},{provider:"custom-b",modelId:"model-b"}]);
  });

  it("compares an edited branch against the persisted leaf while parenting from the edit point",async()=>{
    const current=session();
    current.entries=[
      {type:"message",id:"user0001",parentId:null,timestamp:now,message:{role:"user",content:"old question",timestamp:1}},
      {type:"message",id:"answer01",parentId:"user0001",timestamp:now,message:{role:"assistant",content:[{type:"text",text:"old answer"}],api:"openai-completions",provider:"custom-a",model:"model-a",usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"stop",timestamp:2}},
    ];
    current.leafId="answer01";
    const appends:Array<{expected:string|null;entries:PiSessionEntry[]}>=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,expected,entries)=>{appends.push({expected,entries});return entries.at(-1)?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("new answer")]);
    const config:RuntimeConfig={provider:"custom-a",model:"model-a",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.switchSession("session-1");
    await runtime.prompt("edited question",{},"prompt-1",undefined,0);
    expect(appends[0].expected).toBe("answer01");
    expect(appends[0].entries[0].parentId).toBeNull();
  });

  it("reserves the prompt before async preflight so concurrent prompts cannot race",async()=>{
    const current=session();let releaseConfig:(value:RuntimeConfig)=>void=()=>{};
    const configPromise=new Promise<RuntimeConfig>((resolve)=>{releaseConfig=resolve;});
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>entries.at(-1)?.id??null};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("answer")]);
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:()=>configPromise,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    const first=runtime.prompt("first",{});
    await Promise.resolve();
    await expect(runtime.prompt("second",{})).rejects.toThrow("already active");
    releaseConfig({provider:"custom-a",model:"model-a",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"});
    await first;
  });
});
