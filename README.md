# MDCMS - Markdown Content Management System

A lightweight, file-based CMS designed for serving markdown content with versioning support, perfect for fan fiction and content that evolves over time.

## Features

- **Markdown-based content** with YAML front matter
- **Version control** for pages (v1, v2, v3, etc.)
- **HTTPS-only** secure serving
- **Admin dashboard** with visitor analytics
- **Theme system** with multiple CSS themes
- **Concurrent-safe analytics** with batched writes
- **Static asset serving** for images and media
- **Docker-ready** with minimal footprint
- **Zero database** - everything stored in files

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Generate SSL Certificates

For development, create self-signed certificates:

```bash
mkdir ssl
openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes
```

For production, use real certificates from Let's Encrypt or your certificate authority.

### 3. Configure the Application

Edit `config.json`:

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "admin": {
    "password": "your-secure-password-here",
    "path": "/admin"
  },
  "ssl": {
    "cert": "./ssl/cert.pem",
    "key": "./ssl/key.pem"
  },
  "defaultTheme": "default"
}
```

**⚠️ Important**: Change the admin password before running in production!

### 4. Create Your First Content

Create a file `content/hello.md`:

```markdown
---
title: "Hello World"
theme: "default"
description: "My first page"
---

# Hello World

This is my first page on MDCMS!

## Features

- Easy markdown editing
- Version support
- Beautiful themes
```

### 5. Start the Server

```bash
npm start
```

Visit `https://localhost:3000/hello` to see your page!

## Content Management

### Creating Pages

Pages are markdown files in the `content/` directory:

- `content/about.md` → `https://yoursite.com/about`
- `content/my-story.md` → `https://yoursite.com/my-story`

### Page Versioning

Create multiple versions of the same page:

- `content/my-story.md` → Version 1 (original)
- `content/my-story.v2.md` → Version 2
- `content/my-story.v3.md` → Version 3

**URL Access:**
- `/my-story` → Latest version (automatic)
- `/my-story/v1` → Specific version 1
- `/my-story/v2` → Specific version 2

**Version Navigation:**
- Version links always use explicit routes (`/story/v1`, `/story/v2`, etc.)
- Clicking "v1" will take you to `/story/v1`, not the base URL
- Latest version shows "(latest)" label but still uses explicit route

### Front Matter Options

```yaml
---
title: "Page Title"          # Optional, defaults to filename
theme: "dark"               # Optional: default, dark, minimal
description: "SEO description"
published: true             # Optional, defaults to true
public-versions: true       # Optional, show version navigation (defaults to true)
date: "2025-01-15"         # Optional
author: "Author Name"       # Optional
tags: ["fiction", "drama"]  # Optional
---
```

#### Version Navigation Control

- `public-versions: true` (default) - Shows version navigation links
- `public-versions: false` - Hides version navigation, useful for drafts or private versions

### Adding Images and Assets

Create a directory for pages with assets:

```
content/
├── my-story.md           # Version 1
├── my-story.v2.md        # Version 2
└── my-story/             # Assets directory
    ├── cover.jpg         # Shared across versions
    ├── chapter1.png      # Version-specific
    └── assets/
        └── diagram.svg
```

Reference images in markdown:
```markdown
![Cover Image](./cover.jpg)
![Chapter 1](./chapter1.png)
```

## Admin Interface

### Accessing Admin

1. Go to `https://yoursite.com/admin`
2. Enter the password from `config.json`
3. View analytics and manage content

### Admin Features

- **Visitor Statistics**: Total, daily, weekly, monthly visits
- **Popular Pages**: Most visited content with version breakdown
- **Recent Activity**: Latest visitor information
- **Page Management**: List all pages with version hierarchy
- **URL Copying**: One-click copy of page URLs (always latest version)

### Analytics Data

All visitor data is stored in `analytics.json` with:
- Timestamp and page visited
- Version accessed
- Anonymized visitor info (hashed IP)
- Referrer information

## Themes

Three built-in themes are available:

