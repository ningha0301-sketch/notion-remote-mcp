import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Client } from '@notionhq/client';

const app = new Hono();
app.use('/*', cors());

// --- 1. OpenAI에게 건네줄 설명서 (Schema) ---
const OPENAPI_SCHEMA = {
  openapi: "3.1.0",
  info: { title: "Notion API", version: "1.0.0" },
  servers: [{ url: "https://notion-remote-mcp.fat9391.workers.dev" }], // 나중에 본인 주소로 자동 인식됨 (혹은 수동 입력)
  paths: {
    "/search": {
      post: {
        operationId: "search_notion",
        summary: "노션 페이지 검색",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { query: { type: "string" } } } } } },
        responses: { "200": { description: "OK" } }
      }
    },
    "/read": {
      post: {
        operationId: "read_page_content",
        summary: "페이지 본문 읽기",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { page_id: { type: "string" } } } } } },
        responses: { "200": { description: "OK" } }
      }
    },
    "/write": {
      post: {
        operationId: "write_page",
        summary: "새 페이지 작성",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { database_id: { type: "string" }, title: { type: "string" }, content: { type: "string" } } } } } },
        responses: { "200": { description: "OK" } }
      }
    },
    "/append": {
      post: {
        operationId: "append_content",
        summary: "페이지 이어쓰기",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { page_id: { type: "string" }, content: { type: "string" } } } } } },
        responses: { "200": { description: "OK" } }
      }
    },
    "/comment": {
      post: {
        operationId: "add_comment",
        summary: "댓글 달기",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { page_id: { type: "string" }, text: { type: "string" } } } } } },
        responses: { "200": { description: "OK" } }
      }
    },
    "/status": {
      post: {
        operationId: "update_status",
        summary: "상태 변경",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { page_id: { type: "string" }, property_name: { type: "string" }, status_name: { type: "string" } } } } } },
        responses: { "200": { description: "OK" } }
      }
    },
    "/archive": {
      post: {
        operationId: "archive_page",
        summary: "페이지 삭제(아카이브)",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { page_id: { type: "string" } } } } } },
        responses: { "200": { description: "OK" } }
      }
    }
  }
};

// --- 2. 설명서 제공 엔드포인트 ---
app.get('/openapi.json', (c) => {
  // 현재 배포된 URL을 자동으로 감지해서 스키마에 넣어줌
  const host = c.req.header('host');
  const schema = { ...OPENAPI_SCHEMA };
  schema.servers = [{ url: `https://${host}` }];
  return c.json(schema);
});

// --- 3. 실제 기능 구현 (REST API) ---
app.post('/search', async (c) => {
  const notion = new Client({ auth: c.env.NOTION_KEY });
  const { query } = await c.req.json();
  const res = await notion.search({ query, page_size: 5 });
  const text = res.results.map(i => `- ${i.properties?.Name?.title?.[0]?.plain_text || "제목없음"} (ID: ${i.id})`).join('\n');
  return c.json({ result: text || "검색 결과 없음" });
});

app.post('/read', async (c) => {
  const notion = new Client({ auth: c.env.NOTION_KEY });
  const { page_id } = await c.req.json();
  const blocks = await notion.blocks.children.list({ block_id: page_id, page_size: 100 });
  const text = blocks.results.map(b => b[b.type]?.rich_text?.map(t => t.plain_text).join("") || "").join("\n");
  return c.json({ result: text || "내용 없음" });
});

app.post('/write', async (c) => {
  const notion = new Client({ auth: c.env.NOTION_KEY });
  const { database_id, title, content } = await c.req.json();
  await notion.pages.create({
    parent: { database_id },
    properties: { title: { title: [{ text: { content: title } }] } },
    children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content } }] } }]
  });
  return c.json({ result: "작성 완료" });
});

app.post('/append', async (c) => {
  const notion = new Client({ auth: c.env.NOTION_KEY });
  const { page_id, content } = await c.req.json();
  await notion.blocks.children.append({
    block_id: page_id,
    children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content } }] } }]
  });
  return c.json({ result: "추가 완료" });
});

app.post('/comment', async (c) => {
  const notion = new Client({ auth: c.env.NOTION_KEY });
  const { page_id, text } = await c.req.json();
  await notion.comments.create({ parent: { page_id }, rich_text: [{ text: { content: text } }] });
  return c.json({ result: "댓글 등록 완료" });
});

app.post('/status', async (c) => {
  const notion = new Client({ auth: c.env.NOTION_KEY });
  const { page_id, property_name, status_name } = await c.req.json();
  const props = {}; props[property_name] = { status: { name: status_name } };
  await notion.pages.update({ page_id, properties: props });
  return c.json({ result: "상태 변경 완료" });
});

app.post('/archive', async (c) => {
  const notion = new Client({ auth: c.env.NOTION_KEY });
  const { page_id } = await c.req.json();
  await notion.pages.update({ page_id, archived: true });
  return c.json({ result: "삭제 완료" });
});

export default app;
