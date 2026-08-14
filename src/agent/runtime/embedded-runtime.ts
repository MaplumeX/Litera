import { invoke } from "@tauri-apps/api/core";
import { Agent, type AgentEvent as PiEvent, type AgentMessage as PiMessage, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import { isContextOverflow, type AssistantMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { BookWorkerClient, chapterAside, formatBookSnapshot, type BookContentPort } from "@/agent/book/book-content";
import { DEFAULT_COMPACTION_SETTINGS, estimateContextTokens, findLastValidUsage, generateSummary, prepareCompaction, shouldCompact } from "@/agent/compaction/compaction";
import { createGuardedNativeFetch } from "@/agent/transport/native-fetch";
import { resolveRuntimeModel } from "@/agent/runtime/model-resolution";
import { activeBranch, convertPiContextToLlm, newEntry, piContextMessages, visibleMessages, type DecodedPiSession, type PiSessionEntry } from "@/agent/sessions/pi-session";
import { tauriSessionPort, type SessionPort } from "@/agent/sessions/session-port";
import type { AgentEvent, AgentMessage as UiMessage } from "@/types/agent";

export interface RuntimeConfig { provider:string; model:string; api:string; baseUrl:string; apiKey:string }
type Listener = (event: AgentEvent) => void;
type RuntimeEventPayload = AgentEvent extends infer Event
  ? Event extends { version: number }
    ? Omit<Event, "version">
    : never
  : never;
const SYSTEM_PROMPT = "You are Litera, an EPUB reading assistant. Use the book tools when evidence is needed. Answer in the user's language.";

async function streamFor(api: string): Promise<StreamFn> {
  if (api === "anthropic-messages") return (await import("@earendil-works/pi-ai/api/anthropic-messages")).streamSimple as unknown as StreamFn;
  if (api === "google-generative-ai") return (await import("@earendil-works/pi-ai/api/google-generative-ai")).streamSimple as unknown as StreamFn;
  if (api === "openai-responses") return (await import("@earendil-works/pi-ai/api/openai-responses")).streamSimple as unknown as StreamFn;
  if (api === "mistral-conversations") return (await import("@earendil-works/pi-ai/api/mistral-conversations")).streamSimple as unknown as StreamFn;
  if (api !== "openai-completions") throw new Error("所选模型 API 暂不受支持");
  return (await import("@earendil-works/pi-ai/api/openai-completions")).streamSimple as StreamFn;
}
const result = (text:string,details:unknown={})=>({content:[{type:"text" as const,text}],details});

export class LiteraAgentRuntime {
  private readonly listeners=new Set<Listener>(); private readonly sessions:SessionPort; private book:BookContentPort;
  private readonly loadConfig:()=>Promise<RuntimeConfig>; private readonly loadStream:(api:string)=>Promise<StreamFn>;
  private bookId:string|null=null; private session:DecodedPiSession|null=null; private agent:Agent|null=null; private promptId:string|null=null; private revision=0; private bookGeneration=0; private configRevision=0;
  constructor(options?:{sessions?:SessionPort;book?:BookContentPort;loadConfig?:()=>Promise<RuntimeConfig>;loadStream?:(api:string)=>Promise<StreamFn>}){this.sessions=options?.sessions??tauriSessionPort;this.book=options?.book??new BookWorkerClient();this.loadConfig=options?.loadConfig??(()=>invoke<RuntimeConfig>("get_agent_runtime_config"));this.loadStream=options?.loadStream??streamFor;}
  subscribe(listener:Listener){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  syncBook(bookId:string){if(this.bookId===bookId)this.emit({type:"book_ready",bookId});}
  private emit(payload:RuntimeEventPayload){const event={version:++this.revision,...payload} as AgentEvent; for(const listener of this.listeners)listener(event);}
  invalidateConfig(){this.configRevision+=1; this.agent?.abort(); this.agent=null;}
  async openBook(bookId:string,bytes:ArrayBuffer){this.agent?.abort();this.book.close();const generation=++this.bookGeneration;this.bookId=bookId;this.session=null;this.agent=null;this.emit({type:"book_loading",bookId});try{await this.book.open(bookId,bytes);if(this.bookGeneration===generation&&this.bookId===bookId)this.emit({type:"book_ready",bookId});}catch(error){if(this.bookGeneration===generation&&this.bookId===bookId)this.emit({type:"error",scope:"book",message:error instanceof Error?error.message:String(error),recoverable:true,bookId});}}
  closeBook(){const id=this.bookId;this.agent?.abort();this.book.close();this.bookGeneration+=1;this.bookId=null;this.session=null;this.agent=null;if(id)this.emit({type:"book_closed",bookId:id});}
  async listSessions(requestId?:string){if(!this.bookId)return;const bookId=this.bookId;const sessions=await this.sessions.list(bookId);if(this.bookId===bookId)this.emit({type:"sessions_list",bookId,requestId,sessions});}
  async newSession(requestId?:string){if(!this.bookId)return;const bookId=this.bookId;const session=await this.sessions.create(bookId);if(this.bookId!==bookId)return;this.session=session;this.agent=null;this.emit({type:"session_created",bookId,sessionId:session.header.id,requestId});}
  async switchSession(sessionId:string,requestId?:string){if(!this.bookId)return;const bookId=this.bookId;const session=await this.sessions.load(bookId,sessionId);if(this.bookId!==bookId)return;this.session=session;this.agent=null;this.emit({type:"session_switched",bookId,sessionId,requestId,messages:visibleMessages(session)});}
  async deleteSession(sessionId:string,requestId?:string){if(!this.bookId)return;const bookId=this.bookId;await this.sessions.delete(bookId,sessionId);if(this.bookId!==bookId)return;if(this.session?.header.id===sessionId){this.session=null;this.agent=null;}this.emit({type:"session_deleted",bookId,sessionId,requestId});}
  async renameSession(sessionId:string,title:string,requestId?:string){if(!this.bookId)return;const bookId=this.bookId;const clean=title.trim();if(!clean||clean.length>128)throw new Error("Invalid session title");const session=this.session?.header.id===sessionId?this.session:await this.sessions.load(bookId,sessionId);if(this.bookId!==bookId)return;const entry=newEntry("session_info",session.leafId,{name:clean});const leaf=await this.sessions.append(bookId,sessionId,session.leafId,[entry]);if(this.bookId!==bookId)return;session.entries.push(entry);session.leafId=leaf;this.emit({type:"session_renamed",bookId,sessionId,title:clean,requestId});}
  abort(_requestId?:string){this.agent?.abort();}

  async prompt(text:string,context:{selection?:string;chapterHref?:string},promptId:string=crypto.randomUUID(),requestId?:string,editIndex?:number){
    if(!this.bookId)throw new Error("No book is open"); if(this.promptId)throw new Error("A prompt is already active");
    if(!text||text.length>64*1024||(context.selection?.length??0)>64*1024||(context.chapterHref?.length??0)>4096)throw new Error("Invalid prompt context");
    const promptBookId=this.bookId;
    this.promptId=promptId;
    let session:DecodedPiSession|undefined;
    let unsubscribe:(()=>void)|undefined;
    try{
      if(!this.session){const created=await this.sessions.create(promptBookId);if(this.bookId!==promptBookId)throw new Error("Book context changed");this.session=created;this.agent=null;this.emit({type:"session_created",bookId:promptBookId,sessionId:created.header.id,requestId});} session=this.session!;
      const persistedLeaf=session.leafId;
      if(editIndex!==undefined){const branch=activeBranch(session);const visible=branch.filter((entry)=>entry.type==="message"&&(["user","assistant"] as unknown[]).includes((entry.message as {role?:unknown})?.role));const target=visible[editIndex];if(!target||((target.message as {role?:unknown}).role!=="user"))throw new Error("Edited message is not a visible user message");session.leafId=target.parentId;this.agent=null;this.emit({type:"session_rewound",bookId:promptBookId,sessionId:session.header.id,promptId,requestId,messages:visibleMessages({...session,leafId:session.leafId})});}
      const configAtStart=this.configRevision; const config=await this.loadConfig();if(this.bookId!==promptBookId)throw new Error("Book context changed");
      const metadata=await this.book.metadata(); const toc=await this.book.toc();
      const snapshot=formatBookSnapshot(metadata,toc);
      const readingContext=[chapterAside(toc,context.chapterHref),context.selection?`Selected text: ${context.selection}`:""].filter(Boolean).join("\n\n");
      const agent=await this.ensureAgent(config,session,promptBookId);
      if(configAtStart!==this.configRevision||this.bookId!==promptBookId)throw new Error("Agent context changed");
      this.agent=agent;
      await this.maybeCompact(agent,session,promptBookId);
      if(configAtStart!==this.configRevision||this.bookId!==promptBookId)throw new Error("Agent context changed");
      const before=agent.state.messages.length;
      const pendingEntries:PiSessionEntry[]=[];let pendingParent=session.leafId;
      const lastModel=[...activeBranch(session)].reverse().find((entry)=>entry.type==="model_change");
      if(lastModel?.provider!==config.provider||lastModel?.modelId!==config.model){const change=newEntry("model_change",pendingParent,{provider:config.provider,modelId:config.model});pendingEntries.push(change);pendingParent=change.id;}
      const promptMessages:PiMessage[]=[];
      const hasSnapshot=activeBranch(session).some((entry)=>entry.type==="custom_message"&&entry.customType==="bookSnapshot");
      if(!hasSnapshot){const snapshotEntry=newEntry("custom_message",pendingParent,{customType:"bookSnapshot",content:snapshot,display:false});pendingEntries.push(snapshotEntry);pendingParent=snapshotEntry.id;promptMessages.push({role:"custom",customType:"bookSnapshot",content:snapshot,display:false,timestamp:Date.now()} as PiMessage);}
      if(readingContext){const contextEntry=newEntry("custom_message",pendingParent,{customType:"readingContext",content:readingContext,display:false});pendingEntries.push(contextEntry);pendingParent=contextEntry.id;promptMessages.push({role:"custom",customType:"readingContext",content:readingContext,display:false,timestamp:Date.now()} as PiMessage);}
      const user:PiMessage={role:"user",content:text,timestamp:Date.now()}; const userEntry=newEntry("message",pendingParent,{message:user});
      pendingEntries.push(userEntry);
      const leaf=await this.sessions.append(promptBookId,session.header.id,persistedLeaf,pendingEntries);session.entries.push(...pendingEntries);session.leafId=leaf;
      if(configAtStart!==this.configRevision||this.bookId!==promptBookId)throw new Error("Agent context changed");
      this.emit({type:"prompt_started",bookId:promptBookId,sessionId:session.header.id,promptId,requestId});
      unsubscribe=agent.subscribe((event)=>this.onPiEvent(event,promptBookId,promptId,session!.header.id));
      await agent.prompt([...promptMessages,user]);
      const completed=agent.state.messages.slice(before+promptMessages.length+1);const entries:PiSessionEntry[]=[];let parent=session.leafId;for(const message of completed){const persisted=message.role==="assistant"&&message.stopReason==="error"?{...message,errorMessage:"模型请求失败"}:message;const entry=newEntry("message",parent,{message:persisted});entries.push(entry);parent=entry.id;}
      if(entries.length){session.leafId=await this.sessions.append(promptBookId,session.header.id,session.leafId,entries);session.entries.push(...entries);}
      await this.maybeCompact(agent,session,promptBookId);
      const aborted=completed.some((message)=>message.role==="assistant"&&message.stopReason==="aborted");this.emit(aborted?{type:"prompt_aborted",bookId:promptBookId,sessionId:session.header.id,promptId,requestId}:{type:"prompt_end",bookId:promptBookId,sessionId:session.header.id,promptId});
    }catch{const safeError=new Error("模型请求失败，请检查配置后重试");this.emit({type:"error",scope:"prompt",message:safeError.message,recoverable:true,bookId:promptBookId,sessionId:session?.header.id,promptId});throw safeError;}finally{unsubscribe?.();if(this.promptId===promptId)this.promptId=null;}
  }

  private async ensureAgent(config:RuntimeConfig,session:DecodedPiSession,bookId:string){if(this.agent)return this.agent;const resolvedModel=await resolveRuntimeModel(config);const nativeFetch=createGuardedNativeFetch({baseUrl:resolvedModel.baseUrl});const providerStream=await this.loadStream(resolvedModel.api);const stream:StreamFn=(requestModel,requestContext,options)=>providerStream(requestModel,requestContext,{...options,fetch:nativeFetch,maxRetries:0});const tools=await this.tools(bookId);return new Agent({initialState:{systemPrompt:SYSTEM_PROMPT,model:resolvedModel,thinkingLevel:"off",messages:piContextMessages(session),tools},streamFn:stream,convertToLlm:convertPiContextToLlm,getApiKey:()=>config.apiKey,transport:"sse"});}

  /**
   * Compact the session context when it approaches the model context window.
   *
   * Runs inside the prompt flow (promptId still held), so it cannot race a
   * concurrent prompt. Failures are swallowed: compaction must never block the
   * user's prompt result.
   */
  private async maybeCompact(agent:Agent,session:DecodedPiSession,bookId:string):Promise<boolean>{
    try{
      const settings=DEFAULT_COMPACTION_SETTINGS;
      const contextWindow=agent.state.model.contextWindow??0;
      if(contextWindow<=0)return false;
      const messages=agent.state.messages;
      const lastUsage=findLastValidUsage(messages);
      const branch=activeBranch(session);
      let latestCompactionTimestamp=0;
      for(let index=branch.length-1;index>=0;index-=1){if(branch[index].type==="compaction"){latestCompactionTimestamp=Date.parse(branch[index].timestamp)||0;break;}}
      // Debounce: a usage older than the latest compaction would falsely retrigger
      // compaction right after one just finished.
      if(lastUsage&&latestCompactionTimestamp>0&&lastUsage.timestamp<=latestCompactionTimestamp)return false;
      const lastAssistant=messages[messages.length-1] as unknown as AssistantMessage|undefined;
      const overflow=lastAssistant?.role==="assistant"&&isContextOverflow(lastAssistant,contextWindow);
      const contextTokens=lastUsage?lastUsage.usage.totalTokens||lastUsage.usage.input+lastUsage.usage.output+lastUsage.usage.cacheRead+lastUsage.usage.cacheWrite:estimateContextTokens(messages).tokens;
      if(!overflow&&!shouldCompact(contextTokens,contextWindow,settings))return false;
      const preparation=prepareCompaction(branch,settings);
      if(!preparation)return false;
      const apiKey=await agent.getApiKey?.(agent.state.model.provider);
      const summary=await generateSummary(preparation.messagesToSummarize,agent.state.model,settings.reserveTokens,apiKey??"",undefined,agent.streamFunction,preparation.previousSummary);
      const entry=newEntry("compaction",session.leafId,{summary,firstKeptEntryId:preparation.firstKeptEntryId,tokensBefore:preparation.tokensBefore});
      const leaf=await this.sessions.append(bookId,session.header.id,session.leafId,[entry]);
      session.entries.push(entry);session.leafId=leaf;
      agent.state.messages=piContextMessages(session);
      return true;
    }catch{return false;}
  }
  private async bookCall<T>(bookId:string,call:()=>Promise<T>):Promise<T>{if(this.bookId!==bookId)throw new Error("电子书上下文已切换");const value=await call();if(this.bookId!==bookId)throw new Error("电子书上下文已切换");return value;}
  private async tools(bookId:string):Promise<AgentTool[]>{const empty=Type.Object({});const read=Type.Object({chapterIndex:Type.Number(),part:Type.Optional(Type.Number())});const search=Type.Object({queries:Type.Array(Type.String())});return [
    {name:"get_book_metadata",label:"Book Metadata",description:"Get book metadata",parameters:empty,execute:async()=>result(JSON.stringify(await this.bookCall(bookId,()=>this.book.metadata())))},
    {name:"get_toc",label:"Table of Contents",description:"Get TOC with chapterIndex",parameters:empty,execute:async()=>result(JSON.stringify((await this.bookCall(bookId,()=>this.book.toc())).map((entry)=>({chapterIndex:entry.index,chapterNumber:entry.index+1,title:entry.label,chars:entry.chars}))))},
    {name:"read_chapter",label:"Read Chapter",description:"Read a chapter window",parameters:read,execute:async(_id,args)=>{const input=args as {chapterIndex:number;part?:number};return result(JSON.stringify(await this.bookCall(bookId,()=>this.book.readChapter(input.chapterIndex,input.part))));}},
    {name:"search_in_book",label:"Search Book",description:"Search multiple query variants",parameters:search,execute:async(_id,args)=>{const input=args as {queries:string[]};return result(JSON.stringify(await this.bookCall(bookId,()=>this.book.search(input.queries))));}},
  ];}
  private onPiEvent(event:PiEvent,bookId:string,promptId:string,sessionId:string){const base={bookId,sessionId,promptId};if(event.type==="message_update"&&event.assistantMessageEvent.type==="text_delta")this.emit({type:"text_delta",...base,delta:event.assistantMessageEvent.delta});else if(event.type==="tool_execution_start")this.emit({type:"tool_start",...base,toolCallId:event.toolCallId,tool:event.toolName,params:event.args});else if(event.type==="tool_execution_end")this.emit({type:"tool_end",...base,toolCallId:event.toolCallId,result:event.result,isError:event.isError});}
}

export const embeddedAgentRuntime=new LiteraAgentRuntime();
export const uiUserMessage=(text:string,context:{selection?:string;chapterHref?:string}):UiMessage=>({role:"user",content:text,selection:context.selection,chapterHref:context.chapterHref});
