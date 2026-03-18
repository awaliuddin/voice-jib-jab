const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockCallTool = jest.fn();
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockClientInstance = {
  connect: mockConnect,
  callTool: mockCallTool,
  close: mockClose,
};
const MockClient = jest.fn().mockImplementation(() => mockClientInstance);

const mockTransportInstance = {};
const MockStdioClientTransport = jest.fn().mockImplementation(() => mockTransportInstance);

jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}));
jest.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockStdioClientTransport,
}));

import {
  GitHubIssuesMcpClient,
  TicketPayload,
} from "../../services/TicketingMcpClient.js";

const TEST_CONFIG = {
  owner: "test-owner",
  repo: "test-repo",
  token: "ghp_test_token",
};

const VALID_TICKET: TicketPayload = {
  title: "Customer escalation: billing dispute",
  summary: "Customer is disputing a charge from last month.",
  transcriptExcerpt: "I was charged twice for the same order.",
  severity: 3,
  sessionId: "sess-abc-123",
  reasonCodes: ["BILLING", "DUPLICATE_CHARGE"],
};

const SUCCESS_RESPONSE = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        number: 42,
        html_url: "https://github.com/o/r/issues/42",
      }),
    },
  ],
};

function createConnectedClient(
  configOverrides?: Partial<typeof TEST_CONFIG & { labels?: string[] }>,
): GitHubIssuesMcpClient {
  const client = new GitHubIssuesMcpClient({ ...TEST_CONFIG, ...configOverrides });
  return client;
}

