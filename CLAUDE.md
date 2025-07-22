# MDCMS Project Implementation Plan

## Project Overview
A markdown-based CMS that serves HTTPS web pages from .md files with versioning support, admin interface, and visitor analytics. Designed for fan fiction with easy maintenance using only .md and .json files.

## Architecture Decisions

### Technology Stack
- **Backend**: Node.js + Express
- **Dependencies**: marked, gray-matter, cookie-parser (minimal set)
- **Data Storage**: JSON files (config.json, analytics.json)
- **Content**: Markdown files with YAML front matter
- **Themes**: CSS files in ./themes directory
- **HTTPS**: Node.js built-in https module

### File Structure
```
mdcms/
├── server.js               # Main application
├── package.json           # Dependencies
├── config.json           # Configuration
├── content/              # Markdown files & assets
├── themes/               # CSS theme files
├── ssl/                  # HTTPS certificates
└── analytics.json        # Visitor tracking data
```

### Versioning Convention
- `page-name.md` → Version 1 (original)
- `page-name.v2.md` → Version 2
- `page-name.v3.md` → Version 3
- `page-name/` directory → Assets for all versions

### URL Routing
- `/` → 404 (no automatic index)
- `/page-name` → Latest version (highest v number)
- `/page-name/v1` → Specific version 1
- `/page-name/v2` → Specific version 2
- `/admin` → Admin dashboard (password protected)

## Configuration Schema

### config.json
```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "admin": {
    "password": "your-secure-password",
    "path": "/admin"
  },
  "ssl": {
    "cert": "./ssl/cert.pem",
    "key": "./ssl/key.pem"
  },
  "defaultTheme": "default"
}
```

### Front Matter Schema
```yaml
---
title: "Page Title"             # Optional, defaults to filename
theme: "dark"                   # Optional, defaults to config.defaultTheme
description: "Page description" # Optional, for meta tags
published: true                 # Optional, defaults to true
public-versions: true           # Optional, show version navigation (defaults to true)
date: "2025-01-15"             # Optional
author: "Author Name"          # Optional
tags: ["web", "markdown"]      # Optional
version: "v2"                  # Auto-detected from filename
previousVersion: "v1"          # Optional
nextVersion: "v3"              # Optional
---
```

### Version Navigation System
- **Explicit Routing**: All version links use explicit routes (`/story/v1`, `/story/v2`)
- **No Ambiguous URLs**: v1 links to `/story/v1`, not base URL `/story`
- **Public Versions Control**: Use `public-versions: false` in front matter to hide version navigation
- **Latest Version Indication**: Shows "(latest)" label but still uses explicit versioned route

## Core Features Implementation

### 1. HTTPS Server Setup
- Use Node.js built-in `https` module
- Certificate files from config (`ssl.cert`, `ssl.key`)
- Fallback to self-signed certs for development
- Port and host from config

### 2. Middleware Stack
1. Request logging (for analytics)
2. Static file serving (/themes/*.css)
3. Admin route protection
4. Content route resolution
5. 404 handler

### 3. Content Resolution Logic
```javascript
// For URL /my-story
1. Find all files matching "my-story*.md"
2. Parse versions: my-story.md = v1, my-story.v2.md = v2, etc.
3. Serve highest version number
4. For /my-story/v2, serve specific version
5. For /my-story/image.jpg, serve from my-story/ directory
```

### 4. Theme System
- HTML template with placeholders: {{title}}, {{theme}}, {{renderedMarkdown}}
- CSS files in themes/ directory
- Theme selection priority:
  1. Front matter `theme` field
  2. Config `defaultTheme` setting
  3. Fallback to "default"

### 5. Admin Authentication
- Session-based auth with signed cookies
- Password stored in config.json
- Routes: /admin (dashboard), /admin/login, /admin/logout
- Session timeout: 1 hour
- Rate limiting on login attempts

### 6. Visitor Analytics (Concurrent-Safe)
```javascript
class Analytics {
  constructor() {
    this.writeQueue = [];
    this.flushInterval = setInterval(() => this.flush(), 10000);
  }
  
  track(data) {
    this.writeQueue.push({...data, timestamp: new Date().toISOString()});
  }
  
  async flush() {
    // Atomic write with temp file + rename
    // Batch process queue every 10 seconds
  }
}
```

### Analytics Schema
```json
{
  "visits": [
    {
      "timestamp": "2025-01-15T10:30:00Z",
      "page": "/my-story",
      "version": "v2",
      "ipHash": "a1b2c3d4...",
      "userAgent": "Mozilla/5.0...",
      "referer": "https://google.com"
    }
  ]
}
```

### 7. Admin Dashboard Features
- Total visits (today/week/month)
- Most popular pages
- Recent visitors (last 24h)
- Version comparison stats
- Page list with "Copy URL" buttons (always copy latest version URL)
- Page hierarchy showing versions:
  ```
  my-story (v3 latest)
  ├─ v1
  ├─ v2
  └─ v3 (latest)
  ```

### 8. Static Asset Handling
- Serve non-.md files from content directories
- MIME type detection
- Security: block access outside content/
- Supported: .jpg, .jpeg, .png, .gif, .svg, .webp, .pdf
- Block: .md, .json, system files

## Implementation Steps

### Phase 1: Core Server
1. Create package.json with minimal dependencies
2. Implement basic HTTPS server with routing
3. Add configuration loading from config.json
4. Create basic HTML template system
5. Implement markdown parsing with gray-matter

### Phase 2: Content System
1. Implement content resolution logic
2. Add versioning support (filename parsing)
3. Create theme system and CSS loading
4. Add static asset serving
5. Implement 404 handling

### Phase 3: Admin System
1. Create session-based authentication
2. Build admin dashboard HTML
3. Implement login/logout functionality
4. Add page listing with Copy URL feature
5. Create basic styling for admin interface

### Phase 4: Analytics
1. Implement concurrent-safe analytics class
2. Add visitor tracking middleware
3. Create analytics dashboard views
4. Add graceful shutdown handlers
5. Implement data visualization (simple HTML/CSS)

### Phase 5: Docker & Production
1. Create Dockerfile (Node.js Alpine)
2. Add docker-compose.yml example
3. Create SSL certificate handling
4. Add production optimizations
5. Document deployment process

## Dependencies Required
```json
{
  "dependencies": {
    "express": "^4.18.0",
    "marked": "^4.0.0",
    "gray-matter": "^4.0.0",
    "cookie-parser": "^1.4.0"
  }
}
```

## Docker Configuration
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## Key Design Principles
1. **Minimal Dependencies**: Only essential packages
2. **File-Based Configuration**: Everything in .md and .json
3. **Concurrent Safety**: Atomic writes for analytics
4. **Version-Aware**: URL routing handles versions automatically
5. **Security First**: HTTPS-only, secure sessions, input validation
6. **Maintenance Friendly**: Clear structure, minimal complexity
7. **Container Ready**: Easy Docker deployment

## Testing Commands
Once implemented, run these to verify:
- `npm start` - Start server
- `npm test` - Run tests (if added)
- `npm run lint` - Code linting (if added)

## Notes
- Always copy latest version URLs in admin interface
- Root path (/) returns 404 by design
- Analytics flush every 10 seconds for performance
- Session timeout: 1 hour
- All paths are absolute for container compatibility