const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { marked } = require('marked');
const matter = require('gray-matter');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const BOT_USER_AGENT_PATTERN = /(bot|crawler|spider|crawl|slurp|headless|wget|curl|python-requests|httpclient|scrapy|mediapartners-google|preview|monitor|scanner|pingdom|facebookexternalhit|discordbot|slackbot|mastodon|telegrambot|harvest|indexer|lighthouse)/i;

function isLikelyBot(userAgent = '') {
  if (!userAgent) {
    return false;
  }
  return BOT_USER_AGENT_PATTERN.test(userAgent);
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class Analytics {
  constructor() {
    this.writeQueue = [];
    this.analyticsFile = path.join(__dirname, 'analytics.json');
    this.flushInterval = setInterval(() => this.flush(), 10000);
    
    // Initialize analytics file if it doesn't exist
    if (!fs.existsSync(this.analyticsFile)) {
      fs.writeFileSync(this.analyticsFile, JSON.stringify({ visits: [] }, null, 2));
    }
  }

  track(data) {
    this.writeQueue.push({
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  async flush() {
    if (this.writeQueue.length === 0) return;
    
    try {
      const existing = this.readAnalytics();
      existing.visits.push(...this.writeQueue);
      
      // Atomic write
      const tempFile = this.analyticsFile + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(existing, null, 2));
      fs.renameSync(tempFile, this.analyticsFile);
      
      this.writeQueue = [];
    } catch (error) {
      console.error('Error flushing analytics:', error);
    }
  }

  readAnalytics() {
    try {
      const data = fs.readFileSync(this.analyticsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return { visits: [] };
    }
  }

  getStats() {
    const data = this.readAnalytics();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const month = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const visits = data.visits || [];
    
    return {
      total: visits.length,
      today: visits.filter(v => new Date(v.timestamp) >= today).length,
      week: visits.filter(v => new Date(v.timestamp) >= week).length,
      month: visits.filter(v => new Date(v.timestamp) >= month).length,
      popularPages: this.getPopularPages(visits),
      pageViewCounts: this.getPageViewCounts(visits),
      visitorTypeCounts: this.getVisitorTypeCounts(visits),
      trafficSources: this.getTrafficSources(visits),
      recentVisits: visits.slice(-50).reverse()
    };
  }

  getPopularPages(visits) {
    const pageCount = {};
    visits.forEach(visit => {
      const pageLabel = visit.page === '/' ? '/ (index)' : visit.page;
      const key = visit.version ? `${pageLabel} (${visit.version})` : pageLabel;
      pageCount[key] = (pageCount[key] || 0) + 1;
    });
    
    return Object.entries(pageCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([page, count]) => ({ page, count }));
  }

  getPageViewCounts(visits) {
    const viewCounts = {};
    
    visits.forEach(visit => {
      if (!visit.page) {
        return;
      }

      const page = visit.page === '/' ? 'index' : visit.page.replace(/^\//, '');
      const version = visit.version || 'v1';
      
      if (!page) {
        return;
      }

      if (!viewCounts[page]) {
        viewCounts[page] = {};
      }
      
      viewCounts[page][version] = (viewCounts[page][version] || 0) + 1;
    });
    
    // Calculate totals for each page
    Object.keys(viewCounts).forEach(page => {
      viewCounts[page]._total = Object.values(viewCounts[page]).reduce((sum, count) => sum + count, 0);
    });
    
    return viewCounts;
  }

  getVisitorTypeCounts(visits) {
    return visits.reduce(
      (acc, visit) => {
        if (isLikelyBot(visit.userAgent)) {
          acc.bots += 1;
        } else {
          acc.humans += 1;
        }
        return acc;
      },
      { humans: 0, bots: 0 }
    );
  }

  getTrafficSources(visits) {
    const sourceCounts = new Map();
    let directCount = 0;

    visits.forEach(visit => {
      if (!visit.referer) {
        directCount += 1;
        return;
      }

      let source;
      try {
        const refererUrl = new URL(visit.referer);
        source = refererUrl.hostname || visit.referer;
      } catch (error) {
        source = visit.referer;
      }

      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    });

    const sortedSources = Array.from(sourceCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([source, count]) => ({ source, count }));

    if (directCount > 0) {
      sortedSources.unshift({ source: 'Direct / Unknown', count: directCount });
    }

    return sortedSources.slice(0, 10);
  }
}

class ContentManager {
  constructor(contentDir) {
    this.contentDir = contentDir;
  }

  findVersions(baseName) {
    const files = fs.readdirSync(this.contentDir);
    const versions = [];
    
    // Find base file (v1)
    if (files.includes(`${baseName}.md`)) {
      versions.push({ version: 1, file: `${baseName}.md` });
    }
    
    // Find versioned files
    files.forEach(file => {
      const match = file.match(new RegExp(`^${baseName}\\.v(\\d+)\\.md$`));
      if (match) {
        versions.push({ version: parseInt(match[1]), file });
      }
    });
    
    return versions.sort((a, b) => a.version - b.version);
  }

  getContent(pageName, version = null) {
    const versions = this.findVersions(pageName);
    if (versions.length === 0) return null;
    
    let targetVersion;
    if (version) {
      targetVersion = versions.find(v => v.version === parseInt(version));
    } else {
      targetVersion = versions[versions.length - 1]; // Latest version
    }
    
    if (!targetVersion) return null;
    
    const filePath = path.join(this.contentDir, targetVersion.file);
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const parsed = matter(fileContent);
      
      return {
        content: parsed.content,
        data: parsed.data,
        version: targetVersion.version,
        versions: versions,
        isLatest: targetVersion.version === versions[versions.length - 1].version
      };
    } catch (error) {
      return null;
    }
  }

  getAllPages() {
    const files = fs.readdirSync(this.contentDir);
    const pages = {};
    
    files.forEach(file => {
      if (!file.endsWith('.md')) return;
      
      const match = file.match(/^(.+?)(?:\.v(\d+))?\.md$/);
      if (match) {
        const baseName = match[1];
        const version = match[2] ? parseInt(match[2]) : 1;
        
        if (!pages[baseName]) {
          pages[baseName] = [];
        }
        pages[baseName].push({ version, file });
      }
    });
    
    // Sort versions for each page
    Object.keys(pages).forEach(page => {
      pages[page].sort((a, b) => a.version - b.version);
    });
    
    return pages;
  }
}

class Server {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.analytics = new Analytics();
    this.contentManager = new ContentManager(path.join(__dirname, 'content'));
    this.sessions = new Map();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupGracefulShutdown();
  }

  setupMiddleware() {
    this.app.use(cookieParser());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.json());
    
    // Serve theme files
    this.app.use('/themes', express.static(path.join(__dirname, 'themes')));
  }

  setupRoutes() {
    // Admin routes
    this.app.get('/admin', this.requireAuth.bind(this), this.adminDashboard.bind(this));
    this.app.get('/admin/login', this.loginPage.bind(this));
    this.app.post('/admin/login', this.handleLogin.bind(this));
    this.app.post('/admin/logout', this.handleLogout.bind(this));
    
    // Content routes (must come before asset routes)
    this.app.get('/:page/v:version', this.servePage.bind(this));
    this.app.get('/:page', this.servePage.bind(this));
    
    // Static assets from content directories (more specific patterns)
    this.app.get('/:page/:file', this.serveAsset.bind(this));
    
    // Root path - serve index.md if it exists
    this.app.get('/', this.serveIndex.bind(this));
  }

  requireAuth(req, res, next) {
    const sessionId = req.cookies.session;
    const session = this.sessions.get(sessionId);
    
    if (!session || Date.now() > session.expires) {
      return res.redirect('/admin/login');
    }
    
    // Extend session
    session.expires = Date.now() + 3600000; // 1 hour
    next();
  }

  loginPage(req, res) {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Admin Login - MDCMS</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; }
        input { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
        button { width: 100%; padding: 10px; background: #007cba; color: white; border: none; cursor: pointer; }
        button:hover { background: #005a8b; }
        .error { color: red; margin: 10px 0; }
      </style>
    </head>
    <body>
      <h1>Admin Login</h1>
      ${req.query.error ? '<div class="error">Invalid password</div>' : ''}
      <form method="post" action="/admin/login">
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Login</button>
      </form>
    </body>
    </html>`;
    res.send(html);
  }

  handleLogin(req, res) {
    if (req.body.password === this.config.admin.password) {
      const sessionId = crypto.randomBytes(32).toString('hex');
      this.sessions.set(sessionId, {
        expires: Date.now() + 3600000 // 1 hour
      });
      
      res.cookie('session', sessionId, {
        httpOnly: true,
        secure: true,
        maxAge: 3600000
      });
      
      res.redirect('/admin');
    } else {
      res.redirect('/admin/login?error=1');
    }
  }

  handleLogout(req, res) {
    const sessionId = req.cookies.session;
    this.sessions.delete(sessionId);
    res.clearCookie('session');
    res.redirect('/admin/login');
  }

  adminDashboard(req, res) {
    const stats = this.analytics.getStats();
    const pages = this.contentManager.getAllPages();
    const viewCounts = stats.pageViewCounts;
    const visitorCounts = stats.visitorTypeCounts || { humans: 0, bots: 0 };
    const trafficSources = stats.trafficSources || [];
    const totalVisitorCount = visitorCounts.humans + visitorCounts.bots;
    const humanPercentage = totalVisitorCount ? Math.round((visitorCounts.humans / totalVisitorCount) * 100) : 0;
    const botPercentage = totalVisitorCount ? Math.round((visitorCounts.bots / totalVisitorCount) * 100) : 0;

    const formatReferer = (referer) => {
      if (!referer) {
        return 'Direct / Unknown';
      }
      try {
        const refererUrl = new URL(referer);
        const path = refererUrl.pathname && refererUrl.pathname !== '/' ? refererUrl.pathname : '';
        return `${refererUrl.hostname}${path}`;
      } catch (error) {
        return referer;
      }
    };
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Admin Dashboard - MDCMS</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding-bottom: 10px; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 20px 0; }
        .stat-card { background: #f5f5f5; padding: 20px; border-radius: 5px; text-align: center; }
        .stat-number { font-size: 2em; font-weight: bold; color: #007cba; }
        .section { margin: 30px 0; }
        .page-list { border-collapse: collapse; width: 100%; }
        .page-list th, .page-list td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        .page-list th { background: #f5f5f5; }
        .page-list th:nth-child(3), .page-list td:nth-child(3) { text-align: center; width: 80px; }
        .copy-btn { background: #007cba; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 3px; }
        .copy-btn:hover { background: #005a8b; }
        .version-indent { padding-left: 20px; font-size: 0.9em; color: #666; }
        .logout-btn { background: #dc3545; color: white; text-decoration: none; padding: 8px 16px; border-radius: 4px; }
        .page-base-row td:first-child { font-weight: 600; }
        .version-row td { background: #fafafa; }
        .insights { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
        .insight-card { background: #f5f5f5; padding: 16px; border-radius: 6px; }
        .insight-card h3 { margin-top: 0; font-size: 1.1em; }
        .insight-card p { margin: 6px 0; }
        .traffic-list { list-style: none; padding: 0; margin: 0; }
        .traffic-list li { padding: 4px 0; border-bottom: 1px solid #eee; font-size: 0.9em; }
        .traffic-list li:last-child { border-bottom: none; }
        .table-wrapper { border: 1px solid #ddd; border-radius: 4px; overflow: hidden; max-height: 320px; overflow-y: auto; }
        .visit-table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
        .visit-table th, .visit-table td { padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
        .visit-table th { position: sticky; top: 0; background: #f5f5f5; z-index: 1; }
        .visit-table td a { color: #007cba; text-decoration: none; }
        .visit-table td a:hover { text-decoration: underline; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75em; font-weight: 600; }
        .badge.human { background: #e6f4ea; color: #1b5e20; }
        .badge.bot { background: #fce8e6; color: #b71c1c; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>MDCMS Admin Dashboard</h1>
        <form method="post" action="/admin/logout" style="display: inline;">
          <button type="submit" class="logout-btn">Logout</button>
        </form>
      </div>
      
      <div class="stats">
        <div class="stat-card">
          <div class="stat-number">${stats.total}</div>
          <div>Total Visits</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.today}</div>
          <div>Today</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.week}</div>
          <div>This Week</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.month}</div>
          <div>This Month</div>
        </div>
      </div>
      
      <div class="section">
        <h2>Pages</h2>
        <table class="page-list">
          <thead>
            <tr>
              <th>Page</th>
              <th>Version</th>
              <th>Views</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(pages).map(([page, versions]) => {
              const latestVersion = Math.max(...versions.map(v => v.version));
              const pageViewData = viewCounts[page] || {};
              const totalViews = pageViewData._total || 0;
              const displayName = page === 'index' ? 'index (home)' : page;
              const rootPath = page === 'index' ? '/' : `/${page}`;
              const versionRows = versions.length > 1 ? versions.map(v => {
                const versionViews = pageViewData[`v${v.version}`] || 0;
                const isLatest = v.version === latestVersion;
                const versionPath = page === 'index' ? `/index/v${v.version}` : `/${page}/v${v.version}`;
                return `
                  <tr class="version-row">
                    <td class="version-indent">└─ v${v.version}${isLatest ? ' (latest)' : ''}</td>
                    <td>${v.version}</td>
                    <td>${versionViews}</td>
                    <td>
                      <button class="copy-btn" data-path="${escapeHtml(versionPath)}" onclick="copyUrl(this.dataset.path)">Copy URL</button>
                    </td>
                  </tr>
                `;
              }).join('') : '';
              
              return `
                <tr class="page-base-row">
                  <td>${escapeHtml(displayName)}</td>
                  <td>v${latestVersion} (latest)</td>
                  <td><strong>${totalViews}</strong></td>
                  <td>
                    <button class="copy-btn" data-path="${escapeHtml(rootPath)}" onclick="copyUrl(this.dataset.path)">Copy URL</button>
                  </td>
                </tr>
                ${versionRows}
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      
      
      <div class="section">
        <h2>Visitor Insights</h2>
        <div class="insights">
          <div class="insight-card">
            <h3>Humans vs Bots</h3>
            <p><strong>Humans:</strong> ${visitorCounts.humans} (${humanPercentage}%)</p>
            <p><strong>Bots:</strong> ${visitorCounts.bots} (${botPercentage}%)</p>
            <p><small>Total tracked visits: ${totalVisitorCount}</small></p>
          </div>
          <div class="insight-card">
            <h3>Top Traffic Sources</h3>
            <ul class="traffic-list">
              ${trafficSources.length === 0
                ? '<li>No data yet</li>'
                : trafficSources.map(source => `
                    <li><strong>${escapeHtml(source.source)}</strong> &middot; ${source.count}</li>
                  `).join('')}
            </ul>
          </div>
        </div>
      </div>
      
      <div class="section">
        <h2>Recent Visits</h2>
        <div class="table-wrapper">
          <table class="visit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Page</th>
                <th>Version</th>
                <th>Visitor</th>
                <th>Referer</th>
                <th>User Agent</th>
              </tr>
            </thead>
            <tbody>
              ${stats.recentVisits.slice(0, 20).map(visit => {
                const isBotVisit = isLikelyBot(visit.userAgent);
                const visitorLabel = isBotVisit ? 'Bot' : 'Human';
                const visitorClass = isBotVisit ? 'bot' : 'human';
                const ipFragment = visit.ipHash ? visit.ipHash.substring(0, 8) : '—';
                const visitPath = visit.page === '/' ? '/' : (visit.page || 'Unknown');
                const refererText = visit.referer ? formatReferer(visit.referer) : 'Direct / Unknown';
                const refererCell = visit.referer
                  ? `<a href="${escapeHtml(visit.referer)}" target="_blank" rel="noopener">${escapeHtml(refererText)}</a>`
                  : 'Direct / Unknown';
                const userAgent = visit.userAgent ? escapeHtml(visit.userAgent) : 'Unknown';
                return `
                  <tr>
                    <td>${escapeHtml(new Date(visit.timestamp).toLocaleString())}</td>
                    <td>${escapeHtml(visitPath)}</td>
                    <td>${escapeHtml(visit.version || '—')}</td>
                    <td><span class="badge ${visitorClass}">${visitorLabel}</span> · ${escapeHtml(ipFragment)}</td>
                    <td>${refererCell}</td>
                    <td>${userAgent}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
      
      <script>
        function copyUrl(path) {
          if (!path) {
            return;
          }

          try {
            const resolved = new URL(path, window.location.origin);
            const url = resolved.href;
            navigator.clipboard.writeText(url).then(() => {
              alert('URL copied to clipboard: ' + url);
            });
          } catch (error) {
            console.error('Unable to copy URL', error);
          }
        }
      </script>
    </body>
    </html>`;
    
    res.send(html);
  }

  servePage(req, res) {
    const pageName = req.params.page;
    const version = req.params.version ? parseInt(req.params.version) : null;
    
    const content = this.contentManager.getContent(pageName, version);
    if (!content) {
      return this.serve404(req, res);
    }
    
    // Track visit
    this.analytics.track({
      page: `/${pageName}`,
      version: version ? `v${version}` : `v${content.version}`,
      ipHash: crypto.createHash('sha256').update(req.ip).digest('hex'),
      userAgent: req.get('User-Agent'),
      referer: req.get('Referer')
    });
    
    const html = this.renderPage(content, pageName);
    res.send(html);
  }

  preprocessObsidianImages(content) {
    // Convert Obsidian-style image embeds ![['path/to/image']] to standard markdown ![alt](path)
    return content.replace(/!\[\['([^']+)'\]\]/g, (_, imagePath) => {
      // Extract filename for alt text
      const filename = path.basename(imagePath);
      const altText = filename.replace(/\.[^/.]+$/, ""); // Remove extension for alt text
      
      // URL encode the path to handle spaces and special characters
      const encodedPath = imagePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
      
      // Convert to standard markdown image syntax
      // The path should be relative to the page directory
      return `![${altText}](/${encodedPath})`;
    });
  }

  renderPage(content, pageName) {
    const title = content.data.title || pageName;
    const theme = content.data.theme || this.config.defaultTheme || 'default';
    
    // Preprocess Obsidian-style image embeds
    const preprocessedContent = this.preprocessObsidianImages(content.content);
    const renderedMarkdown = marked(preprocessedContent);
    
    // Check if version navigation should be shown
    const showVersions = content.data['public-versions'] !== false && content.versions.length > 1;
    
    const versionNav = showVersions ? `
      <div class="version-nav">
        ${content.versions.map(v => `
          <a href="/${pageName}/v${v.version}" 
             class="${v.version === content.version ? 'active' : ''}">
            v${v.version}${content.isLatest && v.version === content.version ? ' (latest)' : ''}
          </a>
        `).join(' | ')}
      </div>
    ` : '';
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${title}</title>
      <link rel="stylesheet" href="/themes/${theme}.css">
      ${content.data.description ? `<meta name="description" content="${content.data.description}">` : ''}
    </head>
    <body>
      <main class="content">
        <header class="page-header">
          <h1>${title}</h1>
          ${versionNav}
        </header>
        <article class="markdown-body">
          ${renderedMarkdown}
        </article>
      </main>
    </body>
    </html>`;
  }

  serveAsset(req, res) {
    try {
      // Decode URL path to handle spaces and special characters
      const decodedPath = decodeURIComponent(req.path);
      const urlParts = decodedPath.split('/').filter(Boolean);
      const pageName = urlParts[0];
      const fileName = urlParts[urlParts.length - 1];
      
      // Security check - only serve from content directory
      const assetPath = path.join(__dirname, 'content', pageName, fileName);
      const normalizedPath = path.normalize(assetPath);
      const contentDir = path.join(__dirname, 'content');
      
      if (!normalizedPath.startsWith(contentDir)) {
        return this.serve404(req, res);
      }
      
      if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
        // Block serving markdown and config files
        if (fileName.endsWith('.md') || fileName.endsWith('.json')) {
          return this.serve404(req, res);
        }
        
        res.sendFile(assetPath);
      } else {
        this.serve404(req, res);
      }
    } catch (error) {
      this.serve404(req, res);
    }
  }

  serveIndex(req, res) {
    const content = this.contentManager.getContent('index');
    if (content) {
      // Track visit for index
      this.analytics.track({
        page: '/',
        version: `v${content.version}`,
        ipHash: crypto.createHash('sha256').update(req.ip).digest('hex'),
        userAgent: req.get('User-Agent'),
        referer: req.get('Referer')
      });
      
      const html = this.renderPage(content, 'index');
      res.send(html);
    } else {
      this.serve404(req, res);
    }
  }

  serve404(req, res) {
    res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>404 - Page Not Found</title>
      <link rel="stylesheet" href="/themes/default.css">
    </head>
    <body>
      <main class="content">
        <h1>404 - Page Not Found</h1>
        <p>The requested page could not be found.</p>
      </main>
    </body>
    </html>`);
  }

  setupGracefulShutdown() {
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  async shutdown() {
    console.log('Shutting down gracefully...');
    
    // Flush analytics
    await this.analytics.flush();
    clearInterval(this.analytics.flushInterval);
    
    process.exit(0);
  }

  start() {
    const { cert, key } = this.config.ssl;
    
    try {
      const options = {
        key: fs.readFileSync(key),
        cert: fs.readFileSync(cert)
      };
      
      const server = https.createServer(options, this.app);
      server.listen(this.config.port, this.config.host, () => {
        console.log(`MDCMS server running on https://${this.config.host}:${this.config.port}`);
      });
    } catch (error) {
      console.error('SSL certificate error:', error.message);
      console.log('For development, you can generate self-signed certificates with:');
      console.log('mkdir ssl && openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes');
    }
  }
}

// Load configuration
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('config.json not found. Please create it based on the README.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const server = new Server(config);
server.start();