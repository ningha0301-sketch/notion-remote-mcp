import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { Client } from '@notionhq/client';

const app = new Hono();
app.use('/*', cors());

// ==========================================
// 🛠️ 도구 정의 (FastMCP처럼 여기만 고치세요)
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
    // 실제 실행될 함수
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
  },
  // 필요한 도구 계속 추가 가능...
];


// ==========================================
// ⚙️ MCP 서버 코어 (건드리지 마세요)
// ==========================================

// 1. SSE 연결 (심장박동)
app.get('/sse', async (c) => {
  return streamSSE(c, async (stream) => {
    console.log("🔗 Agent Connected");
    
    // 연결되자마자 POST 주소 알려주기 (MCP 필수 규약)
    const url = new URL(c.req.url);
    await stream.writeSSE({
      event: 'endpoint',
      data: `${url.origin}/messages`
    });

    // 연결 끊기지 않게 주기적으로 신호 보냄
    while (true) {
      await stream.sleep(10000); 
      await stream.writeSSE({ event: 'ping', data: '' });
    }
  });
});

// 2. 메시지 처리 (뇌)
app.post('/messages', async (c) => {
  try {
    const body = await c.req.json();
    const { method, params, id } = body;

    // 초기화 요청 (악수)
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

    // 도구 목록 달라고 할 때
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

    // 도구 실행하라고 할 때
    if (method === 'tools/call') {
      const tool = toolDefinitions.find(t => t.name === params.name);
      if (!tool) throw new Error("도구를 찾을 수 없습니다.");

      // 도구 실행
      const resultText = await tool.execute(params.arguments, c.env);
      
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: resultText }]
        }
      });
    }

    // 기타 요청 (Ping 등)
    return c.json({ jsonrpc: "2.0", id, result: {} });

  } catch (error) {
    console.error(error);
    return c.json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: error.message }
    }, 500);
  }
});

export default app;
