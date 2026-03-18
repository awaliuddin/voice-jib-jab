import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface TicketPayload {
  title: string;
  summary: string;
  transcriptExcerpt: string;
  severity: number;
  sessionId: string;
  reasonCodes: string[];
  customerContext?: Record<string, string>;
}

export interface TicketResult {
  ticketId: string;
  url: string;
  provider: string;
}

export interface TicketingClient {
  connect(): Promise<void>;
  createTicket(ticket: TicketPayload): Promise<TicketResult>;
  close(): Promise<void>;
}

export interface GitHubIssuesMcpClientConfig {
  owner: string;
  repo: string;
  token: string;
  labels?: string[];
}

export class GitHubIssuesMcpClient implements TicketingClient {
  private client: Client | null = null;
  private connected = false;
  private config: GitHubIssuesMcpClientConfig;

  constructor(config: GitHubIssuesMcpClientConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const transport = new StdioClientTransport({
      command: "npx",
      args: ["-y", "@github/mcp-server"],
      env: {
        ...process.env,
        GITHUB_PERSONAL_ACCESS_TOKEN: this.config.token,
      },
    });

    this.client = new Client(
      { name: "voice-jib-jab-ticketing", version: "1.0.0" },
      { capabilities: {} },
    );

    await this.client.connect(transport);
    this.connected = true;
  }

  async createTicket(ticket: TicketPayload): Promise<TicketResult> {
    if (!this.connected || !this.client) {
      throw new Error("TicketingMcpClient is not connected. Call connect() first.");
    }

    const labels = this.config.labels ?? ["voice-escalation", "auto-generated"];

    const bodyLines = [
      `**Session ID:** ${ticket.sessionId}`,
      `**Severity:** ${ticket.severity}`,
      `**Reason Codes:** ${ticket.reasonCodes.join(", ") || "none"}`,
      "",
      "## Summary",
      ticket.summary,
      "",
      "## Transcript Excerpt",
      "```",
      ticket.transcriptExcerpt,
      "```",
    ];

    if (ticket.customerContext && Object.keys(ticket.customerContext).length > 0) {
      bodyLines.push("", "## Customer Context");
      for (const [key, value] of Object.entries(ticket.customerContext)) {
        bodyLines.push(`**${key}:** ${value}`);
      }
    }

    const body = bodyLines.join("\n");

    const result = await this.client.callTool({
      name: "create_issue",
      arguments: {
        owner: this.config.owner,
        repo: this.config.repo,
        title: ticket.title,
        body,
        labels,
      },
    });

    // Parse result content
    let parsed: Record<string, unknown> = {};
    try {
      const content = result.content as Array<{ type: string; text: string }>;
      if (content?.[0]?.text) {
        parsed = JSON.parse(content[0].text) as Record<string, unknown>;
      }
    } catch {
      throw new Error("Failed to parse GitHub MCP response");
    }

    return {
      ticketId: parsed.number != null ? String(parsed.number) : "unknown",
      url: typeof parsed.html_url === "string" ? parsed.html_url : "",
      provider: "github",
    };
  }

  async close(): Promise<void> {
    if (!this.connected || !this.client) return;
    await this.client.close();
    this.connected = false;
    this.client = null;
  }
}
