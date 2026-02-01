import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Client } from '@notionhq/client';

const app = new Hono();

// OpenAI Agent Builder가 접속할 수 있도록 CORS 허용
app.use('/*', cors());

/**
 * 1. 동적 OpenAPI 스키마 생성 (Agent Builder가 읽어갈 문서)
 * - 접속한 도메인(host)을 자동으로 감지해서 스키마에 넣습니다.
 */
app.get('/openapi.json', (c) => {
  const host = c.req.header('host');
  const protocol = host.includes('localhost') ? 'http' : 'https';
  
  return c.json({
    openapi: "3.1.0",
    info: {
      title: "Notion Tool",
      description: "노션 페이지를 검색, 읽기, 쓰기, 수정하는 도구입니다.",
      version: "1.0.0"
    },
    servers: [
      {
        url: `${protocol}://${host}`,
        description: "Notion Worker Server"
      }
    ],
    paths: {
      "/search": {
        post: {
          operationId: "searchNotion",
          summary: "노션 검색",
          description: "키워드로 노션 페이지를 검색합니다.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "검색할 키워드" }
                  },
                  required: ["query"]
                }
              }
            }
          },
          responses: { "200": { description: "성공" } }
        }
      },
      "/read": {
        post: {
          operationId: "readPage",
          summary: "페이지 읽기",
          description: "페이지 ID로 내용을 읽어옵니다.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    page_id: { type: "string", description: "페이지 ID" }
                  },
                  required: ["page_id"]
                }
              }
            }
          },
          responses: { "200": { description: "성공" } }
        }
      },
      "/write": {
        post: {
          operationId: "writePage",
          summary: "페이지 생성",
          description: "새 페이지를 만듭니다.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    database_id: { type: "string", description: "데이터베이스 ID" },
                    title: { type: "string", description: "제목" },
                    content: { type: "string", description: "본문 내용" }
                  },
                  required: ["database_id", "title", "content"]
                }
              }
            }
          },
          responses: { "200": { description: "성공" } }
        }
      },
      "/append": {
        post: {
          operationId: "appendContent",
          summary: "내용 추가",
          description: "기존 페이지 하단에 내용을 추가합니다.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    page_id: { type: "string", description: "페이지 ID" },
                    content: { type: "string", description: "추가할 내용" }
                  },
                  required: ["page_id", "content"]
                }
              }
            }
          },
          responses: { "200": { description: "성공" } }
        }
      },
      "/comment": {
        post: {
          operationId: "addComment",
          summary: "댓글 달기",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    page_id: { type: "string", description: "페이지 ID" },
                    text: { type: "string", description: "댓글 내용" }
                  },
                  required: ["page_id", "text"]
                }
              }
            }
          },
          responses: { "200": { description: "성공" } }
        }
      },
      "/status": {
        post: {
          operationId: "updateStatus",
          summary: "상태 변경",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    page_id: { type: "string", description: "페이지 ID" },
                    property_name: { type: "string", description: "상태 속성 이름" },
                    status_name: { type: "string", description: "변경할 상태 값" }
                  },
                  required: ["page_id", "property_name", "status_name"]
                }
              }
            }
          },
          responses: { "200": { description: "성공" } }
        }
      },
      "/archive": {
        post: {
          operationId: "archivePage",
          summary: "페이지 삭제",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    page_id: { type: "string", description: "페이지 ID" }
                  },
                  required: ["page_id"]
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
 * 2. 실제 기능 구현 (REST API)
 */
app.post('/search', async (c) => {
  try {
    const notion = new Client({ auth: c.env.NOTION_KEY });
    const { query } = await c.req.json();
    const res = await notion.search({ query, page_size: 5, sort: { direction: 'descending', timestamp: 'last_edited_time' } });
    const text = res.results.map(i => {
      const title = i.properties?.Name?.title?.[0]?.plain_text || i.properties?.title?.title?.[0]?.plain_text || "제목없음";
      return `- [${title}] (ID: ${i.id})`;
    }).join('\n');
    return c.json({ result: text || "검색 결과 없음" });
  } catch (e) { return c.json({ error: e.message }, 500); }
});

app.post('/read', async (c) => {
  try {
    const notion = new Client({ auth: c.env.NOTION_KEY });
    const { page_id } = await c.req.json();
    const blocks = await notion.blocks.children.list({ block_id: page_id, page_size: 100 });
    const text = blocks.results.map(b => b[b.type]?.rich_text?.map(t => t.plain_text).join("") || "").join("\n");
    return c.json({ result: text || "내용 없음" });
  } catch (e) { return c.json({ error: e.message }, 500); }
});

app.post('/write', async (c) => {
  try {
    const notion = new Client({ auth: c.env.NOTION_KEY });
    const { database_id, title, content } = await c.req.json();
    await notion.pages.create({
      parent: { database_id },
      properties: { title: { title: [{ text: { content: title } }] } },
      children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content } }] } }]
    });
    return c.json({ result: "생성 완료" });
  } catch (e) { return c.json({ error: e.message }, 500); }
});

app.post('/append', async (c) => {
  try {
    const notion = new Client({ auth: c.env.NOTION_KEY });
    const { page_id, content } = await c.req.json();
    await notion.blocks.children.append({
      block_id: page_id,
      children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content } }] } }]
    });
    return c.json({ result: "추가 완료" });
  } catch (e) { return c.json({ error: e.message }, 500); }
});

app.post('/comment', async (c) => {
  try {
    const notion = new Client({ auth: c.env.NOTION_KEY });
    const { page_id, text } = await c.req.json();
    await notion.comments.create({ parent: { page_id }, rich_text: [{ text: { content: text } }] });
    return c.json({ result: "댓글 완료" });
  } catch (e) { return c.json({ error: e.message }, 500); }
});

app.post('/status', async (c) => {
  try {
    const notion = new Client({ auth: c.env.NOTION_KEY });
    const { page_id, property_name, status_name } = await c.req.json();
    const props = {}; props[property_name] = { status: { name: status_name } };
    await notion.pages.update({ page_id, properties: props });
    return c.json({ result: "상태 변경 완료" });
  } catch (e) { return c.json({ error: e.message }, 500); }
});

app.post('/archive', async (c) => {
  try {
    const notion = new Client({ auth: c.env.NOTION_KEY });
    const { page_id } = await c.req.json();
    await notion.pages.update({ page_id, archived: true });
    return c.json({ result: "삭제 완료" });
  } catch (e) { return c.json({ error: e.message }, 500); }
});

export default app;
