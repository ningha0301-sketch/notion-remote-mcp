import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { Client } from '@notionhq/client';

const app = new Hono();
app.use('/*', cors());

// ==========================================
// 🛠️ 도구 정의
// ==========================================
const toolDefinitions = [
  {
    name: "search_notion",
    description: "노션 페이지 제목으로 검색",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    execute: async (args, env) => {
      const notion = new Client({ auth: env.NOTION_KEY });
      const res = await notion.search({ query: args.query, page_size: 5 });
      return res.results.map(i => 
        `- ${i.properties?.Name?.title?.[0]?.plain_text || "제목없음"} (ID: ${i.id})`
      ).join('\n') || "검색 결과 없음";
    }
  },
  {
    name: "write_page",
    description: "노션에 새 페이지 작성",
    inputSchema: {
      type: "object",
      properties: {
        database_id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" }
      },
      required: ["database_id", "title", "content"]
    },
    execute: async (args, env) => {
      const notion = new Client({ auth: env.NOTION_KEY });
      await notion.pages.create({
        parent: { database_id: args.database_id },
        properties: { title: { title: [{ text: { content: args.title } }] } },
        children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: args.content } }] } }]
      });
      return "페이지 작성 완료";
    }
  }
];

// ==========================================
// ⚙️ MCP 서버 코어
// ==========================================

app.get('/sse', async (c) => {
  return streamSSE(c, async (stream) => {
    console.log("🔗 Agent Connected via SSE");
    const url = new URL(c.req.url);
    await stream.writeSSE({
      event: 'endpoint',
      data: `${url.origin}/messages`
    });
    while (true) {
      await stream.sleep(10000); 
      await stream.writeSSE({ event: 'ping', data: '' });
    }
  });
});

app.post('/messages', async (c) => {
  // [디버깅] 환경변수 체크
  if (!c.env.NOTION_KEY) {
    console.error("❌ Critical: NOTION_KEY is missing in Cloudflare Environment Variables.");
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Server Misconfiguration: NOTION_KEY missing" } }, 500);
  }

  try {
    const body = await c.req.json();
    const { method, id } = body;
    // [방어 로직] params가 없으면 빈 객체로 처리 (initialized 메시지 등에서 터지는 것 방지)
    const params = body.params || {};

    console.log(`📩 Received Method: ${method}`);

    // 1. Initialize
    if (method === 'initialize') {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "notion-worker", version: "1.0" }
        }
      });
    }

    // 2. Initialized (응답 없음)
    if (method === 'notifications/initialized') {
      return c.json({ jsonrpc: "2.0", id: null });
    }

    // 3. Tools List
    if (method === 'tools/list') {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: toolDefinitions.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
          }))
        }
      });
    }

    // 4. Call Tool
    if (method === 'tools/call') {
      const tool = toolDefinitions.find(t => t.name === params.name);
      if (!tool) throw new Error(`Unknown tool: ${params.name}`);

      console.log(`🔨 Executing tool: ${params.name}`);
      const resultText = await tool.execute(params.arguments || {}, c.env); // args가 없을 경우 대비
      
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: resultText }]
        }
      });
    }

    // 5. Ping & Others
    return c.json({ jsonrpc: "2.0", id, result: {} });

  } catch (error) {
    console.error(`❌ Error in /messages: ${error.message}`);
    // 에러 내용을 그대로 JSON으로 반환 (OpenAI 쪽에서 원인 확인 가능하게)
    return c.json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: error.message }
    }, 500);
  }
});

export default app;
