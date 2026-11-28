import { describe, expect, it } from "vitest";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { LiteraAgentRuntime, SYSTEM_PROMPT, type RuntimeConfig } from "./embedded-runtime";
import { GUIDED_PROMPT, guidedPrompt } from "./guide";
import type { BookContentPort } from "@/agent/book/book-content";
import type { SessionPort } from "@/agent/sessions/session-port";
import type { DecodedPiSession, PiSessionEntry } from "@/agent/sessions/pi-session";
import type { AgentEvent, SessionKind } from "@/types/agent";

const now="2026-08-14T00:00:00Z";
function session(kind?:SessionKind):DecodedPiSession{return{header:{type:"session",version:3,id:"session-1",timestamp:now,cwd:"",...(kind?{kind}:{})},entries:[],leafId:null};}
const toc=[
  {index:0,label:"One",ancestors:[],depth:0,hrefs:["one.xhtml"],chars:100,parts:2,blocks:4,partStarts:[0,2]},
  {index:1,label:"Two",ancestors:[],depth:0,hrefs:["two.xhtml"],chars:100,parts:1,blocks:2,partStarts:[0]},
];
const snippets:Record<number,string[]>={0:["a","b","c","d"],1:["e","f"]};

function setup(kind?:SessionKind,guidedStyle:string|null=null,responses:Array<string|ReturnType<typeof fauxAssistantMessage>>=["retelling","title","retelling two","title"],blocks:Record<number,string[]>=snippets){
  let current=session(kind);let diskEntries:PiSessionEntry[]=[];const located:Array<[number,string,unknown]>=[];const batches:PiSessionEntry[][]=[];const systemPrompts:Array<string|undefined>=[];const requests:string[]=[];const created:Array<SessionKind|undefined>=[];const events:AgentEvent[]=[];
  const sessions:SessionPort={create:async(_book,requested)=>{created.push(requested);diskEntries=[];current=session(requested);return {...current,entries:[...diskEntries]};},list:async()=>[],load:async()=>({...current,entries:[...diskEntries]}),setLeaf:async(_book,_session,leafId)=>{current={...current,entries:[...diskEntries],leafId};return {...current,entries:[...diskEntries]};},delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);diskEntries.push(...entries);const leaf=entries.at(-1)?.id??null;current={...current,entries:[...diskEntries],leafId:leaf};return leaf;}};
  const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:2}),toc:async()=>toc,readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:2,fromBlock:0,toBlock:1,totalBlocks:4,text:"chapter"}),guideBlocks:async(chapterIndex)=>(blocks[chapterIndex]??[]).map((snippet)=>({snippet,chars:10,heading:0,part:0})),locateGuideBlock:async(chapterIndex,selection,hints)=>{located.push([chapterIndex,selection,hints]);for(const [index,list] of Object.entries(blocks)){const block=list.indexOf(selection.trim());if(block>=0)return{chapterIndex:Number(index),block};}return null;},search:async()=>[],close:()=>{}};
  const faux=createFauxCore({tokensPerSecond:10_000});faux.setResponses(responses.map((response)=>typeof response==="string"?fauxAssistantMessage(response):response));const tools:string[][]=[];
  const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
  const runtime=new LiteraAgentRuntime({sessions,book,loadGuidedStyle:()=>guidedStyle,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{systemPrompts.push(getCurrentSystemPrompt(context.messages));const system=context.messages[0] as {role:string;toolsAdded?:Array<{name:string}>};tools.push(system.role==="system"?(system.toolsAdded??[]).map((tool)=>tool.name):[]);requests.push(JSON.stringify(context.messages));return faux.streamSimple(requestModel,context,options);})});
  runtime.subscribe((event)=>{events.push(event);});
  return {runtime,batches,systemPrompts,requests,created,events,located,tools};
}

function guideStepResults(batches:PiSessionEntry[][]){return batches.flat().flatMap((entry)=>{const message=entry.type==="message"?entry.message as {role?:string;toolName?:string;isError?:boolean;content?:Array<{type?:string;text?:string}>}:undefined;return message?.role==="toolResult"&&message.toolName==="guide_step"?[{isError:message.isError===true,text:message.content?.find((block)=>block.type==="text")?.text??"",guide:entry.guide}]:[];});}
const takeStep=(args:Record<string,unknown>={})=>fauxAssistantMessage(fauxToolCall("guide_step",args),{stopReason:"toolUse"});
const readingContexts=(batches:PiSessionEntry[][])=>batches.flat().flatMap((entry)=>entry.type==="custom_message"&&entry.customType==="readingContext"?[String(entry.content)]:[]);

