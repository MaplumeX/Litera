import { describe, expect, it } from "vitest";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { LiteraAgentRuntime, type RuntimeConfig } from "./embedded-runtime";
import type { BookContentPort } from "@/agent/book/book-content";
import type { SessionPort } from "@/agent/sessions/session-port";
import type { DecodedPiSession, PiSessionEntry } from "@/agent/sessions/pi-session";
import type { AnnotationsFile } from "@/types/library";

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

  it("compacts after an overflow, persists the compaction entry, and rebuilds context",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    // Pre-seed a long history (each message ~5000 tokens) so the cut point has
    // enough content to summarize once compaction triggers.
    const long="a".repeat(20_000);
    current.entries=[
      {type:"message",id:"u1",parentId:null,timestamp:now,message:{role:"user",content:long,timestamp:1}},
      {type:"message",id:"a1",parentId:"u1",timestamp:now,message:{role:"assistant",content:[{type:"text",text:long}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"stop",timestamp:2}},
      {type:"message",id:"u2",parentId:"a1",timestamp:now,message:{role:"user",content:long,timestamp:3}},
      {type:"message",id:"a2",parentId:"u2",timestamp:now,message:{role:"assistant",content:[{type:"text",text:long}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"stop",timestamp:4}},
      {type:"message",id:"u3",parentId:"a2",timestamp:now,message:{role:"user",content:long,timestamp:5}},
      {type:"message",id:"a3",parentId:"u3",timestamp:now,message:{role:"assistant",content:[{type:"text",text:long}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"stop",timestamp:6}},
    ];
    current.leafId="a3";
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});
    faux.setResponses([
      fauxAssistantMessage("x",{stopReason:"error",errorMessage:"prompt is too long: 200000 tokens > 100000 maximum"}),
      fauxAssistantMessage("summary of the conversation"),
      fauxAssistantMessage("third answer"),
    ]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.switchSession("session-1");
    await runtime.prompt("second question",{});
    await runtime.prompt("third question",{});
    const compactions=batches.flat().filter((entry)=>entry.type==="compaction");
    expect(compactions).toHaveLength(1);
    expect(compactions[0].summary).toBe("summary of the conversation");
    expect(typeof compactions[0].firstKeptEntryId).toBe("string");
    expect(typeof compactions[0].tokensBefore).toBe("number");
    expect(current.entries.some((entry)=>entry.type==="compaction")).toBe(true);
  });

  it("does not compact a short session",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("answer")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{});
    expect(batches.flat().filter((entry)=>entry.type==="compaction")).toHaveLength(0);
  });

  it("swallows compaction failures without blocking the prompt",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];const events:string[]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});
    faux.setResponses([
      fauxAssistantMessage("first answer"),
      fauxAssistantMessage("x",{stopReason:"error",errorMessage:"prompt is too long: 200000 tokens > 100000 maximum"}),
    ]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    runtime.subscribe((event)=>{events.push(event.type);});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("first question",{});
    await runtime.prompt("second question",{});
    // The summarization request has no queued response → compaction fails silently.
    expect(batches.flat().filter((entry)=>entry.type==="compaction")).toHaveLength(0);
    expect(events).toContain("prompt_end");
  });

  it("does not compact again immediately after a compaction (debounce)",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const long="a".repeat(20_000);
    current.entries=[
      {type:"message",id:"u1",parentId:null,timestamp:now,message:{role:"user",content:long,timestamp:1}},
      {type:"message",id:"a1",parentId:"u1",timestamp:now,message:{role:"assistant",content:[{type:"text",text:long}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"stop",timestamp:2}},
      {type:"message",id:"u2",parentId:"a1",timestamp:now,message:{role:"user",content:long,timestamp:3}},
      {type:"message",id:"a2",parentId:"u2",timestamp:now,message:{role:"assistant",content:[{type:"text",text:long}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"stop",timestamp:4}},
      {type:"message",id:"u3",parentId:"a2",timestamp:now,message:{role:"user",content:long,timestamp:5}},
      {type:"message",id:"a3",parentId:"u3",timestamp:now,message:{role:"assistant",content:[{type:"text",text:long}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"stop",timestamp:6}},
    ];
    current.leafId="a3";
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});
    faux.setResponses([
      fauxAssistantMessage("x",{stopReason:"error",errorMessage:"prompt is too long: 200000 tokens > 100000 maximum"}),
      fauxAssistantMessage("summary of the conversation"),
      fauxAssistantMessage("third answer"),
      fauxAssistantMessage("fourth answer"),
    ]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.switchSession("session-1");
    await runtime.prompt("second question",{});
    await runtime.prompt("third question",{});
    await runtime.prompt("fourth question",{});
    // Only one compaction: the post-compaction prompt must not retrigger it.
    expect(batches.flat().filter((entry)=>entry.type==="compaction")).toHaveLength(1);
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

  it("persists list_annotations bookmarks and highlights as JSON toolResult",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const annotations:AnnotationsFile={schemaVersion:1,bookmarks:[{id:"b1",cfi:"epubcfi(/6/8!/4/2/1:0)",fraction:0.2,createdAt:"2026-08-14T00:00:00.000Z",label:"Loomings"},{id:"b2",cfi:"epubcfi(/6/10!/4/2/1:0)",fraction:0,createdAt:"2026-08-14T00:00:00.000Z"}],highlights:[{id:"h1",cfi:"epubcfi(/6/8!/4/2,/1:12,/1:48)",excerpt:"Call me Ishmael.",createdAt:"2026-08-14T00:00:00.000Z"}]};
    const requested:string[]=[];
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("list_annotations",{}),{stopReason:"toolUse"}),fauxAssistantMessage("those marks")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple,loadAnnotations:async(bookId)=>{requested.push(bookId);return annotations;}});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("what did I highlight?",{});
    expect(requested).toEqual(["book"]);
    expect(listAnnotationsPayload(batches)).toEqual({bookmarks:[{id:"b1",cfi:"epubcfi(/6/8!/4/2/1:0)",fraction:0.2,createdAt:"2026-08-14T00:00:00.000Z",label:"Loomings"},{id:"b2",cfi:"epubcfi(/6/10!/4/2/1:0)",fraction:0,createdAt:"2026-08-14T00:00:00.000Z"}],highlights:[{id:"h1",cfi:"epubcfi(/6/8!/4/2,/1:12,/1:48)",excerpt:"Call me Ishmael.",createdAt:"2026-08-14T00:00:00.000Z"}]});
  });

  it("returns empty bookmark and highlight arrays when the annotations file is empty",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("list_annotations",{}),{stopReason:"toolUse"}),fauxAssistantMessage("none")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple,loadAnnotations:async()=>({schemaVersion:1,bookmarks:[],highlights:[]})});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("any marks?",{});
    expect(listAnnotationsPayload(batches)).toEqual({bookmarks:[],highlights:[]});
  });

  it("returns a structured tool error when get_annotations fails",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("list_annotations",{}),{stopReason:"toolUse"}),fauxAssistantMessage("could not read marks")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple,loadAnnotations:async()=>{throw{code:"StorageCorrupt",message:"Failed to parse annotations.json"};}});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("what did I mark?",{});
    const result=listAnnotationsResult(batches);
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain("Failed to parse annotations.json");
    expect(result?.text).not.toContain("[object Object]");
  });

  it("rejects a stale list_annotations execute after the bookId switches",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    let releaseLoad:(value:AnnotationsFile)=>void=()=>{};
    const pending=new Promise<AnnotationsFile>((resolve)=>{releaseLoad=resolve;});
    let started!:()=>void;
    const loadStarted=new Promise<void>((resolve)=>{started=resolve;});
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("list_annotations",{}),{stopReason:"toolUse"}),fauxAssistantMessage("stale")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple,loadAnnotations:async()=>{started();return pending;}});
    await runtime.openBook("book-a",new ArrayBuffer(1));
    const prompt=runtime.prompt("what did I mark?",{});
    await loadStarted;
    await runtime.openBook("book-b",new ArrayBuffer(1));
    releaseLoad({schemaVersion:1,bookmarks:[{id:"stale",cfi:"epubcfi(/6/8!/4/2/1:0)",fraction:0.2,createdAt:"2026-08-14T00:00:00.000Z",label:"Loomings"}],highlights:[]});
    await prompt.catch(()=>{});
    const result=listAnnotationsResult(batches);
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain("电子书上下文已切换");
    expect(result?.text).not.toContain("stale");
  });
});

function listAnnotationsResult(batches:PiSessionEntry[][]):{isError:boolean;text:string}|undefined{
  for(const entry of batches.flat()){
    if(entry.type!=="message")continue;
    const message=entry.message as {role?:string;toolName?:string;isError?:boolean;content?:Array<{type?:string;text?:string}>};
    if(message.role==="toolResult"&&message.toolName==="list_annotations"){
      return{isError:message.isError===true,text:message.content?.find((block)=>block.type==="text")?.text??""};
    }
  }
}

function listAnnotationsPayload(batches:PiSessionEntry[][]):unknown{
  const result=listAnnotationsResult(batches);
  expect(result?.isError).toBe(false);
  expect(result?.text).toBeTruthy();
  return JSON.parse(result!.text);
}
