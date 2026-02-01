import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Client } from '@notionhq/client';

const app = new Hono();
app.use('/*', cors());

/**
 * 1. Agent Builder가 읽어갈 "설명서" (OpenAPI Schema)
 * - Agent가 이 주소(/openapi.json)를 읽으면 도구를 자동으로 등록합니다.
 */
app.get('/openapi.json', (c) => {
  const url = new URL(c.req.url);
  const host = url.origin;

  return c.json({
    openapi: "3.1.0",
    info: {
      title: "Notion Tool",
      description: "노션 페이지를 검색, 읽기, 쓰기하는 도구입니다.",
      version: "1.0.0"
    },
    servers: [{ url: host }],
    paths: {
      "/search": {
        post: {
          operationId: "searchNotion",
          summary: "노션 검색",
          description: "키워드로 노션 페이지를 검색합니다.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", properties: { query: { type: "string" } } } } }
          },
          responses: { "200": { description: "성공" } }
        }
      },
      "/write": {
        post: {
          operationId: "writePage",
          summary: "페이지 작성",
          description: "새로운 페이지를 생성합니다.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    database_id: { type: "string" },
                    title: { type: "string" },
                    content: { type: "string" }
                  }
                }
              }
            }
          },
          responses: { "200": { description: "성공" } }
        }
      }
    }
  });
});

/**
 * 2. 실제 기능 구현 (REST API 방식)
 */
app.post('/search', async (c) => {
  try {
    const notion = new Client({ auth: c.env.NOTION_KEY });
    const { query } = await c.req.json();
    const res = await notion.search({ query, page_size: 5 });
    
    const text = res.results.map(i => 
      `- ${i.properties?.Name?.title?.[0]?.plain_text || "제목없음"} (ID: ${i.id})`
    ).join('\n') || "결과 없음";
    
    return c.json({ result: text });
  } catch (e) { return c.json({ error: e.message }, 500); }
});

app.post('/write', async (c) => {
  try {
    const notion = new Client({ auth: c.env.NOTION_KEY });
    const { database_id, title, content } = await c.req.json();
    
    await notion.pages.create({
      parent: { database_id },
      properties: { title: { title: [{ text: { content: title } }] } },
      children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: content } }] } }]
    });
    
    return c.json({ result: "작성 완료" });
  } catch (e) { return c.json({ error: e.message }, 500); }
});

export default app;