describe("guide_step in the runtime",()=>{
  it("offers guide_step only in Guided sessions",async()=>{
    const plain=setup(undefined,null,["answer","title"]);
    await plain.runtime.openBook("book",new ArrayBuffer(1));
    await plain.runtime.prompt("question",{});
    expect(plain.tools[0]).toContain("list_guide_blocks");
    expect(plain.tools[0]).not.toContain("guide_step");
    const guided=setup(undefined,null,["answer","title"]);
    await guided.runtime.openBook("book",new ArrayBuffer(1));
    await guided.runtime.newSession(undefined,"guided");
    await guided.runtime.prompt("question",{});
    expect(guided.tools[0]).toContain("guide_step");
  });

  it("takes the asked step in the turn: inlines step text and records the step on the tool result",async()=>{
    const {runtime,batches,events}=setup(undefined,null,[takeStep({chapterIndex:0,toBlock:2}),"retold","title"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("带读第一章到第 3 段",{});
    const [taken]=guideStepResults(batches);
    expect(taken).toMatchObject({isError:false,guide:{from:{chapterIndex:0,block:0,snippet:"a",paragraph:1},to:{chapterIndex:0,block:2,snippet:"c",paragraph:3}}});
    expect(taken.text).toContain("do NOT call read_chapter");
    expect(taken.text).toContain("chapterIndex 0, blocks 0–1");
    expect(taken.text).toContain("chapterIndex 0, blocks 2–2");
    expect(taken.text).toContain("chapter");
    const user=batches.flat().find((entry)=>entry.type==="message"&&(entry.message as {role?:string}).role==="user");
    expect(user).not.toHaveProperty("guide");
    expect(events.find((event)=>event.type==="prompt_end")).not.toHaveProperty("guideStep");
    expect(events.find((event)=>event.type==="tool_end")).toMatchObject({guide:{from:{block:0},to:{block:2}}});
    expect(events.find((event)=>event.type==="prompt_end")).toMatchObject({messages:expect.arrayContaining([expect.objectContaining({role:"assistant",blocks:expect.arrayContaining([{type:"toolCall",toolCall:expect.objectContaining({tool:"guide_step",guide:expect.objectContaining({from:expect.objectContaining({chapterIndex:0})})})}])})])});
    expect(await runtime.nextGuideStep()).toMatchObject({from:{chapterIndex:0,block:3},to:{chapterIndex:0,block:3}});
  });

  it("takes consecutive steps when the model calls it more than once",async()=>{
    const {runtime,batches}=setup(undefined,null,[fauxAssistantMessage([fauxToolCall("guide_step",{toBlock:1}),fauxToolCall("guide_step",{})],{stopReason:"toolUse"}),"retold","title"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("读完第一章",{});
    expect(guideStepResults(batches).map((result)=>result.guide)).toEqual([
      expect.objectContaining({from:expect.objectContaining({chapterIndex:0,block:0}),part:{index:0,total:2}}),
      expect.objectContaining({from:expect.objectContaining({chapterIndex:0,block:2}),part:{index:1,total:2}}),
    ]);
    expect(await runtime.nextGuideStep()).toMatchObject({from:{chapterIndex:1,block:0},part:{index:0,total:1}});
  });

  it("lets the model find a chapter and its paragraphs, then take the step",async()=>{
    const {runtime,batches}=setup(undefined,null,[
      fauxAssistantMessage(fauxToolCall("get_toc",{}),{stopReason:"toolUse"}),
      fauxAssistantMessage(fauxToolCall("list_guide_blocks",{chapterIndex:1}),{stopReason:"toolUse"}),
      takeStep({chapterIndex:1,toBlock:1}),
      "Two 的前两段讲的是……","title",
    ]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("带读 Two 的前两段",{});
    expect(JSON.parse(batches.flat().flatMap((entry)=>{const message=entry.type==="message"?entry.message as {role?:string;toolName?:string;content?:Array<{type?:string;text?:string}>}:undefined;return message?.role==="toolResult"&&message.toolName==="list_guide_blocks"?[message.content?.[0]?.text??""]:[];})[0])).toMatchObject({chapterIndex:1,totalBlocks:2,blocks:[{block:0,snippet:"e"},{block:1,snippet:"f"}]});
    expect(guideStepResults(batches)[0].guide).toMatchObject({from:{chapterIndex:1,block:0},to:{chapterIndex:1,block:1}});
  });

  it("starts at the Guide cursor without a chapter",async()=>{
    const {runtime,batches}=setup(undefined,null,[takeStep(),"retelling","title",takeStep({toBlock:3}),"好。"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.prompt("读完这一章",{});
    expect(guideStepResults(batches).map((result)=>result.guide)).toEqual([expect.objectContaining({part:{index:0,total:2}}),expect.objectContaining({part:{index:1,total:2}})]);
  });

  it("returns an error the model can act on, and takes no step",async()=>{
    const {runtime,batches}=setup(undefined,null,[takeStep({chapterIndex:9}),"没有这一章。","title"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("带读第十章",{});
    expect(guideStepResults(batches)[0]).toMatchObject({isError:true,text:expect.stringContaining("No chapter with chapterIndex 9"),guide:undefined});
    expect(await runtime.nextGuideStep()).toMatchObject({from:{chapterIndex:0,block:0},part:{index:0,total:2}});
  });

  it("takes no step when the reply that took it fails or is cut off",async()=>{
    for(const ending of [fauxAssistantMessage("retold up to",{stopReason:"error",errorMessage:"401: invalid api key"}),fauxAssistantMessage("retold up to",{stopReason:"length"})]){
      const {runtime,batches}=setup(undefined,null,[takeStep(),ending,"title"]);
      await runtime.openBook("book",new ArrayBuffer(1));
      await runtime.newSession(undefined,"guided");
      await runtime.prompt("继续带读",{guideRequest:{}});
      expect(guideStepResults(batches)).toEqual([expect.objectContaining({isError:false,guide:undefined})]);
      expect(await runtime.nextGuideStep()).toMatchObject({from:{chapterIndex:0,block:0},part:{index:0,total:2}});
    }
  });
});

describe("Guided sessions in the runtime",()=>{
  it("finds a step's start for the Book pane: its first block with text to find, counted among those opening alike",async()=>{
    const {runtime}=setup(undefined,null,[],{0:["a","Same opening","c","Same opening"],1:["Chapter two"]});
    await runtime.openBook("book",new ArrayBuffer(1));
    // Steps recorded before steps were block ranges: parts of a chapter.
    expect(await runtime.guideStepAnchor({chapterIndex:0,part:0,totalParts:2})).toEqual({chapterIndex:0,href:"one.xhtml",snippet:"Same opening",target:{hrefs:["one.xhtml"],key:"Sameopening",occurrence:0}});
    expect(await runtime.guideStepAnchor({chapterIndex:0,part:1,totalParts:2})).toMatchObject({target:{key:"Sameopening",occurrence:1}});
    const from={chapterIndex:0,block:3,snippet:"Same opening"};
    expect(await runtime.guideStepAnchor({from,to:from})).toMatchObject({target:{occurrence:1}});
    expect(await runtime.guideStepAnchor({chapterIndex:5,part:0,totalParts:1})).toBeNull();
  });

  it("creates a Guided session and announces its kind",async()=>{
    const {runtime,created,events}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession("req","guided");
    expect(created).toEqual(["guided"]);
    expect(events.find((event)=>event.type==="session_created")).toMatchObject({kind:"guided"});
  });

  it("walks the guide cursor through the steps the model takes, starting from the given chapter",async()=>{
    const {runtime}=setup(undefined,null,[takeStep(),"retold","title","side answer"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    expect(await runtime.nextGuideStep()).toBeNull();// no Guided session open
    await runtime.newSession(undefined,"guided");
    expect(await runtime.nextGuideStep("two.xhtml")).toMatchObject({from:{chapterIndex:1,block:0}});
    expect(await runtime.nextGuideStep()).toEqual({from:{chapterIndex:0,chapterTitle:"One",block:0,snippet:"a",paragraph:1},to:{chapterIndex:0,chapterTitle:"One",block:1,snippet:"b",paragraph:2},part:{index:0,total:2}});
    await runtime.prompt("继续带读",{guideRequest:{}});
    expect(await runtime.nextGuideStep("two.xhtml")).toMatchObject({from:{chapterIndex:0,block:2},part:{index:1,total:2}});
    await runtime.prompt("side question",{});
    expect(await runtime.nextGuideStep()).toMatchObject({from:{chapterIndex:0,block:2},part:{index:1,total:2}});
    // guideStepAtHref can jump freely to any chapter even after the guide has started.
    expect(await runtime.guideStepAtHref("two.xhtml")).toMatchObject({from:{chapterIndex:1,block:0},part:{index:0,total:1}});
    expect(await runtime.guideStepAtHref("one.xhtml")).toMatchObject({from:{chapterIndex:0,block:0},part:{index:0,total:2}});
    expect(await runtime.guideStepAtHref("missing.xhtml")).toBeNull();
  });

  it("keeps the Guide cursor at the furthest step when the model goes back over a chapter",async()=>{
    const {runtime,batches}=setup(undefined,null,[takeStep({toChapterIndex:0}),"chapter one retold","title","The chapter in short.",takeStep({chapterIndex:0,toBlock:1}),"again","ok"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("读完第一章",{});
    await new Promise((resolve)=>setTimeout(resolve,20));
    await runtime.settled();
    await runtime.prompt("再带读一遍第一章开头",{});
    expect(guideStepResults(batches).map((result)=>result.guide)).toEqual([
      expect.objectContaining({from:expect.objectContaining({chapterIndex:0,block:0}),to:expect.objectContaining({chapterIndex:0,block:3})}),
      expect.objectContaining({from:expect.objectContaining({chapterIndex:0,block:0}),to:expect.objectContaining({chapterIndex:0,block:1})}),
    ]);
    expect(await runtime.nextGuideStep()).toMatchObject({from:{chapterIndex:1,block:0}});
  });

  it("sends every message with the reading state, and a picked step with its exact call",async()=>{
    const {runtime,batches,systemPrompts}=setup(undefined,null,["side answer","title",takeStep({chapterIndex:1}),"retold"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("who is the author?",{chapterHref:"two.xhtml",selection:"e"});
    expect(systemPrompts[0]).toBe(`${SYSTEM_PROMPT}\n\n${GUIDED_PROMPT}`);
    const [side]=readingContexts(batches);
    expect(side).toContain("Guided reading state: The guide has not started yet.");
    expect(side).toContain("Selected text: e");
    await runtime.prompt("带读：Two",{guideRequest:{step:{chapterIndex:1,part:0,totalParts:1}},chapterHref:"two.xhtml"});
    const picked=readingContexts(batches)[1];
    expect(picked).toContain('Take it with guide_step {"chapterIndex":1}');
    expect(picked).not.toContain("Reading");
    // The request is not a step; the model's call is.
    const user=batches.flat().filter((entry)=>entry.type==="message"&&(entry.message as {role?:string}).role==="user").at(-1);
    expect(user).toMatchObject({guideRequest:{step:{chapterIndex:1}}});
    expect(user).not.toHaveProperty("guide");
    expect(guideStepResults(batches)[0].guide).toMatchObject({from:{chapterIndex:1,block:0},part:{index:0,total:1}});
  });

  it("leaves Continue's end to the model",async()=>{
    const {runtime,batches}=setup(undefined,null,[takeStep(),"retold","title",takeStep({toChapterIndex:1}),"retold"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.prompt("继续带读",{guideRequest:{}});
    const continued=readingContexts(batches)[1];
    expect(continued).toContain("The guide has reached chapterIndex 0 (\"One\"), block 1 of 0 to 3 (the furthest it has been).");
    expect(continued).toContain("The default next step: chapterIndex 0 (\"One\"), part 1 of 0 to 1 (blocks 2 to 3).");
    expect(continued).toContain("The reader pressed Continue");
    expect(guideStepResults(batches)[1].guide).toMatchObject({from:{chapterIndex:0,block:2},to:{chapterIndex:1,block:1}});
  });

  it("takes a range step across chapters, inlines up to the cap and lists remaining reads",async()=>{
    const {runtime,batches}=setup(undefined,null,[takeStep({toChapterIndex:1,toBlock:0}),"retold","title"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("step",{});
    const [taken]=guideStepResults(batches);
    expect(taken.text).toContain("The first 2 part(s) are below; call read_chapter ONLY for the remaining part(s): chapterIndex 1, fromBlock 0, toBlock 0");
    expect(taken.guide).toMatchObject({from:{chapterIndex:0,block:0,snippet:"a"},to:{chapterIndex:1,block:0,snippet:"e"}});
    expect(await runtime.nextGuideStep()).toMatchObject({from:{chapterIndex:1,block:1},to:{chapterIndex:1,block:1}});
  });

  it("finds a recorded range's blocks again by their snippets when the blocks shifted",async()=>{
    const shifting={0:["a","b","c","d"],1:["e","f"]};
    const {runtime}=setup(undefined,null,[takeStep({toBlock:0}),"retold","title"],shifting);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    const sessionId=(await runtime.listSessions())?.[0]?.id??"session-1";
    await runtime.prompt("step",{});
    // A block now comes before "a": the step's end is block 1, not 0.
    shifting[0]=["new","a","b","c"];
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.switchSession(sessionId);
    expect(await runtime.nextGuideStep()).toMatchObject({from:{chapterIndex:0,block:2,snippet:"b"},to:{chapterIndex:0,block:3}});
  });

  it("lists the blocks after a step's start for the picker, and builds the picked step",async()=>{
    const {runtime}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    const step={from:{chapterIndex:0,block:2},to:{chapterIndex:0,block:3}};
    expect(await runtime.guideOutline(step)).toEqual({
      chapters:[
        {chapterIndex:0,chapterTitle:"One",firstBlock:2,paragraphsBefore:2,blocks:["c","d"].map((snippet)=>({snippet,chars:10,heading:0,part:0}))},
        {chapterIndex:1,chapterTitle:"Two",firstBlock:0,paragraphsBefore:0,blocks:["e","f"].map((snippet)=>({snippet,chars:10,heading:0,part:0}))},
      ],
      more:null,
    });
    expect(await runtime.guideStepTo(step,{chapterIndex:1,block:0})).toEqual({from:{chapterIndex:0,chapterTitle:"One",block:2,snippet:"c",paragraph:3},to:{chapterIndex:1,chapterTitle:"Two",block:0,snippet:"e",paragraph:1}});
    expect(await runtime.guideStepTo(step,{chapterIndex:0,block:1})).toBeNull();
  });

  it("builds the step up to a reader's selection, or says why it cannot",async()=>{
    const {runtime,located}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    const step={from:{chapterIndex:0,block:2},to:{chapterIndex:0,block:3}};
    expect(await runtime.guideStepToSelection(step,{text:"e",paragraph:"the e paragraph",chapterHref:"two.xhtml"})).toEqual({step:expect.objectContaining({from:expect.objectContaining({chapterIndex:0,block:2}),to:expect.objectContaining({chapterIndex:1,block:0})})});
    // The page's paragraph and where the step starts go along to break ties.
    expect(located[0]).toEqual([1,"e",{paragraph:"the e paragraph",after:{chapterIndex:0,block:2}}]);
    expect(await runtime.guideStepToSelection(step,{text:"b",chapterHref:"one.xhtml"})).toEqual({error:"before"});
    expect(await runtime.guideStepToSelection(step,{text:"zzz",chapterHref:"one.xhtml"})).toEqual({error:"notFound"});
    expect(located.at(-1)).toEqual([0,"zzz",{after:{chapterIndex:0,block:2}}]);
  });

  it("gives the Book pane its marks per file, by the blocks' opening text",async()=>{
    const {runtime}=setup(undefined,null,undefined,{0:["a a","b","c","d"],1:["e","f"]});
    await runtime.openBook("book",new ArrayBuffer(1));
    expect(await runtime.guidePageMarks([])).toEqual({});
    // An older Session's part steps (including legacy skim), then a block range.
    const steps=[{chapterIndex:0,part:0,totalParts:2},{chapterIndex:0,part:1,totalParts:2,skim:true as const},{from:{chapterIndex:1,block:0},to:{chapterIndex:1,block:0}}];
    expect(await runtime.guidePageMarks(steps)).toEqual({
      "one.xhtml":{read:["aa","b","c","d"],steps:{aa:0,b:0,c:1,d:1}},
      "two.xhtml":{read:["e"],cursor:"e",steps:{e:2}},
    });
  });

  it("puts the Guide cursor's divider on the last block with text when the step ends on a blank or an image",async()=>{
    const {runtime}=setup(undefined,null,undefined,{0:["a","b","c","d"],1:["e",""]});
    await runtime.openBook("book",new ArrayBuffer(1));
    expect((await runtime.guidePageMarks([{chapterIndex:1,part:0,totalParts:1}]))["two.xhtml"]).toMatchObject({cursor:"e"});
  });

  it("refuses guide requests outside a Guided session, the Book, or the cursor's reach",async()=>{
    const {runtime,batches,systemPrompts}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession();
    await expect(runtime.prompt("step",{guideRequest:{}})).rejects.toThrow();
    await runtime.newSession(undefined,"guided");
    await expect(runtime.prompt("step",{guideRequest:{step:{chapterIndex:5,part:0,totalParts:1}}})).rejects.toThrow();
    // Mid-chapter, away from the cursor: no guide_step call can take it.
    await expect(runtime.prompt("step",{guideRequest:{step:{chapterIndex:0,part:1,totalParts:2}}})).rejects.toThrow();
    expect(batches).toEqual([]);
    expect(systemPrompts).toEqual([]);
  });

  it("uses the reader's guided style inside the fixed mechanics",async()=>{
    const {runtime,systemPrompts}=setup(undefined,"Use a table for every part.");
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("question",{});
    expect(systemPrompts[0]).toBe(`${SYSTEM_PROMPT}\n\n${guidedPrompt("Use a table for every part.")}`);
    expect(systemPrompts[0]).toContain("Continue button");
    expect(systemPrompts[0]).not.toContain("Cover the part completely");
  });

  it("writes a recap once the guide finishes a chapter and keeps it in the next step's context",async()=>{
    const {runtime,batches,requests,events}=setup(undefined,null,[takeStep(),"part one retold","title",takeStep(),"part two retold","The chapter in short.",takeStep(),"chapter two retold"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("继续带读",{guideRequest:{}});
    await new Promise((resolve)=>setTimeout(resolve,20));// flush the fire-and-forget title task
    await runtime.settled();
    expect(batches.flat().some((entry)=>entry.customType==="guideRecap")).toBe(false);
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.settled();
    const recapRequest=requests.at(-1)!;
    expect(recapRequest).toContain("part one retold");
    expect(recapRequest).toContain("part two retold");
    const recap=batches.at(-1)![0];
    expect(recap).toMatchObject({type:"custom_message",customType:"guideRecap",display:false,details:{chapterIndex:0,chapterTitle:"One",text:"The chapter in short."}});
    expect(events.find((event)=>event.type==="guide_recap_added")).toBeTruthy();
    await runtime.prompt("继续带读",{guideRequest:{}});
    expect(requests.at(-1)).toContain("Chapter recap (chapterIndex 0");
  });

  it("writes one recap for the chapters one step finished",async()=>{
    const {runtime,batches,requests,events}=setup(undefined,null,[takeStep(),"one retold","title",takeStep({toChapterIndex:1}),"rest retold","Both chapters in short."]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("step one",{guideRequest:{}});
    await new Promise((resolve)=>setTimeout(resolve,20));
    await runtime.settled();
    await runtime.prompt("step two",{});
    await runtime.settled();
    const recapRequest=requests.at(-1)!;
    expect(recapRequest).toContain("one retold");
    expect(recapRequest).toContain("rest retold");
    expect(recapRequest).toContain("through chapterIndex 1");
    const recaps=batches.flat().filter((entry)=>entry.customType==="guideRecap");
    expect(recaps).toHaveLength(1);
    expect(recaps[0]).toMatchObject({display:false,details:{chapterIndex:0,chapterTitle:"One",throughChapterIndex:1,throughChapterTitle:"Two",text:"Both chapters in short."}});
    expect(recaps[0].content).toContain("Chapter recap (chapterIndex 0, \"One\" through chapterIndex 1, \"Two\")");
    expect(events.find((event)=>event.type==="guide_recap_added")).toBeTruthy();
  });

  it("writes no recap in an ordinary Session",async()=>{
    const {runtime,batches,requests}=setup(undefined,null,["answer","title"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{});
    await new Promise((resolve)=>setTimeout(resolve,20));
    await runtime.settled();
    expect(requests).toHaveLength(2);
    expect(batches.flat().some((entry)=>entry.customType==="guideRecap")).toBe(false);
  });

  it("keeps ordinary Sessions on the default prompt",async()=>{
    const {runtime,systemPrompts}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.prompt("question",{});
    expect(systemPrompts[0]).toBe(SYSTEM_PROMPT);
  });

  it("auto-clears prior chapter turns on non-adjacent chapter jumps and supports manual context reset",async()=>{
    const threeToc=[
      {index:0,label:"One",ancestors:[],depth:0,hrefs:["one.xhtml"],chars:100,parts:1,blocks:2,partStarts:[0]},
      {index:1,label:"Two",ancestors:[],depth:0,hrefs:["two.xhtml"],chars:100,parts:1,blocks:2,partStarts:[0]},
      {index:2,label:"Three",ancestors:[],depth:0,hrefs:["three.xhtml"],chars:100,parts:1,blocks:2,partStarts:[0]},
    ];
    let current=session("guided");
    const batches:PiSessionEntry[][]=[];const requests:string[]=[];const events:AgentEvent[]=[];
    const sessions:SessionPort={create:async(_book,requested)=>{current=session(requested);return current;},list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries.at(-1)?.id??null;}};
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:3}),toc:async()=>threeToc,readChapter:async(chapterIndex)=>({chapterIndex,chapterNumber:chapterIndex+1,part:0,totalParts:1,fromBlock:0,toBlock:1,totalBlocks:2,text:`text-${chapterIndex}`}),guideBlocks:async()=>[{snippet:"p1",chars:10,heading:0,part:0},{snippet:"p2",chars:10,heading:0,part:0}],locateGuideBlock:async()=>null,search:async()=>[],locateQuote:async()=>({status:"unverified",chapterIndex:0}),readImage:async()=>{throw new Error("no");},close:()=>{}};
    const faux=createFauxCore({tokensPerSecond:10_000});
    faux.setResponses([
      takeStep({chapterIndex:0}),"chapter-one-unique-phrase","title","recap-for-ch-one",
      takeStep({chapterIndex:2}),"chapter-three-retold","recap-for-ch-three",
      "after-reset-answer",
    ].map((response)=>typeof response==="string"?fauxAssistantMessage(response):response));
    const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off"};
    const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,options)=>{requests.push(JSON.stringify(context.messages));return faux.streamSimple(requestModel,context,options);})});
    runtime.subscribe((event)=>{events.push(event);});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("带读：One",{guideRequest:{step:{chapterIndex:0,part:0,totalParts:1}}});
    await new Promise((resolve)=>setTimeout(resolve,20));
    await runtime.settled();
    // Jump directly from chapter 0 to chapter 2 (non-adjacent): chapter 0 turns drop out while recap stays.
    await runtime.prompt("带读：Three",{guideRequest:{step:{chapterIndex:2,part:0,totalParts:1}}});
    await runtime.settled();
    const jumpRequest=requests.find((payload)=>payload.includes("带读：Three"))!;
    expect(jumpRequest).toContain("recap-for-ch-one");
    expect(jumpRequest).not.toContain("chapter-one-unique-phrase");
    expect(batches.flat().some((entry)=>entry.type==="guide_window_cut"&&entry.reason==="jump")).toBe(true);
    // Manual reset emits divider and clears short-term turns while preserving recaps.
    await runtime.resetGuideContext();
    expect(events.find((event)=>event.type==="guide_window_updated")).toMatchObject({
      messages:expect.arrayContaining([{role:"guide_cut",reason:"manual"}]),
    });
    expect(runtime.guideContextStats()).toMatchObject({recapCount:2,activeTokens:0});
    await runtime.prompt("question after reset",{});
    expect(requests.at(-1)).toContain("recap-for-ch-one");
    expect(requests.at(-1)).toContain("recap-for-ch-three");
    expect(requests.at(-1)).not.toContain("chapter-three-retold");
  });

  it("archives the active Guided session and starts a fresh canonical one on restart",async()=>{
    const {runtime,batches,created,events}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.restartGuidedSession("session-1");
    expect(batches.flat()).toContainEqual(expect.objectContaining({type:"session_info",archived:true}));
    expect(events.some((event)=>event.type==="session_archived")).toBe(true);
    expect(created).toEqual(["guided","guided"]);
  });

  it("restores an archived Guided session by archiving the active one, unarchiving the target, and switching to it",async()=>{
    const store=new Map<string,DecodedPiSession>([
      ["s-old",{header:{type:"session",version:3,id:"s-old",timestamp:now,cwd:"",kind:"guided"},entries:[{type:"session_info",id:"i1",parentId:null,timestamp:now,archived:true}],leafId:"i1"}],
      ["s-cur",{header:{type:"session",version:3,id:"s-cur",timestamp:now,cwd:"",kind:"guided"},entries:[],leafId:null}],
    ]);
    const events:AgentEvent[]=[];
    const sessions:SessionPort={
      create:async()=>store.get("s-cur")!,
      list:async()=>[
        {id:"s-cur",title:"当前",createdAt:now,updatedAt:now,kind:"guided"},
        {id:"s-old",title:"旧归档",createdAt:now,updatedAt:now,kind:"guided",archived:true},
      ],
      load:async(_book,id)=>({...store.get(id)!,entries:[...store.get(id)!.entries]}),
      setLeaf:async(_book,id,leafId)=>{const s=store.get(id)!;s.leafId=leafId;return {...s,entries:[...s.entries]};},
      delete:async()=>{},
      append:async(_book,id,_leaf,entries)=>{const s=store.get(id)!;s.entries.push(...entries);s.leafId=entries.at(-1)?.id??s.leafId;return s.leafId;},
    };
    const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:2}),toc:async()=>toc,readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:2,fromBlock:0,toBlock:1,totalBlocks:4,text:"chapter"}),guideBlocks:async()=>[],locateGuideBlock:async()=>null,search:async()=>[],close:()=>{}};
    const runtime=new LiteraAgentRuntime({sessions,book});
    runtime.subscribe((event)=>{events.push(event);});
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.switchSession("s-cur");

    // loadGuideSession reads an archived session without switching the active session.
    const snap=await runtime.loadGuideSession("book","s-old");
    expect(snap?.sessionId).toBe("s-old");

    await runtime.restoreGuidedSession("s-old");
    expect(store.get("s-cur")!.entries).toContainEqual(expect.objectContaining({type:"session_info",archived:true}));
    expect(store.get("s-old")!.entries).toContainEqual(expect.objectContaining({type:"session_info",archived:false}));
    expect(events).toContainEqual(expect.objectContaining({type:"session_archived",sessionId:"s-cur"}));
    expect(events).toContainEqual(expect.objectContaining({type:"session_unarchived",sessionId:"s-old"}));
    expect(events.at(-1)).toMatchObject({type:"session_switched",sessionId:"s-old"});
  });

  it("lets the model search earlier guided explanations and reader questions after a context reset",async()=>{
    const {runtime,batches}=setup(undefined,null,[
      takeStep(),"这段详述了土地财政的制度起源。","title",
      fauxAssistantMessage(fauxToolCall("search_guide_history",{queries:["土地财政"]}),{stopReason:"toolUse"}),
      "之前我们在第一章讨论过土地财政。",
    ]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("开始带读",{guideRequest:{}});
    await runtime.settled();
    await runtime.resetGuideContext();
    await runtime.prompt("前面哪段提过土地财政？",{});
    const historyResult=batches.flat().flatMap((entry)=>{
      const message=entry.type==="message"?entry.message as {role?:string;toolName?:string;content?:Array<{type?:string;text?:string}>}:undefined;
      return message?.role==="toolResult"&&message.toolName==="search_guide_history"?[message.content?.[0]?.text??""]:[];
    });
    expect(historyResult[0]).toContain("土地财政的制度起源");
  });

  it("branches chapter follow-ups off the guided spine, sees in-progress chapter steps + prior Q&As, excludes later chapters, and keeps edits off-spine",async()=>{
    const {runtime,batches,requests,events,tools}=setup(undefined,null,[
      takeStep({chapterIndex:0,toBlock:1}),"One part 1 explanation","title",
      "Answer to Q1 on One part 1",
      takeStep({toBlock:3}),"One part 2 explanation","Recap of chapter One",
      "Answer to Q2 seeing One part 1+2 and Q1",
      takeStep({chapterIndex:1}),"Two explanation","Recap of chapter Two",
      "Answer to Q3 anchored on One (no Two)",
      "Edited Q1 reply on One",
      "Regenerated Q1 reply on One",
      fauxAssistantMessage(fauxToolCall("search_guide_history",{queries:["Edited Q1"]}),{stopReason:"toolUse"}),
      "Found your earlier chapter One question.",
    ]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");

    // Step 1: Ch1 (1/2)
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.settled();
    const ch1Anchor=batches.flat().find((entry)=>entry.type==="message"&&(entry.message as {role?:string}).role==="user")!.id;

    // Q1 on Ch1 side-thread while Ch1 is half-read
    await runtime.promptSideThread(ch1Anchor,"Q1 about One part 1",{});
    expect(tools[tools.length-1]).not.toContain("guide_step");
    expect(tools[tools.length-1]).toContain("search_guide_history");

    // Step 2: Continue Ch1 (2/2) on spine — spine must NOT contain Q1
    const requestsBeforeStep2=requests.length;
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.settled();
    const step2Request=requests[requestsBeforeStep2];
    expect(step2Request).toContain("One part 1 explanation");
    expect(step2Request).not.toContain("Q1 about One part 1");

    // Q2 on Ch1 side-thread — must see BOTH One part 1+2 AND Q1/A1
    await runtime.promptSideThread(ch1Anchor,"Q2 about One part 2",{});
    const q2Request=requests.find((payload)=>payload.includes("Q2 about One part 2"))!;
    expect(q2Request).toContain("One part 1 explanation");
    expect(q2Request).toContain("One part 2 explanation");
    expect(q2Request).toContain("Q1 about One part 1");
    expect(q2Request).toContain("Answer to Q1 on One part 1");

    // Step 3: Continue into Ch2 on spine — spine stays pure
    const requestsBeforeCh2=requests.length;
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.settled();
    const ch2Request=requests[requestsBeforeCh2];
    expect(ch2Request).toContain("Recap of chapter One");
    expect(ch2Request).not.toContain("Q1 about One part 1");
    expect(ch2Request).not.toContain("Q2 about One part 2");

    // Q3 on Ch1 side-thread after Ch2 is read — must NOT see Ch2!
    await runtime.promptSideThread(ch1Anchor,"Q3 revisit One",{});
    const q3Request=requests.find((payload)=>payload.includes("Q3 revisit One"))!;
    expect(q3Request).toContain("One part 2 explanation");
    expect(q3Request).toContain("Q2 about One part 2");
    expect(q3Request).not.toContain("Two explanation");

    // Editing & regenerating Q1 inside Ch1's side-thread must leave Ch2 intact on the spine
    await runtime.promptSideThread(ch1Anchor,"Edited Q1 on One",{},undefined,undefined,0);
    await runtime.regenerateSideThread(ch1Anchor,0);
    const latestEnd=[...events].reverse().find((event)=>event.type==="prompt_end");
    expect(latestEnd && latestEnd.type==="prompt_end" ? latestEnd.messages?.some((m)=>m.role==="assistant"&&m.content.includes("Two explanation")) : false).toBe(true);
    expect(latestEnd && latestEnd.type==="prompt_end" ? latestEnd.sideThreads?.[ch1Anchor]?.messages : []).toEqual([
      expect.objectContaining({role:"user",content:"Edited Q1 on One"}),
      expect.objectContaining({role:"assistant",content:"Regenerated Q1 reply on One"}),
    ]);

    // Spine `search_guide_history` can still retrieve side-thread Q&As on demand
    await runtime.prompt("回顾之前的问题",{});
    const historyResults=batches.flat().flatMap((entry)=>{
      const message=entry.type==="message"?entry.message as {role?:string;toolName?:string;content?:Array<{type?:string;text?:string}>}:undefined;
      return message?.role==="toolResult"&&message.toolName==="search_guide_history"?[message.content?.[0]?.text??""]:[];
    });
    expect(historyResults[0]).toContain("Edited Q1 on One");
  });

  it("revises historical steps off-spine with pinned span, spoiler-free context, recap refresh, and preserves later chapters & side-threads",async()=>{
    const {runtime,batches,requests,events,tools}=setup(undefined,null,[
      takeStep({chapterIndex:0,toBlock:3}),"Ch1 original explanation","title","Recap of Ch1 v1",
      takeStep({chapterIndex:1}),"Ch2 original explanation","Recap of Ch2",
      "Answer to Q1 on Ch1",
      "Ch1 deeper revised explanation","Recap of Ch1 v2",
      "Answer to Q2 on Ch1 seeing revision",
    ]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");

    // Take Ch1 and Ch2 on spine
    await runtime.prompt("开始带读",{guideRequest:{}});
    await runtime.settled();
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.settled();

    const allEntries=batches.flat();
    const ch1UserAnchor=allEntries.find((entry)=>entry.type==="message"&&(entry.message as {role?:string}).role==="user")!.id;
    const ch1StepAnchor=allEntries.find((entry)=>entry.type==="message"&&(entry.message as {role?:string}).role==="assistant")!.id;

    // Ask Q1 on Ch1 side-thread
    await runtime.promptSideThread(ch1UserAnchor,"Q1 about Ch1",{});

    // Revise Ch1 off-spine with pace=deep and styleOverride while Guide cursor is on Ch2
    const reqBeforeRev=requests.length;
    await runtime.reviseGuidedStep(ch1StepAnchor,{pace:"deep",styleOverride:"多举例子"});
    await runtime.settled();

    // Revision agent must NOT have guide_step tool and must NOT see Ch2
    expect(tools[tools.length-1]).not.toContain("guide_step");
    const revReq=requests[reqBeforeRev];
    expect(revReq).toContain("多举例子");
    expect(revReq).toContain("deep");
    expect(revReq).not.toContain("Ch2 original explanation");

    // Spine still keeps Ch2 intact and side-thread is still attached
    const revEnd=[...events].reverse().find((event)=>event.type==="prompt_end");
    expect(revEnd && revEnd.type==="prompt_end").toBe(true);
    if(revEnd && revEnd.type==="prompt_end"){
      expect(revEnd.messages?.some((m)=>m.role==="assistant"&&m.content.includes("Ch2 original explanation"))).toBe(true);
      expect(revEnd.sideThreads?.[ch1UserAnchor]?.messages).toHaveLength(2);
      const revSnap=revEnd.stepRevisions?.[ch1StepAnchor];
      expect(revSnap?.revisions).toHaveLength(1);
      expect(revSnap?.revisions[0]).toMatchObject({
        pace:"deep",
        styleOverride:"多举例子",
        content:"Ch1 deeper revised explanation",
      });
    }

    // Background recap refresh ran with the revised Ch1 explanation
    expect(requests.some((r)=>r.includes("Ch1 deeper revised explanation")&&r.includes("<retelling>"))).toBe(true);

    // Subsequent Q2 on Ch1 side-thread sees the revised explanation
    await runtime.promptSideThread(ch1UserAnchor,"Q2 after revision",{});
    const q2Req=requests.find((r)=>r.includes("Q2 after revision"))!;
    expect(q2Req).toContain("Ch1 deeper revised explanation");
    expect(q2Req).not.toContain("Ch1 original explanation");

    // Switching back to original revision emits step_revision_selected
    const sessionId=events.find((e)=>e.type==="session_created")?.sessionId!;
    await runtime.selectStepRevision(sessionId,ch1StepAnchor,"__original__");
    const selected=[...events].reverse().find((e)=>e.type==="step_revision_selected");
    expect(selected && selected.type==="step_revision_selected" ? selected.stepRevisions?.[ch1StepAnchor]?.activeRevisionId : null).toBe("__original__");
  });

  it("supports tip-only undo, dismissing an incomplete tail attempt, and explicit chapter rollback",async()=>{
    const {runtime,batches,events}=setup(undefined,null,[
      takeStep({chapterIndex:0,toBlock:3}),"Ch1 explanation","title","Recap Ch1",
      takeStep({chapterIndex:1}),"Ch2 explanation","Recap Ch2",
      fauxAssistantMessage("Stopped before guide_step",{stopReason:"aborted"}),
    ]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    const sessionId=events.find((e)=>e.type==="session_created")?.sessionId!;

    await runtime.prompt("开始带读",{guideRequest:{}});
    await runtime.settled();
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.settled();

    // Uncommitted aborted tail attempt -> dismiss removes it cleanly leaving Ch2 intact
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.dismissIncompleteTailStep(sessionId);
    const afterDismiss=[...events].reverse().find((e)=>e.type==="branch_switched");
    expect(afterDismiss && afterDismiss.type==="branch_switched"
      ? afterDismiss.messages.filter((m)=>m.role==="assistant").map((m)=>m.content)
      : []).toEqual(["Ch1 explanation","Ch2 explanation"]);

    // Tip-only undo removes Ch2 leaving Ch1 intact
    await runtime.undoLatestGuidedStep(sessionId);
    const afterUndo=[...events].reverse().find((e)=>e.type==="branch_switched");
    expect(afterUndo && afterUndo.type==="branch_switched"
      ? afterUndo.messages.filter((m)=>m.role==="assistant").map((m)=>m.content)
      : []).toEqual(["Ch1 explanation"]);

    // Explicit rollback to Ch1 removes Ch1 cleanly (even at root)
    const ch1Anchor=batches.flat().find((entry)=>entry.type==="message"&&(entry.message as {role?:string}).role==="user")!.id;
    await runtime.rollbackToChapterRun(sessionId,ch1Anchor);
    const afterRollback=[...events].reverse().find((e)=>e.type==="branch_switched");
    expect(afterRollback && afterRollback.type==="branch_switched" ? afterRollback.messages : null).toEqual([]);
  });

  it("auto-supersedes a trailing aborted guided attempt when pressing Continue without polluting prior chapter, model context, or branch navigation",async()=>{
    const {runtime,requests,events}=setup(undefined,null,[
      takeStep({chapterIndex:0,toBlock:3}),"Ch1 explanation","title","Recap Ch1",
      takeStep({chapterIndex:1}),fauxAssistantMessage("Aborted partial Ch2",{stopReason:"aborted"}),
      takeStep({chapterIndex:1}),"Ch2 clean explanation","Recap Ch2",
    ]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");

    // Ch1 commits cleanly.
    await runtime.prompt("开始带读",{guideRequest:{}});
    await runtime.settled();

    // Ch2 aborts mid-way with partial output -> stays at tail for inspection/recovery.
    await runtime.prompt("继续带读",{guideRequest:{}});
    const afterAbort=[...events].reverse().find((e)=>e.type==="prompt_aborted");
    expect(afterAbort && afterAbort.type==="prompt_aborted"
      ? afterAbort.messages?.filter((m)=>m.role==="assistant").map((m)=>m.content)
      : []).toEqual(["Ch1 explanation","Aborted partial Ch2"]);

    // User presses Continue instead of Retry -> runtime auto-rewinds the aborted tail first.
    const reqBeforeContinue=requests.length;
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.settled();

    // Rewind event fired, Ch2 prompt never saw the aborted partial text, and spine + navigation stay clean.
    expect(events.some((e)=>e.type==="session_rewound")).toBe(true);
    expect(requests[reqBeforeContinue]).not.toContain("Aborted partial Ch2");
    const finalEnd=[...events].reverse().find((e)=>e.type==="prompt_end");
    expect(finalEnd && finalEnd.type==="prompt_end").toBe(true);
    if(finalEnd && finalEnd.type==="prompt_end"){
      expect(finalEnd.messages?.filter((m)=>m.role==="assistant").map((m)=>m.content)).toEqual([
        "Ch1 explanation",
        "Ch2 clean explanation",
      ]);
      expect(finalEnd.navigation).toEqual({});
    }
  });

  it("auto-cleans a zero-output aborted guided step (at root, after a committed chapter, and on retry) while preserving errors and partial output",async()=>{
    const {runtime,events}=setup(undefined,null,[
      // 1) Root zero-output abort -> cleans back to empty transcript.
      fauxAssistantMessage("",{stopReason:"aborted"}),
      // 2) Ch1 commits cleanly.
      takeStep({chapterIndex:0,toBlock:3}),"Ch1 explanation","title","Recap Ch1",
      // 3) Ch2 zero-output abort (even after guide_step ran, no text/thinking emitted) -> auto-cleans back to Ch1.
      takeStep({chapterIndex:1}),fauxAssistantMessage("",{stopReason:"aborted"}),
      // 4) Ch2 error with empty output -> MUST remain visible so the user sees the failure reason.
      fauxAssistantMessage("",{stopReason:"error",errorMessage:"401: invalid api key"}),
      // 5) Retry that error, then abort with zero output -> auto-cleans back to Ch1.
      fauxAssistantMessage("",{stopReason:"aborted"}),
    ]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");

    // 1) Root zero-output abort
    await runtime.prompt("开始带读",{guideRequest:{}});
    let abortedEvent=[...events].reverse().find((e)=>e.type==="prompt_aborted");
    expect(abortedEvent && abortedEvent.type==="prompt_aborted" ? abortedEvent.messages : null).toEqual([]);

    // 2) Ch1 commits
    await runtime.prompt("开始带读",{guideRequest:{}});
    await runtime.settled();

    // 3) Ch2 zero-output abort auto-cleans back to Ch1
    await runtime.prompt("继续带读",{guideRequest:{}});
    abortedEvent=[...events].reverse().find((e)=>e.type==="prompt_aborted");
    expect(abortedEvent && abortedEvent.type==="prompt_aborted"
      ? abortedEvent.messages?.filter((m)=>m.role==="assistant").map((m)=>m.content)
      : []).toEqual(["Ch1 explanation"]);

    // 4) Empty error stays at tail so the user sees the error banner
    await runtime.prompt("继续带读",{guideRequest:{}});
    const erroredEnd=[...events].reverse().find((e)=>e.type==="prompt_end");
    expect(erroredEnd && erroredEnd.type==="prompt_end"
      ? erroredEnd.messages?.filter((m)=>m.role==="assistant").map((m)=>m.stopReason)
      : []).toEqual([undefined,"error"]);

    // 5) Retrying that failed attempt and aborting with zero output cleans back to Ch1
    await runtime.regenerate(2);
    abortedEvent=[...events].reverse().find((e)=>e.type==="prompt_aborted");
    expect(abortedEvent && abortedEvent.type==="prompt_aborted"
      ? abortedEvent.messages?.filter((m)=>m.role==="assistant").map((m)=>m.content)
      : []).toEqual(["Ch1 explanation"]);
  });
});
