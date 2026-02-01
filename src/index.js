import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { Client } from '@notionhq/client';

const app = new Hono();

// CORS 및 접속 허용
app.use('/*', cors());

// ---------------------------------------------------------
// 1. 도구 정의 (Notion Tool Definitions)
// ---------------------------------------------------------
const TOOLS = [
  {
    name: "search_notion",
    description: "Search for pages in Notion by title.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    }
  },
  {
    name: "read_page",
    description: "Read content of a Notion page.",
    inputSchema: {
      type: "object",
      properties: { page_id: { type: "string" } },
      required: ["page_id"]
    }
  },
  {
    name: "write_page",
    description: "Create a new page in Notion.",
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
// 2. MCP 프로토콜 엔드포인트 구현
// ---------------------------------------------------------

// [SSE 엔드포인트] 연결을 맺고 세션을 시작하는 곳
app.get('/sse', async (c) => {
  return streamSSE(c, async (stream) => {
    console.log("Agent Connected via SSE");

    // MCP 표준: 연결되자마자 'endpoint' 이벤트를 보내서 POST 주소를 알려줘야 함
    const url = new URL(c.req.url);
    const messageEndpoint = `${url.origin}/messages`;
    
    await stream.writeSSE({
      event: 'endpoint',
      data: messageEndpoint
    });

    // 연결 유지 (무한 루프)
    while (true) {
      await stream.sleep(10000); // 10초마다 대기 (연결 끊김 방지)
    }
  });
});

// [메시지 엔드포인트] 실제 명령(JSON-RPC)을 처리하는 곳
app.post('/messages', async (c) => {
  const notionKey = c.env.NOTION_KEY;
  if (!notionKey) return c.json({ error: "Missing NOTION_KEY" }, 500);
  
  const notion = new Client({ auth: notionKey });
  const body = await c.req.json();
  const { jsonrpc, method, params, id } = body;

  console.log(`Received Method: ${method}`);

  // 1. Initialize (악수 요청): 클라이언트가 "너 누구야? 통신하자"고 할 때
  if (method === 'initialize') {
    return c.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05", // MCP 최신 버전 명시
        capabilities: {
          tools: {} // "나 도구 기능 있어"라고 선언
        },
        serverInfo: {
          name: "notion-mcp-worker",
          version: "1.0.0"
        }
      }
    });
  }

  // 2. Initialized (악수 완료): 클라이언트가 "그래 확인했어"라고 보낼 때 (응답 불필요)
  if (method === 'notifications/initialized') {
    return c.json({ jsonrpc: "2.0", id: null });
  }

  // 3. Ping: 연결 살아있는지 확인할 때
  if (method === 'ping') {
    return c.json({ jsonrpc: "2.0", id, result: {} });
  }

  // 4. Tools List: "무슨 도구 있어?"라고 물어볼 때
  if (method === 'tools/list') {
    return c.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: TOOLS
      }
    });
  }

  // 5. Call Tool: 실제로 도구를 사용할 때
  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    let contentResult = "";

    try {
      if (name === 'search_notion') {
        const res = await notion.search({ query: args.query, page_size: 3 });
        contentResult = res.results.map(i => 
          `- ${i.properties?.Name?.title?.[0]?.plain_text || "제목없음"} (ID: ${i.id})`
        ).join('\n') || "검색 결과 없음";
      } 
      else if (name === 'read_page') {
        const blocks = await notion.blocks.children.list({ block_id: args.page_id, page_size: 50 });
        contentResult = blocks.results.map(b => b[b.type]?.rich_text?.map(t => t.plain_text).join("") || "").join("\n");
      }
      else if (name === 'write_page') {
        await notion.pages.create({
          parent: { database_id: args.database_id },
          properties: { title: { title: [{ text: { content: args.title } }] } },
          children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: args.content } }] } }]
        });
        contentResult = "페이지 생성 완료";
      }
      else {
        throw new Error("Unknown tool");
      }

      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: contentResult }]
        }
      });
    } catch (error) {
      return c.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: error.message }
      });
    }
  }

  return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

export default app;
