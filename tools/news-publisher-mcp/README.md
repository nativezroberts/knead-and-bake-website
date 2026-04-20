# Knead & Bake TX — News Publisher MCP Server

An MCP server that lets Cowork generate and publish marketing news posts
directly to kneadandbaketx.com, using the existing admin REST API.

## Tools

| Tool | Description |
|---|---|
| `publish_news_post` | Creates a new news post and makes it live |
| `list_news_posts` | Retrieves all existing posts (used to avoid duplicates) |
| `delete_news_post` | Permanently deletes a post by ID |

## Setup (one-time)

### 1. Install dependencies

Open a terminal in this directory and run:

```bash
cd C:\Users\zacha\Programs\knead-and-bake-website\tools\news-publisher-mcp
npm install
```

### 2. Verify it works

The `.mcp.json` in the project root auto-registers this server with Cowork
whenever you open the `knead-and-bake-website` workspace. No further steps needed.

### 3. Test manually (optional)

In Cowork, type: **"List the current news posts"**

Cowork will call `list_news_posts` and show you what's live on the site.

---

## Credentials

Stored in `.mcp.json` at the project root (gitignored — never committed).

- `KNEAD_BAKE_ADMIN_PASSWORD` — Admin password for kneadandbaketx.com
- `KNEAD_BAKE_API_BASE` — API Gateway URL

To rotate the password, edit `.mcp.json` and restart Cowork.

---

## Weekly Auto-Post

A Cowork scheduled task ("knead-bake-weekly-news") runs every **Monday at 9 AM**
and publishes a fresh post automatically. You can also trigger it manually from
the Scheduled section in the Cowork sidebar.

Skill prompt for content generation:
`.claude/skills/publish-bakery-news/SKILL.md`
