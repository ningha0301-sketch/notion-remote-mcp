import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { Client } from '@notionhq/client';

const app = new Hono();
app.use('/*', cors());

// ---------------------------------------------------------
// 1. 도구 정의 (Notion)
// ---------------------------------------------------------
const TOOLS = [
  {
    name: "search_notion",
    description: "Search Notion pages by title",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } }
    }
  },
  {
    name: "write_page",
    description: "Create a new page in Notion",
    inputSchema: {
      type: "object",
      properties: {
        database_id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" }
      },
      required: ["database_id", "title", "content"]
    }
  }
];

// ---------------------------------------------------------
// 2. MCP 서버 엔드포인트 (SSE + JSON-RPC)
// ---------------------------------------------------------

// [SSE] 연결 유지 및 엔드포인트 전송
app.get('/sse', async (c) => {
  return streamSSE(c, async (stream) => {
    console.log("✅ MCP Client Connected");
    
    // 절대 경로로 메시지 엔드포인트 알려주기
    const url = new URL(c.req.url);
    const endpointUrl = `${url.origin}/messages`;
    
    // 1. 엔드포인트 이벤트 전송
    await stream.writeSSE({
      event: 'endpoint',
      data: endpointUrl
    });

    // 2. 연결 끊김 방지 (Keep-Alive)
    while (true) {
      await stream.sleep(10000); // 10초 대기
      await stream.writeSSE({ event: 'ping', data: 'keepalive' });
    }
  });
});

// [Messages] 명령 처리
app.post('/messages', async (c) => {
  const notionKey = c.env.NOTION_KEY;
  if (!notionKey) {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "No NOTION_KEY" } });
  }

  const notion = new Client({ auth: notionKey });
  
  try {
    const body = await c.req.json();
    const { method, params, id } = body;
    
    console.log(`📩 Method: ${method}`);

    // [Initialize] 버전 및 기능 신고
    if (method === 'initialize') {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "notion-mcp", version: "1.0.0" }
        }
      });
    }

    // [Initialized] 확인 (응답 없음)
    if (method === 'notifications/initialized') {
      return c.json({ jsonrpc: "2.0", id: null });
    }

    // [List Tools] 도구 목록 제공
    if (method === 'tools/list') {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS }
      });
    }

    // [Call Tool] 실제 기능 실행
    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      let resultText = "";

      if (name === 'search_notion') {
        const res = await notion.search({ query: args.query || "", page_size: 5 });
        resultText = res.results.map(i => `- ${i.properties?.Name?.title?.[0]?.plain_text || "No Title"} (${i.id})`).join("\n");
      } 
      else if (name === 'write_page') {
        await notion.pages.create({
          parent: { database_id: args.database_id },
          properties: { title: { title: [{ text: { content: args.title } }] } },
          children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: args.content } }] } }]
        });
        resultText = "Successfully created page.";
      }

      return c.json({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: resultText }] }
      });
    }

    return c.json({ jsonrpc: "2.0", id, result: {} });

  } catch (err) {
    console.error(err);
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: err.message } });
  }
});

export default app;
