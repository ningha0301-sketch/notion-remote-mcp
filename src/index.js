import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { Client } from '@notionhq/client';

const app = new Hono();

// OpenAI 접속 허용
app.use('/*', cors());

/**
 * 🛠️ 도구 정의 (OpenAI에게 알려줄 메뉴판)
 */
const TOOLS = [
  {
    name: "search_notion",
    description: "노션에서 페이지를 검색합니다. 제목을 기반으로 찾습니다.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "검색할 키워드" }
      },
      required: ["query"]
    }
  },
  {
    name: "read_page_content",
    description: "특정 페이지의 본문 내용을 읽어옵니다. 요약이나 질문에 답할 때 필수입니다.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "읽을 페이지의 ID" }
      },
      required: ["page_id"]
    }
  },
  {
    name: "write_page",
    description: "노션 데이터베이스에 새로운 페이지를 생성합니다.",
    inputSchema: {
      type: "object",
      properties: {
        database_id: { type: "string", description: "저장할 데이터베이스 ID" },
        title: { type: "string", description: "제목" },
        content: { type: "string", description: "본문 내용" }
      },
      required: ["database_id", "title", "content"]
    }
  },
  {
    name: "append_content",
    description: "기존 페이지의 맨 아래에 내용을 추가합니다 (이어쓰기).",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "추가할 페이지의 ID" },
        content: { type: "string", description: "추가할 내용" }
      },
      required: ["page_id", "content"]
    }
  },
  {
    name: "add_comment",
    description: "페이지에 댓글을 남깁니다.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "댓글을 달 페이지 ID" },
        text: { type: "string", description: "댓글 내용" }
      },
      required: ["page_id", "text"]
    }
  },
  {
    name: "update_status",
    description: "페이지의 상태(Status) 속성을 변경합니다.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "변경할 페이지 ID" },
        property_name: { type: "string", description: "상태 속성 이름 (예: Status, 상태)" },
        status_name: { type: "string", description: "변경할 상태 값 (예: Done, 완료)" }
      },
      required: ["page_id", "property_name", "status_name"]
    }
  },
  {
    name: "archive_page",
    description: "페이지를 휴지통으로 이동합니다.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "삭제할 페이지 ID" }
      },
      required: ["page_id"]
    }
  }
];

// 📡 SSE 엔드포인트
app.get('/sse', async (c) => {
  return streamSSE(c, async (stream) => {
    console.log("OpenAI Connected");
    await stream.writeSSE({ event: 'endpoint', data: '/messages' });
    while (true) { await stream.sleep(10000); }
  });
});

// 📨 도구 실행 엔드포인트
app.post('/messages', async (c) => {
  const notionKey = c.env.NOTION_KEY;
  if (!notionKey) return c.json({ error: "Server Error: NOTION_KEY is missing." }, 500);

  const notion = new Client({ auth: notionKey });
  const body = await c.req.json();
  const { method, params, id } = body;

  if (method === 'tools/list') {
    return c.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    let resultText = "";

    try {
      if (name === 'search_notion') {
        const response = await notion.search({ query: args.query, page_size: 5 });
        resultText = response.results.map(i => 
          `- ${i.properties?.Name?.title?.[0]?.plain_text || i.properties?.title?.title?.[0]?.plain_text || "제목 없음"} (ID: ${i.id})`
        ).join('\n') || "검색 결과 없음";
      } 
      else if (name === 'read_page_content') {
        const blocks = await notion.blocks.children.list({ block_id: args.page_id, page_size: 100 });
        resultText = blocks.results.map(b => b[b.type]?.rich_text?.map(t => t.plain_text).join("") || "").join("\n");
        if (!resultText) resultText = "내용이 없거나 텍스트를 읽을 수 없습니다.";
      }
      else if (name === 'write_page') {
        await notion.pages.create({
          parent: { database_id: args.database_id },
          properties: { title: { title: [{ text: { content: args.title } }] } },
          children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: args.content } }] } }]
        });
        resultText = "성공적으로 저장했습니다.";
      }
      else if (name === 'append_content') {
        await notion.blocks.children.append({
          block_id: args.page_id,
          children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: args.content } }] } }]
        });
        resultText = "내용을 추가했습니다.";
      }
      else if (name === 'add_comment') {
        await notion.comments.create({ parent: { page_id: args.page_id }, rich_text: [{ text: { content: args.text } }] });
        resultText = "댓글을 달았습니다.";
      }
      else if (name === 'update_status') {
        const props = {}; props[args.property_name] = { status: { name: args.status_name } };
        await notion.pages.update({ page_id: args.page_id, properties: props });
        resultText = "상태를 변경했습니다.";
      }
      else if (name === 'archive_page') {
        await notion.pages.update({ page_id: args.page_id, archived: true });
        resultText = "페이지를 삭제했습니다.";
      }

      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: resultText }] } });
    } catch (e) {
      return c.json({ jsonrpc: "2.0", id, error: { code: -32000, message: `Notion Error: ${e.message}` } });
    }
  }
  return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

export default app;
