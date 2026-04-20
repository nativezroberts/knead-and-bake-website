#!/usr/bin/env node
/**
 * Knead & Bake TX — News Publisher MCP Server
 *
 * Provides tools for Cowork to generate and publish marketing news posts
 * to kneadandbaketx.com via the admin REST API.
 *
 * Environment variables:
 *   KNEAD_BAKE_API_BASE      — API base URL (default: production URL)
 *   KNEAD_BAKE_ADMIN_PASSWORD — Admin password for the site
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.KNEAD_BAKE_API_BASE ||
  'https://3db1s4oqy5.execute-api.us-east-1.amazonaws.com';
const ADMIN_PASSWORD = process.env.KNEAD_BAKE_ADMIN_PASSWORD;

// ── Auth helper ────────────────────────────────────────────────────────────

async function getAuthToken() {
  if (!ADMIN_PASSWORD) {
    throw new Error(
      'KNEAD_BAKE_ADMIN_PASSWORD environment variable is not set. ' +
      'Add it to your MCP server configuration in Cowork settings.'
    );
  }

  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Authentication failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.token) throw new Error('No token returned from auth endpoint');
  return data.token;
}

// ── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "knead-bake-mcp-server",
  version: "1.0.0",
});

// ── Tool: publish_news_post ────────────────────────────────────────────────

server.registerTool(
  "publish_news_post",
  {
    title: "Publish News Post",
    description:
      "Creates and publishes a new marketing news post to the Knead & Bake TX website. " +
      "Use this after generating content to make it live on kneadandbaketx.com/news.html",
    inputSchema: {
      title: z.string().max(200)
        .describe("Post headline (max 200 chars). Should be engaging and on-brand."),
      excerpt: z.string().max(500)
        .describe("Short teaser shown in the news list (max 500 chars). 1-2 sentences."),
      content: z.string().max(10000)
        .describe("Full post body in Markdown (max 10,000 chars). Supports headings, bold, lists, links."),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("Publication date in YYYY-MM-DD format (e.g. 2026-04-14)."),
      subtitle: z.string().max(300).optional()
        .describe("Optional subtitle displayed below the title (max 300 chars)."),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Optional expiry date in YYYY-MM-DD. Post will be hidden after this date."),
      active: z.boolean().optional()
        .describe("Set false to save as draft (default: true = immediately published)."),
    },
  },
  async ({ title, excerpt, content, startDate, subtitle, endDate, active }) => {
    try {
      const token = await getAuthToken();

      const body = { title, excerpt, content, startDate };
      if (subtitle) body.subtitle = subtitle;
      if (endDate) body.endDate = endDate;
      if (active !== undefined) body.active = active;

      const res = await fetch(`${API_BASE}/api/admin/news`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `❌ Failed to publish: ${data.message || 'Unknown error'}` }],
          isError: true,
        };
      }

      const post = data.post;
      const result = {
        success: true,
        id: post.id,
        title: post.title,
        slug: post.slug,
        startDate: post.startDate,
        active: post.active,
        url: `https://kneadandbaketx.com/news-detail.html?id=${post.id}`,
      };

      return {
        content: [{
          type: "text",
          text: [
            `✅ News post published successfully!`,
            ``,
            `**Title:** ${post.title}`,
            `**Date:** ${post.startDate}`,
            `**Status:** ${post.active ? 'Live' : 'Draft'}`,
            `**URL:** https://kneadandbaketx.com/news-detail.html?id=${post.id}`,
          ].join('\n'),
        }],
        structuredContent: result,
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `❌ Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: list_news_posts ─────────────────────────────────────────────────

server.registerTool(
  "list_news_posts",
  {
    title: "List News Posts",
    description:
      "Retrieves all existing news posts from the Knead & Bake TX website. " +
      "Use this before generating new content to avoid duplicate topics.",
    inputSchema: {},
  },
  async () => {
    try {
      const token = await getAuthToken();

      const res = await fetch(`${API_BASE}/api/admin/news`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `❌ Error: ${data.message}` }],
          isError: true,
        };
      }

      const posts = data.posts || [];

      if (posts.length === 0) {
        return {
          content: [{ type: "text", text: "No news posts found." }],
          structuredContent: { posts: [], count: 0 },
        };
      }

      const lines = posts
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .map(p => `- [${p.startDate}] **${p.title}** — ${p.excerpt?.slice(0, 80)}...`);

      return {
        content: [{
          type: "text",
          text: `Found ${posts.length} post(s):\n\n${lines.join('\n')}`,
        }],
        structuredContent: { posts, count: posts.length },
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `❌ Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: delete_news_post ────────────────────────────────────────────────

server.registerTool(
  "delete_news_post",
  {
    title: "Delete News Post",
    description: "Permanently deletes a news post by ID. Use list_news_posts to find the ID first.",
    inputSchema: {
      id: z.string().describe("The UUID of the post to delete (from list_news_posts)."),
    },
  },
  async ({ id }) => {
    try {
      const token = await getAuthToken();

      const res = await fetch(`${API_BASE}/api/admin/news/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (res.status === 204 || res.ok) {
        return {
          content: [{ type: "text", text: `✅ Post ${id} deleted successfully.` }],
          structuredContent: { deleted: true, id },
        };
      }

      const data = await res.json().catch(() => ({}));
      return {
        content: [{ type: "text", text: `❌ Delete failed: ${data.message || res.status}` }],
        isError: true,
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `❌ Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Start ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
