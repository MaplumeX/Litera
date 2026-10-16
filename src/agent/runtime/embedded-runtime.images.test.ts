import { describe, expect, it, vi } from "vitest";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { LiteraAgentRuntime, type RuntimeConfig } from "./embedded-runtime";
import type { BookContentPort } from "@/agent/book/book-content";
import type { SessionPort } from "@/agent/sessions/session-port";
import type { DecodedPiSession, PiSessionEntry } from "@/agent/sessions/pi-session";
import { imageRefText } from "@/agent/sessions/image-refs";
import type { AgentEvent } from "@/types/agent";

const now="2026-10-15T00:00:00Z";
const IMAGE={src:"OPS/images/fig 1.png",mimeType:"image/png",data:"aW1hZ2U=",width:640,height:480};

function harness(options:{imageInput?:boolean;readImage?:BookContentPort["readImage"]}={}){
  const current:DecodedPiSession={header:{type:"session",version:3,id:"session-1",timestamp:now,cwd:""},entries:[],leafId:null};
  const batches:PiSessionEntry[][]=[];const events:AgentEvent[]=[];
  const requests:Array<{tools:string[];messages:Array<{role:string;content:unknown}>}>=[];
  const sessions:SessionPort={create:async()=>current,list:async()=>[],load:async()=>current,delete:async()=>{},append:async(_book,_session,_leaf,entries)=>{batches.push(entries);current.entries.push(...entries);current.leafId=entries.at(-1)?.id??null;return current.leafId;}};
  const readImage=vi.fn(options.readImage??(async()=>IMAGE));
  const book:BookContentPort={open:async()=>{},metadata:async()=>({title:"T",author:"A",language:"en",totalChapters:1}),toc:async()=>[],readChapter:async()=>({chapterIndex:0,chapterNumber:1,part:0,totalParts:1,text:"![Figure 1](OPS/images/fig%201.png)"}),search:async()=>[],locateQuote:async()=>({status:"unverified",chapterIndex:0}),readImage,close:()=>{}};
  const faux=createFauxCore({tokensPerSecond:1_000_000});
  const config:RuntimeConfig={provider:"custom-test",model:"model",api:faux.api,baseUrl:"https://example.test/v1",apiKey:"secret",thinkingLevel:"off",...(options.imageInput?{imageInput:true}:{})};
  const runtime=new LiteraAgentRuntime({sessions,book,loadConfig:async()=>config,loadStream:async()=>((requestModel,context,streamOptions)=>{
    const system=context.messages[0] as unknown as {role:string;toolsAdded?:Array<{name:string}>};
    requests.push({tools:system.role==="system"?(system.toolsAdded??[]).map((tool)=>tool.name):[],messages:context.messages as unknown as Array<{role:string;content:unknown}>});
    return faux.streamSimple(requestModel,context,streamOptions);
  })});
  runtime.subscribe((event)=>{events.push(event);});
  const toolResults=()=>batches.flat().flatMap((entry)=>{const message=entry.message as {role?:string;toolName?:string;content?:unknown[]}|undefined;return message?.role==="toolResult"?[message]:[];});
  return {runtime,faux,readImage,requests,events,toolResults,start:()=>runtime.openBook("book",new ArrayBuffer(1))};
}

/** The toolResult a request carries for `toolName`, if any. */
function requestToolResult(messages:Array<{role:string;content:unknown}>,toolName:string){
  return messages.find((message)=>message.role==="toolResult"&&(message as unknown as {toolName:string}).toolName===toolName) as {content:Array<{type:string;text?:string;data?:string}>}|undefined;
}

describe("view_image",()=>{
  it("is not offered to a text-only model",async()=>{
    const h=harness();
    h.faux.setResponses([fauxAssistantMessage("answer")]);
    await h.start();
    await h.runtime.prompt("question",{});
    expect(h.requests[0].tools).toContain("read_chapter");
    expect(h.requests[0].tools).not.toContain("view_image");
  });

  it("shows the image to a vision model but keeps it out of the session and the UI",async()=>{
    const h=harness({imageInput:true});
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall("view_image",{src:"OPS/images/fig%201.png"}),{stopReason:"toolUse"}),fauxAssistantMessage("it is a chart")]);
    await h.start();
    await h.runtime.prompt("what does figure 1 show?",{});
    expect(h.requests[0].tools).toContain("view_image");
    expect(h.readImage).toHaveBeenCalledWith("OPS/images/fig%201.png");
    const sent=requestToolResult(h.requests[1].messages,"view_image");
    expect(sent?.content).toContainEqual({type:"image",data:IMAGE.data,mimeType:"image/png"});
    const [stored]=h.toolResults();
    expect(stored.content).toEqual([{type:"text",text:JSON.stringify({src:IMAGE.src,mimeType:"image/png",width:640,height:480})},{type:"text",text:imageRefText(IMAGE.src)}]);
    const end=h.events.find((event)=>event.type==="tool_end");
    expect(JSON.stringify(end)).not.toContain(IMAGE.data);
  });

  it("restores the image from the book when the context is rebuilt from the session",async()=>{
    const h=harness({imageInput:true});
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall("view_image",{src:IMAGE.src}),{stopReason:"toolUse"}),fauxAssistantMessage("a chart"),fauxAssistantMessage("title"),fauxAssistantMessage("still a chart")]);
    await h.start();
    await h.runtime.prompt("what does figure 1 show?",{});
    await new Promise((resolve)=>setTimeout(resolve,0));// let the fire-and-forget title request settle
    h.runtime.invalidateConfig();// the next prompt rebuilds the Agent from the persisted session
    await h.runtime.prompt("and again?",{});
    const sent=requestToolResult(h.requests.at(-1)!.messages,"view_image");
    expect(sent?.content).toContainEqual({type:"image",data:IMAGE.data,mimeType:"image/png"});
    expect(sent?.content.some((block)=>block.text===imageRefText(IMAGE.src))).toBe(false);
    // The decoded image is cached per open Book.
    expect(h.readImage).toHaveBeenCalledTimes(1);
  });

  it("returns a tool error for an image that is not in the book",async()=>{
    const h=harness({imageInput:true,readImage:async(src)=>{throw new Error(`No image at ${src} in this book`);}});
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall("view_image",{src:"nope.png"}),{stopReason:"toolUse"}),fauxAssistantMessage("could not see it")]);
    await h.start();
    await h.runtime.prompt("look",{});
    const [stored]=h.toolResults() as Array<{isError?:boolean;content?:Array<{text?:string}>}>;
    expect(stored.isError).toBe(true);
    expect(stored.content?.[0]?.text).toContain("No image at nope.png");
  });
});