describe("GitHubIssuesMcpClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallTool.mockResolvedValue(SUCCESS_RESPONSE);
  });

  // ── connect() ──────────────────────────────────────────────

  describe("connect()", () => {
    it("creates Client with correct name and version", async () => {
      const client = createConnectedClient();
      await client.connect();

      expect(MockClient).toHaveBeenCalledWith(
        { name: "voice-jib-jab-ticketing", version: "1.0.0" },
        { capabilities: {} },
      );
    });

    it("creates StdioClientTransport with correct command and args", async () => {
      const client = createConnectedClient();
      await client.connect();

      expect(MockStdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "npx",
          args: ["-y", "@github/mcp-server"],
        }),
      );
    });

    it("passes GITHUB_PERSONAL_ACCESS_TOKEN from config.token to transport env", async () => {
      const client = createConnectedClient();
      await client.connect();

      const transportCall = MockStdioClientTransport.mock.calls[0][0];
      expect(transportCall.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_test_token");
    });

    it("calls client.connect() with the transport instance", async () => {
      const client = createConnectedClient();
      await client.connect();

      expect(mockConnect).toHaveBeenCalledWith(mockTransportInstance);
    });

    it("is idempotent — second call is a no-op", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.connect();

      expect(MockClient).toHaveBeenCalledTimes(1);
      expect(MockStdioClientTransport).toHaveBeenCalledTimes(1);
    });
  });

  // ── createTicket() ─────────────────────────────────────────

  describe("createTicket()", () => {
    it("throws when not connected", async () => {
      const client = createConnectedClient();

      await expect(client.createTicket(VALID_TICKET)).rejects.toThrow(
        "TicketingMcpClient is not connected. Call connect() first.",
      );
    });

    it("calls client.callTool with tool name 'create_issue'", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.createTicket(VALID_TICKET);

      expect(mockCallTool).toHaveBeenCalledWith(
        expect.objectContaining({ name: "create_issue" }),
      );
    });

    it("passes correct owner and repo from config", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.createTicket(VALID_TICKET);

      const callArgs = mockCallTool.mock.calls[0][0];
      expect(callArgs.arguments.owner).toBe("test-owner");
      expect(callArgs.arguments.repo).toBe("test-repo");
    });

    it("passes the ticket title", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.createTicket(VALID_TICKET);

      const callArgs = mockCallTool.mock.calls[0][0];
      expect(callArgs.arguments.title).toBe(VALID_TICKET.title);
    });

    it("body contains sessionId section", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.createTicket(VALID_TICKET);

      const callArgs = mockCallTool.mock.calls[0][0];
      expect(callArgs.arguments.body).toContain(`**Session ID:** ${VALID_TICKET.sessionId}`);
    });

    it("body contains severity value", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.createTicket(VALID_TICKET);

      const callArgs = mockCallTool.mock.calls[0][0];
      expect(callArgs.arguments.body).toContain(`**Severity:** ${VALID_TICKET.severity}`);
    });

    it("body contains reasonCodes", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.createTicket(VALID_TICKET);

      const callArgs = mockCallTool.mock.calls[0][0];
      expect(callArgs.arguments.body).toContain("BILLING, DUPLICATE_CHARGE");
    });

    it("body contains transcriptExcerpt inside code block", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.createTicket(VALID_TICKET);

      const callArgs = mockCallTool.mock.calls[0][0];
      const body: string = callArgs.arguments.body;
      expect(body).toContain("```\n" + VALID_TICKET.transcriptExcerpt + "\n```");
    });

    it("body contains customerContext section when provided", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.createTicket({
        ...VALID_TICKET,
        customerContext: { accountId: "ACC-999", tier: "enterprise" },
      });

      const callArgs = mockCallTool.mock.calls[0][0];
      const body: string = callArgs.arguments.body;
      expect(body).toContain("## Customer Context");
      expect(body).toContain("**accountId:** ACC-999");
      expect(body).toContain("**tier:** enterprise");
    });

    it("body does NOT contain customerContext section when not provided", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.createTicket(VALID_TICKET);

      const callArgs = mockCallTool.mock.calls[0][0];
      expect(callArgs.arguments.body).not.toContain("## Customer Context");
    });

    it("returns ticketId as string of issue number from response", async () => {
      const client = createConnectedClient();
      await client.connect();
      const result = await client.createTicket(VALID_TICKET);

      expect(result.ticketId).toBe("42");
    });

    it("returns url from html_url in response", async () => {
      const client = createConnectedClient();
      await client.connect();
      const result = await client.createTicket(VALID_TICKET);

      expect(result.url).toBe("https://github.com/o/r/issues/42");
    });

    it('returns provider "github"', async () => {
      const client = createConnectedClient();
      await client.connect();
      const result = await client.createTicket(VALID_TICKET);

      expect(result.provider).toBe("github");
    });

    it('applies default labels ["voice-escalation", "auto-generated"] when no custom labels', async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.createTicket(VALID_TICKET);

      const callArgs = mockCallTool.mock.calls[0][0];
      expect(callArgs.arguments.labels).toEqual(["voice-escalation", "auto-generated"]);
    });

    it("applies custom labels from config.labels", async () => {
      const client = createConnectedClient({ labels: ["urgent", "billing"] });
      await client.connect();
      await client.createTicket(VALID_TICKET);

      const callArgs = mockCallTool.mock.calls[0][0];
      expect(callArgs.arguments.labels).toEqual(["urgent", "billing"]);
    });
  });

  // ── Error paths ────────────────────────────────────────────

  describe("error paths", () => {
    it("propagates when callTool throws", async () => {
      mockCallTool.mockRejectedValueOnce(new Error("MCP transport error"));

      const client = createConnectedClient();
      await client.connect();

      await expect(client.createTicket(VALID_TICKET)).rejects.toThrow("MCP transport error");
    });

    it("throws on malformed/non-JSON response content", async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: "text", text: "not valid json{{{" }],
      });

      const client = createConnectedClient();
      await client.connect();

      await expect(client.createTicket(VALID_TICKET)).rejects.toThrow(
        "Failed to parse GitHub MCP response",
      );
    });

    it('returns "unknown" for ticketId when number missing from response', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({ html_url: "https://example.com" }) }],
      });

      const client = createConnectedClient();
      await client.connect();
      const result = await client.createTicket(VALID_TICKET);

      expect(result.ticketId).toBe("unknown");
    });

    it('returns "" for url when html_url missing from response', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({ number: 99 }) }],
      });

      const client = createConnectedClient();
      await client.connect();
      const result = await client.createTicket(VALID_TICKET);

      expect(result.url).toBe("");
    });
  });

  // ── close() ────────────────────────────────────────────────

  describe("close()", () => {
    it("calls client.close()", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.close();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it("resets connection state — subsequent createTicket() throws", async () => {
      const client = createConnectedClient();
      await client.connect();
      await client.close();

      await expect(client.createTicket(VALID_TICKET)).rejects.toThrow(
        "TicketingMcpClient is not connected. Call connect() first.",
      );
    });

    it("is safe to call when not connected (no error thrown)", async () => {
      const client = createConnectedClient();

      await expect(client.close()).resolves.toBeUndefined();
      expect(mockClose).not.toHaveBeenCalled();
    });
  });
});
