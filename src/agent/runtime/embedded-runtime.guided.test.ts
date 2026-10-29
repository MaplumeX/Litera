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
  let current=session(kind);const located:Array<[number,string,unknown]>=[];const batches:PiSessionEntry[][]=[];const systemPrompts:Array<string|undefined>=[];const requests:string[]=[];const created:Array<SessionKind|undefined>=[];const events:AgentEvent[]=[];
  const sessions:SessionPort={create:async(_book,requested)=>{created.push(requested);current=session(requested);return current;},list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);return entries.at(-1)?.id??null;}};
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

  it("takes the asked step in the turn: tells the model what to read and records the step on the tool result",async()=>{
    const {runtime,batches,events}=setup(undefined,null,[takeStep({chapterIndex:0,toBlock:2}),"retold","title"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("带读第一章到第 3 段",{});
    const [taken]=guideStepResults(batches);
    expect(taken).toMatchObject({isError:false,guide:{chapterIndex:0,range:{from:{chapterIndex:0,block:0,snippet:"a"},to:{chapterIndex:0,block:2,snippet:"c"}}}});
    expect(taken.text).toContain("chapterIndex 0, fromBlock 0, toBlock 1; chapterIndex 0, fromBlock 2, toBlock 2");
    const user=batches.flat().find((entry)=>entry.type==="message"&&(entry.message as {role?:string}).role==="user");
    expect(user).not.toHaveProperty("guide");
    expect(events.find((event)=>event.type==="prompt_end")).not.toHaveProperty("guideStep");
    expect(events.find((event)=>event.type==="tool_end")).toMatchObject({guide:{chapterIndex:0,range:{from:{block:0},to:{block:2}}}});
    expect(events.find((event)=>event.type==="prompt_end")).toMatchObject({messages:expect.arrayContaining([expect.objectContaining({role:"assistant",blocks:expect.arrayContaining([{type:"toolCall",toolCall:expect.objectContaining({tool:"guide_step",guide:expect.objectContaining({chapterIndex:0})})}])})])});
    expect(await runtime.nextGuideStep()).toMatchObject({chapterIndex:0,range:{from:{block:3},to:{block:3}}});
  });

  it("takes consecutive steps when the model calls it more than once",async()=>{
    const {runtime,batches}=setup(undefined,null,[fauxAssistantMessage([fauxToolCall("guide_step",{toBlock:1}),fauxToolCall("guide_step",{})],{stopReason:"toolUse"}),"retold","title"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("读完第一章",{});
    expect(guideStepResults(batches).map((result)=>result.guide)).toEqual([
      expect.objectContaining({chapterIndex:0,part:0}),
      expect.objectContaining({chapterIndex:0,part:1}),
    ]);
    expect(await runtime.nextGuideStep()).toMatchObject({chapterIndex:1,part:0});
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
    expect(guideStepResults(batches)[0].guide).toMatchObject({chapterIndex:1,part:0});
  });

  it("starts at the Guide cursor without a chapter",async()=>{
    const {runtime,batches}=setup(undefined,null,[takeStep(),"retelling","title",takeStep({toBlock:3}),"好。"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.prompt("读完这一章",{});
    expect(guideStepResults(batches).map((result)=>result.guide)).toEqual([expect.objectContaining({chapterIndex:0,part:0}),expect.objectContaining({chapterIndex:0,part:1})]);
  });

  it("returns an error the model can act on, and takes no step",async()=>{
    const {runtime,batches}=setup(undefined,null,[takeStep({chapterIndex:9}),"没有这一章。","title"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("带读第十章",{});
    expect(guideStepResults(batches)[0]).toMatchObject({isError:true,text:expect.stringContaining("No chapter with chapterIndex 9"),guide:undefined});
    expect(await runtime.nextGuideStep()).toMatchObject({chapterIndex:0,part:0});
  });
});

describe("Guided sessions in the runtime",()=>{
  it("finds a step's start for the Book pane: its first block with text to find, counted among those opening alike",async()=>{
    const {runtime}=setup(undefined,null,[],{0:["a","Same opening","c","Same opening"],1:["Chapter two"]});
    await runtime.openBook("book",new ArrayBuffer(1));
    expect(await runtime.guideStepAnchor({chapterIndex:0,part:0,totalParts:2})).toEqual({chapterIndex:0,href:"one.xhtml",snippet:"Same opening",target:{hrefs:["one.xhtml"],key:"Sameopening",occurrence:0}});
    expect(await runtime.guideStepAnchor({chapterIndex:0,part:1,totalParts:2})).toMatchObject({target:{key:"Sameopening",occurrence:1}});
    const from={chapterIndex:0,block:3,snippet:"Same opening"};
    expect(await runtime.guideStepAnchor({chapterIndex:0,part:1,totalParts:2,range:{from,to:from}})).toMatchObject({target:{occurrence:1}});
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
    expect(await runtime.nextGuideStep("two.xhtml")).toMatchObject({chapterIndex:1,part:0});
    expect(await runtime.nextGuideStep()).toEqual({chapterIndex:0,part:0,totalParts:2,chapterTitle:"One"});
    await runtime.prompt("继续带读",{guideRequest:{}});
    expect(await runtime.nextGuideStep("two.xhtml")).toMatchObject({chapterIndex:0,part:1});
    await runtime.prompt("side question",{});
    expect(await runtime.nextGuideStep()).toMatchObject({chapterIndex:0,part:1});
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
    expect(guideStepResults(batches)[0].guide).toMatchObject({chapterIndex:1,part:0});
  });

  it("leaves Continue's end to the model",async()=>{
    const {runtime,batches}=setup(undefined,null,[takeStep(),"retold","title",takeStep({toChapterIndex:1}),"retold"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("继续带读",{guideRequest:{}});
    await runtime.prompt("继续带读",{guideRequest:{}});
    const continued=readingContexts(batches)[1];
    expect(continued).toContain("The guide has reached chapterIndex 0 (\"One\"), block 1 of 0 to 3.");
    expect(continued).toContain("The default next step: chapterIndex 0 (\"One\"), part 1 of 0 to 1 (blocks 2 to 3).");
    expect(continued).toContain("The reader pressed Continue");
    expect(guideStepResults(batches)[1].guide).toMatchObject({chapterIndex:0,part:1,range:{to:{chapterIndex:1,block:1}}});
  });

  it("takes a range step across chapters and records the snippets of its ends",async()=>{
    const {runtime,batches}=setup(undefined,null,[takeStep({toChapterIndex:1,toBlock:0}),"retold","title"]);
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    await runtime.prompt("step",{});
    const [taken]=guideStepResults(batches);
    expect(taken.text).toContain("chapterIndex 0, fromBlock 0, toBlock 1; chapterIndex 0, fromBlock 2, toBlock 3; chapterIndex 1, fromBlock 0, toBlock 0");
    expect(taken.guide).toMatchObject({range:{from:{chapterIndex:0,block:0,snippet:"a"},to:{chapterIndex:1,block:0,snippet:"e"}}});
    expect(await runtime.nextGuideStep()).toMatchObject({chapterIndex:1,range:{from:{block:1},to:{block:1}}});
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
    expect(await runtime.nextGuideStep()).toMatchObject({chapterIndex:0,part:1});
  });

  it("skims a range step from where it starts to its chapter's end",async()=>{
    const {runtime}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    expect(await runtime.guideSkimStep({chapterIndex:0,part:0,totalParts:2,range:{from:{chapterIndex:0,block:1},to:{chapterIndex:0,block:1}}}))
      .toMatchObject({skim:true,range:{from:{block:1},to:{chapterIndex:0,block:3}}});
  });

  it("lists the blocks after a step's start for the picker, and builds the picked step",async()=>{
    const {runtime}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    const step={chapterIndex:0,part:1,totalParts:2};
    expect(await runtime.guideOutline(step)).toEqual({
      chapters:[
        {chapterIndex:0,chapterTitle:"One",firstBlock:2,paragraphsBefore:2,blocks:["c","d"].map((snippet)=>({snippet,chars:10,heading:0,part:0}))},
        {chapterIndex:1,chapterTitle:"Two",firstBlock:0,paragraphsBefore:0,blocks:["e","f"].map((snippet)=>({snippet,chars:10,heading:0,part:0}))},
      ],
      more:null,
    });
    expect(await runtime.guideStepTo(step,{chapterIndex:1,block:0},true)).toMatchObject({chapterIndex:0,part:1,skim:true,range:{from:{chapterIndex:0,block:2,snippet:"c",paragraph:3},to:{chapterIndex:1,block:0,snippet:"e",paragraph:1}}});
    expect(await runtime.guideStepTo(step,{chapterIndex:0,block:1})).toBeNull();
  });

  it("builds the step up to a reader's selection, or says why it cannot",async()=>{
    const {runtime,located}=setup();
    await runtime.openBook("book",new ArrayBuffer(1));
    await runtime.newSession(undefined,"guided");
    const step={chapterIndex:0,part:1,totalParts:2};
    expect(await runtime.guideStepToSelection(step,{text:"e",paragraph:"the e paragraph",chapterHref:"two.xhtml"})).toEqual({step:expect.objectContaining({chapterIndex:0,part:1,range:expect.objectContaining({to:expect.objectContaining({chapterIndex:1,block:0})})})});
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
    const steps=[{chapterIndex:0,part:0,totalParts:2},{chapterIndex:0,part:1,totalParts:2,skim:true as const},{chapterIndex:1,part:0,totalParts:1,range:{from:{chapterIndex:1,block:0},to:{chapterIndex:1,block:0}}}];
    expect(await runtime.guidePageMarks(steps)).toEqual({
      "one.xhtml":{read:["aa","b"],skimmed:["c","d"]},
      "two.xhtml":{read:["e"],skimmed:[],cursor:"e"},
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
    expect(recap).toMatchObject({type:"custom_message",customType:"guideRecap",details:{chapterIndex:0,chapterTitle:"One",text:"The chapter in short."}});
    expect(events.find((event)=>event.type==="guide_recap_added")).toMatchObject({messages:expect.arrayContaining([{role:"recap",chapterIndex:0,chapterTitle:"One",text:"The chapter in short."}])});
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
    expect(recaps[0]).toMatchObject({details:{chapterIndex:0,chapterTitle:"One",throughChapterIndex:1,throughChapterTitle:"Two",text:"Both chapters in short."}});
    expect(recaps[0].content).toContain("Chapter recap (chapterIndex 0, \"One\" through chapterIndex 1, \"Two\")");
    expect(events.find((event)=>event.type==="guide_recap_added")).toMatchObject({messages:expect.arrayContaining([expect.objectContaining({role:"recap",chapterIndex:0,throughChapterIndex:1})])});
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
});
