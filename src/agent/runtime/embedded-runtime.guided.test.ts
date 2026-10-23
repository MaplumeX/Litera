import { describe, expect, it } from "vitest";
import { createFauxCore, fauxAssistantMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { LiteraAgentRuntime, SYSTEM_PROMPT, type RuntimeConfig } from "./embedded-runtime";
import { GUIDED_PROMPT, guidedPrompt } from "./guide";
import type { BookContentPort } from "@/agent/book/book-content";
import type { SessionPort } from "@/agent/sessions/session-port";
import type { DecodedPiSession, PiSessionEntry } from "@/agent/sessions/pi-session";
import type { AgentEvent, SessionKind } from "@/types/agent";

const now="2026-08-14T00:00:00Z";
function session(kind?:SessionKind):DecodedPiSession{return{header:{type:"session",version:3,id:"session-1",timestamp:now,cwd:"",...(kind?{kind}:{})},entries:[],leafId:null};}
const toc=[
  {index:0,label:"One",ancestors:[],depth:0,hrefs:["one.xhtml"],chars:100,parts:2},
  {index:1,label:"Two",ancestors:[],depth:0,hrefs:["two.xhtml"],chars:100,parts:1},
];

function setup(kind?:SessionKind,guidedStyle:string|null=null){
  let current=session(kind);const batches:PiSessionEntry[][]=[];const systemPrompts:Array<string|undefined>=[];const created:Array<SessionKind|undefined>=[];const events:AgentEvent[]=[];
  const sessions:SessionPort={create:async(_book,requested)=>{created.push(requested);current=session(requested);return current;},list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries.at(-1)?.id??null;}};
  const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:2}),toc:async()=>toc,readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:2,text:"chapter"}),search:async()=>[],close:()=>{}};
  const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses([fauxAssistantMessage("retelling"),fauxAssistantMessage("title"),fauxAssistantMessage("retelling two"),fauxAssistantMessage("title")]);
  const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
  const runtime=new LiteraAgentRuntime({sessions,book,loadGuidedStyle:()=>guidedStyle,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{systemPrompts.push(getCurrentSystemPrompt(context.messages));return faux.streamSimple(requestModel,context,options);})});
  runtime.subscribe((event)=>{events.push(event);});
  return {runtime,batches,systemPrompts,created,events};
}

describe("Guided sessions in the runtime",()=>{
  it("creates a Guided session and announces its kind",async()=>{
    const {runtime,created,events}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession("req","guided");
    expect(created).toEqual(["guided"]);
    expect(events.find((event)=>event.type==="session_created")).toMatchObject({kind:"guided"});
  });

  it("walks the guide cursor through parts and chapters, starting from the given chapter",async()=>{
    const {runtime}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    expect(await runtime.nextGuideStep()).toBeNull();// no Guided session open
    await runtime.newSession(undefined,"guided");
    expect(await runtime.nextGuideStep("two.xhtml")).toMatchObject({chapterIndex:1,part:0});
    const first=await runtime.nextGuideStep();
    expect(first).toEqual({chapterIndex:0,part:0,totalParts:2,chapterTitle:"One"});
    await runtime.prompt("Guided reading: One (part 1/2)",{guide:first!});
    expect(await runtime.nextGuideStep("two.xhtml")).toMatchObject({chapterIndex:0,part:1});
    await runtime.prompt("side question",{});
    expect(await runtime.nextGuideStep()).toMatchObject({chapterIndex:0,part:1});
  });

  it("sends a guided step with the guided style, the step's own context and the guide on the entry",async()=>{
    const {runtime,batches,systemPrompts}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("Guided reading: One (part 2/2)",{guide:{chapterIndex:0,part:1,totalParts:7}});
    expect(systemPrompts[0]).toBe(`${SYSTEM_PROMPT}\n\n${GUIDED_PROMPT}`);
    const entries=batches[0];
    const context=entries.find((entry)=>entry.type==="custom_message"&&entry.customType==="readingContext");
    expect(context?.content).toContain("Call read_chapter with chapterIndex 0 and part 1");
    // The step is normalized against the open Book.
    expect(entries.at(-1)).toMatchObject({type:"message",guide:{chapterIndex:0,part:1,totalParts:2,chapterTitle:"One"}});
  });

  it("refuses guided steps outside a Guided session or the Book",async()=>{
    const {runtime,batches,systemPrompts}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession();
    await expect(runtime.prompt("step",{guide:{chapterIndex:0,part:0,totalParts:2}})).rejects.toThrow();
    await runtime.newSession(undefined,"guided");
    await expect(runtime.prompt("step",{guide:{chapterIndex:5,part:0,totalParts:1}})).rejects.toThrow();
    expect(batches).toEqual([]);
    expect(systemPrompts).toEqual([]);
  });

  it("uses the reader's guided style inside the fixed mechanics",async()=>{
    const {runtime,systemPrompts}=setup(undefined,"Use a table for every part.");
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("step",{guide:{chapterIndex:0,part:0,totalParts:2}});
    expect(systemPrompts[0]).toBe(`${SYSTEM_PROMPT}\n\n${guidedPrompt("Use a table for every part.")}`);
    expect(systemPrompts[0]).toContain("Continue button");
    expect(systemPrompts[0]).not.toContain("Cover the part completely");
  });

  it("keeps ordinary Sessions on the default prompt",async()=>{
    const {runtime,systemPrompts}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{});
    expect(systemPrompts[0]).toBe(SYSTEM_PROMPT);
  });
});