- **default** - Clean, GitHub-inspired design
- **dark** - Dark mode with syntax highlighting
- **minimal** - Typography-focused, minimal design

### Using Themes

Set theme in front matter:
```yaml
---
theme: "dark"
---
```

Or set a global default in `config.json`:
```json
{
  "defaultTheme": "minimal"
}
```

### Custom Themes

Create new CSS files in `themes/` directory:
```css
/* themes/custom.css */
body {
  /* Your custom styles */
}
```

Reference in front matter:
```yaml
---
theme: "custom"
---
```

## Deployment

### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  mdcms:
    build: .
    ports:
      - "443:3000"
    volumes:
      - ./content:/app/content:ro
      - ./themes:/app/themes:ro
      - ./config.json:/app/config.json:ro
      - ./ssl:/app/ssl:ro
      - ./analytics.json:/app/analytics.json
    restart: unless-stopped
```

Run with:
```bash
docker-compose up -d
```

### Traditional Server Deployment

1. Install Node.js 18+ on your server
2. Copy all files to your server
3. Install dependencies: `npm install --production`
4. Configure SSL certificates
5. Update `config.json` with production settings
6. Run with a process manager like PM2:

```bash
npm install -g pm2
pm2 start server.js --name mdcms
pm2 save
pm2 startup
```

## File Structure

```
mdcms/
├── server.js           # Main application
├── package.json        # Dependencies
├── config.json        # Configuration
├── analytics.json     # Visitor data (auto-created)
├── CLAUDE.md          # Implementation notes
├── README.md          # This file
├── content/           # Your markdown content
│   ├── page.md        # Single version page
│   ├── story.md       # Story version 1
│   ├── story.v2.md    # Story version 2
│   └── story/         # Story assets
│       └── image.jpg
├── themes/            # CSS themes
│   ├── default.css
│   ├── dark.css
│   └── minimal.css
└── ssl/              # HTTPS certificates
    ├── cert.pem
    └── key.pem
```

## Configuration Reference

### config.json

```json
{
  "port": 3000,                    // Server port
  "host": "0.0.0.0",              // Bind address
  "admin": {
    "password": "secure-password",  // Admin login password
    "path": "/admin"               // Admin URL path
  },
  "ssl": {
    "cert": "./ssl/cert.pem",      // SSL certificate path
    "key": "./ssl/key.pem"         // SSL private key path
  },
  "defaultTheme": "default"        // Default theme name
}
```

## Security Features

- **HTTPS-only** - No HTTP support
- **Secure sessions** - HTTPOnly, Secure cookies
- **Session timeout** - 1 hour automatic expiry
- **File restrictions** - No direct access to .md or .json files
- **Path validation** - Prevents directory traversal
- **Anonymous analytics** - IP addresses are hashed

## Performance

- **Concurrent-safe analytics** with batched writes every 10 seconds
- **Atomic file operations** prevent data corruption
- **Static asset caching** with proper headers
- **Minimal dependencies** for small footprint
- **Graceful shutdown** ensures no data loss

## Troubleshooting

### SSL Certificate Issues

```bash
# Generate self-signed certificates
mkdir ssl
openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes
```

### Permission Issues

Ensure the application has read/write permissions:
```bash
chmod 755 content/
chmod 644 content/*.md
chmod 666 analytics.json
```

### Port Already in Use

Change the port in `config.json` or find the conflicting process:
```bash
lsof -i :3000
```

### Analytics Not Working

Check file permissions and disk space:
```bash
ls -la analytics.json
df -h
```

## Development

### Adding Features

The codebase is organized into classes:
- `Analytics` - Visitor tracking and statistics
- `ContentManager` - Page and version management
- `Server` - HTTP server and routing

### Testing

Create test content and verify:
1. Page rendering works correctly
2. Versioning system functions
3. Admin authentication works
4. Analytics data is collected
5. Themes apply properly

## License

MIT License - Feel free to use and modify for your projects.

## Support

- Check `CLAUDE.md` for implementation details
- Review server logs for error messages
- Ensure all file paths and permissions are correct
- Verify SSL certificates are valid and accessible