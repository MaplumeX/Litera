import { describe, expect, it, vi } from "vitest";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { LiteraAgentRuntime, SYSTEM_PROMPT, type RuntimeConfig } from "./embedded-runtime";
import type { BookContentPort } from "@/agent/book/book-content";
import type { SessionPort } from "@/agent/sessions/session-port";
import type { DecodedPiSession, PiSessionEntry } from "@/agent/sessions/pi-session";
import type { AnnotationsFile } from "@/types/library";
import type { AgentEvent, AgentMessage } from "@/types/agent";

const now="2026-08-14T00:00:00Z";
function session():DecodedPiSession{return{header:{type:"session",version:3,id:"session-1",timestamp:now,cwd:""},entries:[],leafId:null};}

describe("LiteraAgentRuntime",()=>{
  it("tells the model how to write Citations",()=>{
    expect(SYSTEM_PROMPT).toContain("[quoted text](cite:CHAPTER_INDEX)");
  });

  it("checks Citations against the open book only",async()=>{
    const sessions:SessionPort={create:async()=>session(),list:async()=>[],load:async()=>session(),delete:async()=>{},append:async()=>null};
    const locateQuote=vi.fn(async(chapterIndex:number)=>({status:"verified" as const,chapterIndex}));
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],locateQuote,close:()=>{}};
    const runtime=new LiteraAgentRuntime({sessions,book});
    await expect(runtime.locateQuote(0,"quote")).rejects.toThrow("No book is open");
    await runtime.openBook("book",new ArrayBuffer(1));
    await expect(runtime.locateQuote(3,"quote")).resolves.toEqual({status:"verified",chapterIndex:3});
    expect(locateQuote).toHaveBeenCalledWith(3,"quote");
  });

  it("persists the user before network and completed assistant after settlement",async()=>{
    const current=session();const order:string[]=[];const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{order.push(`append:${entries.map((entry)=>entry.type).join(",")}`);batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[{index:0,label:"One",ancestors:[],depth:0,hrefs:["one.xhtml"],chars:10}],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("answer")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{order.push("network");return faux.streamSimple(requestModel,context,options);})});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{selection:"quoted text",chapterHref:"OPS/ch1.xhtml"});
    expect(order[0]).toBe("append:model_change,custom_message,custom_message,message");
    expect(order[1]).toBe("network");
    const userEntry=batches[0][3];
    expect(userEntry.message).toMatchObject({role:"user",content:"question"});
    // Prompt context is persisted on the entry payload (not the PiMessage).
    expect(userEntry).toMatchObject({selection:"quoted text",chapterHref:"OPS/ch1.xhtml"});
    expect(userEntry.message).not.toHaveProperty("selection");
    expect(batches[1][0].message).toMatchObject({role:"assistant"});
  });

  it("drops the cached Agent after config invalidation and records the new model",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];const requestedModels:string[]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("one"),fauxAssistantMessage("title"),fauxAssistantMessage("two"),fauxAssistantMessage("title")]);
    let config:RuntimeConfig={provider:"custom-a",model:"model-a",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{requestedModels.push(requestModel.id);return faux.streamSimple(requestModel,context,options);})});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("first",{});
    await new Promise((resolve)=>setTimeout(resolve,0));// flush the fire-and-forget title task before invalidating
    config={...config,provider:"custom-b",model:"model-b"};
    runtime.invalidateConfig();
    await runtime.prompt("second",{});
    // The first turn's title request also streams with model-a.
    expect(requestedModels).toEqual(["model-a","model-a","model-b"]);
    const changes=batches.flat().filter((entry)=>entry.type==="model_change");
    expect(changes).toMatchObject([{provider:"custom-a",modelId:"model-a"},{provider:"custom-b",modelId:"model-b"}]);
  });

  it("lets an in-flight answer finish when the config changes and still honours a later stop",async()=>{
    const current=session();const requestedModels:string[]=[];const events:AgentEvent[]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>entries[entries.length-1]?.id??null};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:200});faux.setResponses([fauxAssistantMessage("a fairly long first answer that streams in several deltas"),fauxAssistantMessage("title"),fauxAssistantMessage("a fairly long second answer that streams in several deltas")]);
    let config:RuntimeConfig={provider:"custom-a",model:"model-a",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{requestedModels.push(requestModel.id);return faux.streamSimple(requestModel,context,options);})});
    runtime.subscribe((event)=>{events.push(event);});
    await runtime.openBook("book",new ArrayBuffer(1));
    let invalidated=false;
    const unsubscribe=runtime.subscribe((event)=>{if(event.type==="text_delta"&&!invalidated){invalidated=true;config={...config,provider:"custom-b",model:"model-b"};runtime.invalidateConfig();}});
    await runtime.prompt("first",{});
    unsubscribe();
    expect(invalidated).toBe(true);
    expect(events.some((event)=>event.type==="prompt_end")).toBe(true);
    expect(events.some((event)=>event.type==="prompt_aborted")).toBe(false);
    await new Promise((resolve)=>setTimeout(resolve,0));
    // A stop pressed after a config change still reaches the in-flight request.
    const stop=runtime.subscribe((event)=>{if(event.type==="text_delta"){runtime.invalidateConfig();runtime.abort();}});
    await runtime.prompt("second",{});
    stop();
    expect(events.some((event)=>event.type==="prompt_aborted")).toBe(true);
    expect(requestedModels.at(-1)).toBe("model-b");
  });

  it("never hands another provider's key to a ChatGPT request after a mid-answer switch",async()=>{
    const current=session();const apiKeys:(string|undefined)[]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>entries[entries.length-1]?.id??null};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[{index:0,label:"One",ancestors:[],depth:0,hrefs:["one.xhtml"],chars:10}],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("list_annotations",{}),{stopReason:"toolUse"}),fauxAssistantMessage("done")]);
    let config:RuntimeConfig={provider:"chatgpt",model:"gpt-plan-only",api:"openai-responses",baseUrl:"https://chatgpt.example/v1",apiKey:"chatgpt-token",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadAnnotations:async()=>({version:1,annotations:[]} as unknown as AnnotationsFile),loadStream:async()=>((requestModel,context,options)=>{apiKeys.push(options?.apiKey);if(apiKeys.length===1){config={...config,provider:"anthropic",model:"claude",apiKey:"anthropic-key"};runtime.invalidateConfig();}return faux.streamSimple(requestModel,context,options);})});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{}).catch(()=>{});
    expect(apiKeys[0]).toBe("chatgpt-token");
    expect(apiKeys).not.toContain("anthropic-key");
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
    const config:RuntimeConfig={provider:"custom-a",model:"model-a",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.switchSession("session-1");
    await runtime.prompt("edited question",{},"prompt-1",undefined,0);
    expect(appends[0].expected).toBe("answer01");
    expect(appends[0].entries[0].parentId).toBeNull();
  });

  describe("context maintenance",()=>{
    const zeroUsage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
    const text=(chars:number)=>"a".repeat(chars);
    const userEntry=(id:string,parentId:string|null,content:string):PiSessionEntry=>({type:"message",id,parentId,timestamp:now,message:{role:"user",content,timestamp:1}});
    const assistantEntry=(id:string,parentId:string,content:unknown[]):PiSessionEntry=>({type:"message",id,parentId,timestamp:now,message:{role:"assistant",content,usage:zeroUsage,stopReason:"stop",timestamp:2}});
    /** Six alternating user/assistant entries of `chars` characters each, leaf "a3". */
    function history(chars:number):PiSessionEntry[]{const ids=["u1","a1","u2","a2","u3","a3"];return ids.map((id,index)=>index%2?assistantEntry(id,ids[index-1],[{type:"text",text:text(chars)}]):userEntry(id,index?ids[index-1]:null,text(chars)));}
    function harness(entries:PiSessionEntry[],contextWindow?:number,options:{holdSummary?:boolean}={}){
      const current=session();current.entries=entries;current.leafId=entries.at(-1)?.id??null;
      const batches:PiSessionEntry[][]=[];const events:AgentEvent[]=[];const requests:string[]=[];
      const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,appended)=>{batches.push(appended);return appended.at(-1)?.id??null;}};
      const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
      const faux=createFauxCore({tokensPerSecond:1_000_000});
      const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off",...(contextWindow?{contextWindow}:{})};
      const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>(async(requestModel,context,streamOptions)=>{
        const isSummary=getCurrentSystemPrompt(context.messages)?.includes("context summarization")??false;
        requests.push(isSummary?"summary":JSON.stringify(context.messages));
        if(isSummary&&options.holdSummary)await new Promise((resolve)=>streamOptions?.signal?.addEventListener("abort",resolve));
        return faux.streamSimple(requestModel,context,streamOptions);
      })});
      runtime.subscribe((event)=>{events.push(event);});
      const appended=(type:string)=>batches.flat().filter((entry)=>entry.type===type);
      return {current,batches,events,requests,faux,runtime,appended,start:async()=>{await runtime.openBook("book",new ArrayBuffer(1));await runtime.switchSession("session-1");}};
    }

    it("unlocks the input before compacting in the background, and the next prompt sees the summary",async()=>{
      // 40k window: compactAt 34k. History is ~30k tokens, so only the answer to
      // the long question crosses the threshold.
      const h=harness(history(20_000),40_000);
      h.faux.setResponses([fauxAssistantMessage("answer"),fauxAssistantMessage("summary of the conversation"),fauxAssistantMessage("next answer")]);
      await h.start();
      await h.runtime.prompt(text(20_000),{});
      const types=h.events.map((event)=>event.type);
      expect(types.indexOf("prompt_end")).toBeGreaterThanOrEqual(0);
      expect(types.indexOf("compaction_started")).toBeGreaterThan(types.indexOf("prompt_end"));
      await h.runtime.prompt("next question",{});
      expect(h.appended("compaction")).toHaveLength(1);
      expect(h.appended("compaction")[0]).toMatchObject({summary:"summary of the conversation",firstKeptEntryId:expect.any(String)});
      expect(h.requests.at(-1)).toContain("summary of the conversation");
      const completed=h.events.find((event)=>event.type==="compaction_completed");
      expect(completed?.type==="compaction_completed"&&completed.messages.some((message)=>message.role==="notice")).toBe(true);
    });

    it("prunes old Book text without a model call when that is enough",async()=>{
      const entries:PiSessionEntry[]=[
        userEntry("u1",null,"explain chapter one"),
        assistantEntry("c1","u1",[{type:"toolCall",id:"call1",name:"read_chapter",arguments:{chapterIndex:0}}]),
        {type:"message",id:"r1",parentId:"c1",timestamp:now,message:{role:"toolResult",toolCallId:"call1",toolName:"read_chapter",content:[{type:"text",text:"CHAPTER-TEXT ".repeat(7_000)}],isError:false,timestamp:3}},
        assistantEntry("a1","r1",[{type:"text",text:"chapter one is about whales"}]),
        userEntry("u2","a1","and then?"),
        assistantEntry("a2","u2",[{type:"text",text:"more whales"}]),
      ];
      const h=harness(entries,40_000);
      h.faux.setResponses([fauxAssistantMessage("answer"),fauxAssistantMessage("second answer")]);
      await h.start();
      await h.runtime.prompt("question",{});
      await h.runtime.prompt("another question",{});
      expect(h.appended("context_prune")).toMatchObject([{throughEntryId:"a1"}]);
      expect(h.appended("compaction")).toHaveLength(0);
      expect(h.requests).not.toContain("summary");
      expect(h.requests.at(-1)).not.toContain("CHAPTER-TEXT");
      expect(h.requests.at(-1)).toContain("cleared to save context");
      // The transcript still shows the full tool result.
      expect(h.current.entries.find((entry)=>entry.id==="r1")).toBeDefined();
    });

    it("compacts and retries once when a request overflows the context window",async()=>{
      const h=harness(history(20_000));
      h.faux.setResponses([
        fauxAssistantMessage("x",{stopReason:"error",errorMessage:"prompt is too long: 200000 tokens > 100000 maximum"}),
        fauxAssistantMessage("summary of the conversation"),
        fauxAssistantMessage("answer"),
        fauxAssistantMessage("fourth answer"),
      ]);
      await h.start();
      await h.runtime.prompt("third question",{});
      expect(h.events.map((event)=>event.type)).toContain("retry_scheduled");
      expect(h.events).toContainEqual(expect.objectContaining({type:"compaction_started",reason:"overflow"}));
      expect(h.appended("compaction")).toHaveLength(1);
      const messages=h.batches.flat().filter((entry)=>entry.type==="message").map((entry)=>entry.message as {role:string;content:unknown;stopReason?:string});
      expect(messages.filter((message)=>message.role==="user").map((message)=>message.content)).toEqual(["third question"]);
      expect(messages.filter((message)=>message.role==="assistant").map((message)=>message.stopReason)).toEqual(["stop"]);
      const end=h.events.find((event)=>event.type==="prompt_end");
      expect(end?.type==="prompt_end"&&end.messages?.filter((message)=>message.role==="notice")).toHaveLength(1);
      // The compacted context does not retrigger compaction on the next turn.
      await h.runtime.prompt("fourth question",{});
      await h.runtime.settled();
      expect(h.appended("compaction")).toHaveLength(1);
    });

    it("reports the overflow when compaction cannot recover it",async()=>{
      const h=harness(history(20_000));
      h.faux.setResponses([fauxAssistantMessage("x",{stopReason:"error",errorMessage:"prompt is too long: 200000 tokens > 100000 maximum"})]);
      await h.start();
      await h.runtime.prompt("third question",{});
      expect(h.events).toContainEqual(expect.objectContaining({type:"compaction_failed",aborted:false}));
      expect(h.appended("compaction")).toHaveLength(0);
      const assistants=h.batches.flat().filter((entry)=>entry.type==="message"&&(entry.message as {role:string}).role==="assistant");
      expect(assistants.map((entry)=>(entry.message as {stopReason:string}).stopReason)).toEqual(["error"]);
    });

    it("stops background compaction on abort without persisting it",async()=>{
      const h=harness(history(20_000),40_000,{holdSummary:true});
      h.faux.setResponses([fauxAssistantMessage("answer"),fauxAssistantMessage("summary of the conversation")]);
      await h.start();
      await h.runtime.prompt(text(20_000),{});
      await vi.waitFor(()=>expect(h.requests.at(-1)).toBe("summary"));
      h.runtime.abort();
      await h.runtime.settled();
      expect(h.appended("compaction")).toHaveLength(0);
      expect(h.events).toContainEqual(expect.objectContaining({type:"compaction_failed",aborted:true}));
    });

    it("keeps the system prompt and persists the user once when compaction runs before the prompt",async()=>{
      const current=session();const batches:PiSessionEntry[][]=[];const systemPrompts:Array<string|undefined>=[];
      const long="a".repeat(20_000);
      const usage=(totalTokens:number)=>({input:totalTokens,output:0,cacheRead:0,cacheWrite:0,totalTokens,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}});
      const ids=["u1","a1","u2","a2","u3","a3"];
      // The last assistant reports usage near the context window, so the
      // pre-prompt compaction check fires before the new question is sent.
      current.entries=ids.map((id,index)=>({type:"message",id,parentId:index?ids[index-1]:null,timestamp:now,message:index%2?{role:"assistant",content:[{type:"text",text:long}],usage:usage(index===5?95_000:0),stopReason:"stop",timestamp:Date.now()}:{role:"user",content:long,timestamp:index}}));
      current.leafId="a3";
      const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
      const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
      const faux=createFauxCore({tokensPerSecond:100_000});
      faux.setResponses([fauxAssistantMessage("summary of the conversation"),fauxAssistantMessage("answer")]);
      const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off",contextWindow:100_000};
      const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{systemPrompts.push(getCurrentSystemPrompt(context.messages));return faux.streamSimple(requestModel,context,options);})});
      await runtime.openBook("book",new ArrayBuffer(1));
      await runtime.switchSession("session-1");
      await runtime.prompt("fourth question",{});
      expect(batches.flat().filter((entry)=>entry.type==="compaction")).toHaveLength(1);
      // The prompt request after compaction still carries the Litera system prompt.
      expect(systemPrompts.at(-1)).toBe(SYSTEM_PROMPT);
      const users=batches.flat().filter((entry)=>entry.type==="message"&&(entry.message as {role?:string}).role==="user");
      expect(users.map((entry)=>(entry.message as {content?:unknown}).content)).toEqual(["fourth question"]);
    });
  });

  it("does not compact a short session",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("answer")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{});
    expect(batches.flat().filter((entry)=>entry.type==="compaction")).toHaveLength(0);
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
    releaseConfig({provider:"custom-a",model:"model-a",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"});
    await first;
  });

  it("uses the session system prompt and clamps thinking to off for a non-reasoning model",async()=>{
    const current=session();current.entries=[{type:"session_config",id:"cfg1",parentId:null,timestamp:now,systemPrompt:"你是翻译助手",thinkingLevel:"high"}];current.leafId="cfg1";
    const captured:Array<{systemPrompt?:string;reasoning?:unknown}>=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>entries.at(-1)?.id??null};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("answer")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{captured.push({systemPrompt:getCurrentSystemPrompt(context.messages),reasoning:options?.reasoning});return faux.streamSimple(requestModel,context,options);})});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.switchSession("session-1");
    await runtime.prompt("question",{});
    expect(captured[0].systemPrompt).toBe(`${SYSTEM_PROMPT}\n\n你是翻译助手`);
    expect(captured[0].reasoning).toBeUndefined();
  });

  it("keeps the leading system message, tool declarations included, in the provider request",async()=>{
    const current=session();const captured:AgentMessage[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>entries.at(-1)?.id??null};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("answer")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{captured.push(context.messages as unknown as AgentMessage[]);return faux.streamSimple(requestModel,context,options);})});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{});
    const head=captured[0][0] as unknown as {role:string;content:unknown;toolsAdded?:Array<{name:string}>};
    expect(head.role).toBe("system");
    expect(head.content).toBe(SYSTEM_PROMPT);
    expect(head.toolsAdded?.map((tool)=>tool.name)).toContain("read_chapter");
  });

  it("keeps the max thinking level for a reasoning-capable model",async()=>{
    const current=session();current.entries=[{type:"session_config",id:"cfg1",parentId:null,timestamp:now,systemPrompt:"",thinkingLevel:"max"}];current.leafId="cfg1";
    const captured:Array<unknown>=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>entries.at(-1)?.id??null};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("answer")]);
    const config:RuntimeConfig={provider:"anthropic",model:"claude-opus-4-6",api:"anthropic-messages",baseUrl:"https://api.anthropic.com",apiKey:"secret",thinkingLevel:"max"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{captured.push(options?.reasoning);return faux.streamSimple(requestModel,context,options);})});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.switchSession("session-1");
    await runtime.prompt("question",{});
    expect(captured[0]).toBe("max");
  });

  it("appends session_config, rebuilds the agent, and applies the new config to the next prompt",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];const events:string[]=[];const captured:Array<{systemPrompt?:string;reasoning?:unknown}>=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries.at(-1)?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("answer"),fauxAssistantMessage("title")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{captured.push({systemPrompt:getCurrentSystemPrompt(context.messages),reasoning:options?.reasoning});return faux.streamSimple(requestModel,context,options);})});
    runtime.subscribe((event)=>{events.push(event.type);});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("first",{});
    expect(captured[0].systemPrompt).not.toBe("新提示词");
    await runtime.updateSessionConfig("session-1","新提示词","req-1");
    const configEntries=batches.flat().filter((entry)=>entry.type==="session_config");
    expect(configEntries).toMatchObject([{systemPrompt:"新提示词"}]);
    expect(events).toContain("session_config_updated");
    await runtime.prompt("second",{});
    expect(captured[2].systemPrompt).toBe(`${SYSTEM_PROMPT}\n\n新提示词`);
    expect(captured[2].reasoning).toBeUndefined();
  });

  it("rejects an invalid session config update",async()=>{
    const current=session();
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async()=>null};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:"openai-completions",baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config});
    await expect(runtime.updateSessionConfig("session-1","ok")).rejects.toThrow("No book is open");
    await runtime.openBook("book",new ArrayBuffer(1));
    await expect(runtime.updateSessionConfig("session-1","x".repeat(16*1024+1))).rejects.toThrow("Invalid system prompt");
  });

  it("persists list_annotations bookmarks and highlights as JSON toolResult",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const annotations:AnnotationsFile={schemaVersion:1,bookmarks:[{id:"b1",cfi:"epubcfi(/6/8!/4/2/1:0)",fraction:0.2,createdAt:"2026-08-14T00:00:00.000Z",label:"Loomings"},{id:"b2",cfi:"epubcfi(/6/10!/4/2/1:0)",fraction:0,createdAt:"2026-08-14T00:00:00.000Z"}],highlights:[{id:"h1",cfi:"epubcfi(/6/8!/4/2,/1:12,/1:48)",excerpt:"Call me Ishmael.",createdAt:"2026-08-14T00:00:00.000Z",color:"green",note:"opening line"},{id:"h2",cfi:"epubcfi(/6/10!/4/2,/1:0,/1:12)",excerpt:"Some years ago",createdAt:"2026-08-14T00:00:00.000Z"}]};
    const requested:string[]=[];
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("list_annotations",{}),{stopReason:"toolUse"}),fauxAssistantMessage("those marks")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple,loadAnnotations:async(bookId)=>{requested.push(bookId);return annotations;}});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("what did I highlight?",{});
    expect(requested).toEqual(["book"]);
    expect(listAnnotationsPayload(batches)).toEqual({bookmarks:[{id:"b1",cfi:"epubcfi(/6/8!/4/2/1:0)",fraction:0.2,createdAt:"2026-08-14T00:00:00.000Z",label:"Loomings"},{id:"b2",cfi:"epubcfi(/6/10!/4/2/1:0)",fraction:0,createdAt:"2026-08-14T00:00:00.000Z"}],highlights:[{id:"h1",cfi:"epubcfi(/6/8!/4/2,/1:12,/1:48)",excerpt:"Call me Ishmael.",createdAt:"2026-08-14T00:00:00.000Z",color:"green",note:"opening line"},{id:"h2",cfi:"epubcfi(/6/10!/4/2,/1:0,/1:12)",excerpt:"Some years ago",createdAt:"2026-08-14T00:00:00.000Z",color:"yellow"}]});
  });

  it("returns empty bookmark and highlight arrays when the annotations file is empty",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("list_annotations",{}),{stopReason:"toolUse"}),fauxAssistantMessage("none")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
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
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple,loadAnnotations:async()=>{throw{code:"StorageCorrupt",message:"Failed to parse annotations.json"};}});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("what did I mark?",{});
    const result=listAnnotationsResult(batches);
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain("Failed to parse annotations.json");
    expect(result?.text).not.toContain("[object Object]");
  });

  it("maps get_toc entries onto the hierarchical path/depth shape and never leaks hrefs",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"zh",totalChapters:2}),toc:async()=>[{index:0,label:"第一卷 出走",ancestors:[],depth:0,hrefs:["OPS/vol1.xhtml#ch1"],chars:100},{index:1,label:"第二章 母亲的信",ancestors:["第一卷 出走"],depth:1,hrefs:["OPS/vol1.xhtml#ch2"],chars:7200}],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("get_toc",{}),{stopReason:"toolUse"}),fauxAssistantMessage("ok")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("list chapters",{});
    const text=getToolResultText(batches,"get_toc");
    expect(text).toBeTruthy();
    const payload=JSON.parse(text!);
    expect(payload).toEqual([
      {chapterIndex:0,chapterNumber:1,title:"第一卷 出走",path:["第一卷 出走"],depth:0,chars:100},
      {chapterIndex:1,chapterNumber:2,title:"第二章 母亲的信",path:["第一卷 出走","第二章 母亲的信"],depth:1,chars:7200},
    ]);
    expect(text).not.toContain("xhtml");
    expect(text).not.toContain("hrefs");
  });

  it("generates and persists a session title after the first turn",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];const events:{type:string;title?:string}[]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries.at(-1)?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});
    faux.setResponses([fauxAssistantMessage("the answer"),fauxAssistantMessage("Reading Questions")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    runtime.subscribe((event)=>{events.push({type:event.type,title:event.type==="session_renamed"?event.title:undefined});});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{});
    await vi.waitFor(()=>{expect(events.some((event)=>event.type==="session_renamed")).toBe(true);});
    expect(events.find((event)=>event.type==="session_renamed")).toMatchObject({title:"Reading Questions"});
    const infos=batches.flat().filter((entry)=>entry.type==="session_info");
    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatchObject({name:"Reading Questions"});
  });

  it("keeps the fallback title when the title request fails",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];const events:string[]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries.at(-1)?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("answer"),fauxAssistantMessage("x",{stopReason:"error",errorMessage:"429: too many requests"})]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    runtime.subscribe((event)=>{events.push(event.type);});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{});
    await vi.waitFor(()=>{expect(warn).toHaveBeenCalled();});
    expect(events).toContain("prompt_end");
    expect(events).not.toContain("session_renamed");
    expect(batches.flat().filter((entry)=>entry.type==="session_info")).toHaveLength(0);
    warn.mockRestore();
  });

  it("skips the generated title when the user renamed during generation",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];const events:{type:string;title?:string}[]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);for(const entry of entries)current.entries.push(entry);return entries.at(-1)?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});
    faux.setResponses([
      fauxAssistantMessage("answer"),
      (context,_options,state,model)=>{
        // The user renames while the title request is in flight; only then resolve it.
        const renamed={type:"session_info",id:crypto.randomUUID(),parentId:current.leafId,timestamp:new Date(Date.now()+1000).toISOString(),name:"手动标题"};
        current.entries.push(renamed);current.leafId=renamed.id;
        return fauxAssistantMessage("Generated Title",{timestamp:1});
      },
    ]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    runtime.subscribe((event)=>{events.push({type:event.type,title:event.type==="session_renamed"?event.title:undefined});});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{});
    // Flush the fire-and-forget title task.
    await vi.waitFor(()=>{expect(batches.some((batch)=>batch.some((entry)=>entry.type==="session_info"))||current.entries.some((entry)=>entry.type==="session_info")).toBe(true);});
    await new Promise((resolve)=>setTimeout(resolve,0));
    // The manual rename (newer session_info) blocks the generated title.
    expect(events.filter((event)=>event.type==="session_renamed")).toEqual([]);
    const infos=current.entries.filter((entry)=>entry.type==="session_info");
    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatchObject({name:"手动标题"});
  });

  it("retries a transient 429 failure with backoff and emits retry_scheduled",async()=>{
    const current=session();const events:{type:string;attempt?:number;maxAttempts?:number;delayMs?:number;bookId?:string;sessionId?:string;promptId?:string}[]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>entries.at(-1)?.id??null};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("x",{stopReason:"error",errorMessage:"429: too many requests, please retry later"}),fauxAssistantMessage("x",{stopReason:"error",errorMessage:"503: service unavailable"}),fauxAssistantMessage("recovered")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    runtime.subscribe((event)=>{events.push(event);});
    await runtime.openBook("book",new ArrayBuffer(1));
    vi.useFakeTimers();
    const prompt=runtime.prompt("question",{},"prompt-retry");
    await vi.runAllTimersAsync();
    await prompt;
    vi.useRealTimers();
    const retries=events.filter((event)=>event.type==="retry_scheduled");
    expect(retries).toHaveLength(2);
    expect(retries[0]).toMatchObject({attempt:1,maxAttempts:3,delayMs:500,bookId:"book",sessionId:"session-1",promptId:"prompt-retry"});
    expect(retries[1]).toMatchObject({attempt:2,delayMs:1000});
    expect(events.some((event)=>event.type==="prompt_end")).toBe(true);
  });

  it("normalizes a backoff-sleep abort into a persisted terminal aborted assistant",async()=>{
    const current=session();const events:string[]=[];const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries.at(-1)?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("x",{stopReason:"error",errorMessage:"429: too many requests, please retry later"}),fauxAssistantMessage("never reached")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    runtime.subscribe((event)=>{events.push(event.type);});
    await runtime.openBook("book",new ArrayBuffer(1));
    vi.useFakeTimers();
    const prompt=runtime.prompt("question",{},"prompt-abort");
    await vi.advanceTimersByTimeAsync(0);// first attempt settles with 429, backoff sleep starts
    runtime.abort();
    await vi.runAllTimersAsync();
    await prompt;
    vi.useRealTimers();
    expect(events).toContain("retry_scheduled");
    expect(events).toContain("prompt_aborted");
    expect(events).not.toContain("prompt_end");
    // The aborted assistant never entered agent state, yet is persisted.
    const persisted=batches.flat().filter((entry)=>entry.type==="message");
    expect(persisted.some((entry)=>((entry.message as {stopReason?:string}).stopReason)==="aborted")).toBe(true);
  });

  it("does not retry a deterministic 401 auth failure",async()=>{
    const current=session();const events:string[]=[];const batches:PiSessionEntry[][]=[];const ends:AgentEvent[]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries.at(-1)?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("x",{stopReason:"error",errorMessage:"401: unauthorized, invalid api key"}),fauxAssistantMessage("never reached")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    runtime.subscribe((event)=>{events.push(event.type);ends.push(event);});
    await runtime.openBook("book",new ArrayBuffer(1));
    vi.useFakeTimers();
    const prompt=runtime.prompt("question",{},"prompt-auth");
    await vi.runAllTimersAsync();
    await prompt;
    vi.useRealTimers();
    expect(events).not.toContain("retry_scheduled");
    expect(events).toContain("prompt_end");
    // The classified reason is persisted and surfaced on the final message; the raw provider text never is.
    const reason="API Key 无效或无权限，请检查模型配置";
    const persisted=batches.flat().filter((entry)=>entry.type==="message").map((entry)=>entry.message as {stopReason?:string;errorMessage?:string});
    expect(persisted.at(-1)).toMatchObject({stopReason:"error",errorMessage:reason});
    const end=ends.find((event)=>event.type==="prompt_end");
    expect(end?.type==="prompt_end"&&end.messages.at(-1)).toMatchObject({role:"assistant",stopReason:"error",errorMessage:reason});
  });

  it("persists a draw_mindmap receipt and the intact tool-call params",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const outline="## Main idea\n- point one\n  - detail\n- point two";
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("draw_mindmap",{title:"Chapter 3 structure",outline}),{stopReason:"toolUse"}),fauxAssistantMessage("here is the map")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("summarize the structure visually",{});
    const result=toolResult(batches,"draw_mindmap");
    expect(result?.isError).toBe(false);
    expect(JSON.parse(result!.text)).toEqual({status:"drawn",title:"Chapter 3 structure",nodes:4});
    // The receipt is lightweight: it never echoes the outline back to the model.
    expect(result!.text).not.toContain("point one");
    // The persisted tool-call entry keeps the original params (the derived view's data source).
    expect(mindmapToolCallArgs(batches)).toEqual({title:"Chapter 3 structure",outline});
  });

  it("returns a structured error for an over-depth draw_mindmap outline",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const outline="# A\n## B\n### C\n#### D\n##### E";
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("draw_mindmap",{title:"Too deep",outline}),{stopReason:"toolUse"}),fauxAssistantMessage("retrying smaller")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("draw it",{});
    const result=toolResult(batches,"draw_mindmap");
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain("4");
    expect(mindmapToolCallArgs(batches)).toEqual({title:"Too deep",outline});
  });

  it("returns a structured error for an over-count draw_mindmap outline",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const outline=Array.from({length:101},(_,index)=>`- point ${index+1}`).join("\n");
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("draw_mindmap",{title:"Too wide",outline}),{stopReason:"toolUse"}),fauxAssistantMessage("retrying smaller")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("draw it",{});
    const result=toolResult(batches,"draw_mindmap");
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain("100");
  });

  it("returns a structured error for an over-long draw_mindmap line",async()=>{
    const current=session();const batches:PiSessionEntry[][]=[];
    const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries[entries.length-1]?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"chapter"}),search:async()=>[],close:()=>{}};
    const outline=`- ${"x".repeat(201)}`;
    const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage(fauxToolCall("draw_mindmap",{title:"Too long",outline}),{stopReason:"toolUse"}),fauxAssistantMessage("retrying smaller")]);
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>faux.streamSimple});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("draw it",{});
    const result=toolResult(batches,"draw_mindmap");
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain("200");
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
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
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
  return toolResult(batches,"list_annotations");
}

function getToolResultText(batches:PiSessionEntry[][],tool:string):string|undefined{
  return toolResult(batches,tool)?.text;
}

function toolResult(batches:PiSessionEntry[][],tool:string):{isError:boolean;text:string}|undefined{
  for(const entry of batches.flat()){
    if(entry.type!=="message")continue;
    const message=entry.message as {role?:string;toolName?:string;isError?:boolean;content?:Array<{type?:string;text?:string}>};
    if(message.role==="toolResult"&&message.toolName===tool){
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

function mindmapToolCallArgs(batches:PiSessionEntry[][]):{title?:unknown;outline?:unknown}|undefined{
  for(const entry of batches.flat()){
    if(entry.type!=="message")continue;
    const message=entry.message as {role?:string;content?:Array<{type?:string;name?:string;arguments?:unknown}>};
    if(message.role!=="assistant")continue;
    const block=message.content?.find((item)=>item.type==="toolCall"&&item.name==="draw_mindmap");
    if(block)return block.arguments as {title?:unknown;outline?:unknown};
  }
}
