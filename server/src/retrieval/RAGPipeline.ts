/**
 * RAG Pipeline for Lane B
 * Builds compact facts pack instructions for injection.
 */

import { v4 as uuidv4 } from "uuid";
import { eventBus } from "../orchestrator/EventBus.js";
import {
  RAGQueryPayload,
  RAGResultPayload,
  ToolCallPayload,
  ToolResultPayload,
} from "../schemas/events.js";
import { PIIRedactor } from "../insurance/policy_gate.js";
import { RetrievalService, FactsPack } from "./RetrievalService.js";

export interface RAGPipelineOptions {
  topK?: number;
  piiRedactor?: PIIRedactor | null;
  redactToolCalls?: boolean;
}

export interface RAGResponseContext {
  instructions: string | null;
  factsPack: FactsPack | null;
}

export class RAGPipeline {
  private static readonly RETRIEVAL_TOOL_NAME = "retrieve_nxtg_facts";
  private piiRedactor: PIIRedactor | null;
  private redactToolCalls: boolean;

  constructor(
    private sessionId: string,
    private retrievalService: RetrievalService,
    private options: RAGPipelineOptions = {},
  ) {
    this.piiRedactor = options.piiRedactor ?? null;
    this.redactToolCalls = options.redactToolCalls ?? false;
  }

  buildResponseContext(query: string): RAGResponseContext {
    const cleanedQuery = query.trim();
    if (!cleanedQuery) {
      return { instructions: null, factsPack: null };
    }

    const toolQuery =
      this.redactToolCalls && this.piiRedactor
        ? this.piiRedactor.redactText(cleanedQuery).redactedText
        : cleanedQuery;

    const topK = this.options.topK ?? this.retrievalService.getDefaults().topK;

    const queryEvent: RAGQueryPayload = { query: toolQuery, top_k: topK };
    eventBus.emit({
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "laneB",
      type: "rag.query",
      payload: queryEvent,
    });

    const callId = uuidv4();
    const toolCallPayload: ToolCallPayload = {
      tool_name: RAGPipeline.RETRIEVAL_TOOL_NAME,
      args: { query: toolQuery, top_k: topK },
      call_id: callId,
    };
    eventBus.emit({
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "laneB",
      type: "tool.call",
      payload: toolCallPayload,
    });

    const factsPack = this.retrievalService.retrieveFactsPack(toolQuery, {
      topK,
    });

    const citations = factsPack.facts.map((fact) => ({
      id: fact.id,
      source: fact.source,
      timestamp: fact.timestamp,
      text: fact.text,
    }));

    const toolResultPayload: ToolResultPayload = {
      call_id: callId,
      result: {
        facts_pack: factsPack,
        citations,
      },
    };
    eventBus.emit({
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "retriever",
      type: "tool.result",
      payload: toolResultPayload,
    });

    const resultEvent: RAGResultPayload = {
      topic: factsPack.topic,
      facts: factsPack.facts,
      disclaimers: factsPack.disclaimers,
      citations,
    };
    eventBus.emit({
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "retriever",
      type: "rag.result",
      payload: resultEvent,
    });

    return {
      instructions: this.formatInstructions(factsPack),
      factsPack,
    };
  }

  private formatInstructions(factsPack: FactsPack): string {
    const factsJson = JSON.stringify(factsPack);
    return (
      "For questions about NextGen AI, use ONLY the facts in FACTS_PACK. " +
      "Do not use outside knowledge or speculation. " +
      "When stating a fact, include its fact ID in brackets like [NXTG-001]. " +
      "If the facts are insufficient, ask a brief clarifying question instead of guessing.\nFACTS_PACK=" +
      factsJson
    );
  }
}
