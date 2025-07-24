const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { marked } = require('marked');
const matter = require('gray-matter');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

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
      recentVisits: visits.slice(-50).reverse()
    };
  }

  getPopularPages(visits) {
    const pageCount = {};
    visits.forEach(visit => {
      const key = visit.version ? `${visit.page} (${visit.version})` : visit.page;
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
      const page = visit.page.replace('/', ''); // Remove leading slash
      const version = visit.version || 'v1';
      
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
        .recent-visits { max-height: 300px; overflow-y: auto; border: 1px solid #ddd; }
        .visit-item { padding: 8px; border-bottom: 1px solid #eee; font-size: 0.9em; }
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
              
              return versions.map((v, i) => {
                const versionViews = pageViewData[`v${v.version}`] || 0;
                return `
                  <tr>
                    <td${i > 0 ? ' class="version-indent"' : ''}>${i === 0 ? page : `└─ v${v.version}${v.version === latestVersion ? ' (latest)' : ''}`}</td>
                    <td>${v.version}</td>
                    <td${i > 0 ? ' class="version-indent"' : ''}>${i === 0 ? `<strong>${totalViews}</strong>` : versionViews}</td>
                    <td>
                      <button class="copy-btn" onclick="copyUrl('${page}${i === 0 && versions.length === 1 ? '' : (v.version === latestVersion ? '' : '/v' + v.version)}')">Copy URL</button>
                    </td>
                  </tr>
                `;
              }).join('');
            }).join('')}
          </tbody>
        </table>
      </div>
      
      
      <div class="section">
        <h2>Recent Visits</h2>
        <div class="recent-visits">
          ${stats.recentVisits.slice(0, 20).map(visit => `
            <div class="visit-item">
              ${new Date(visit.timestamp).toLocaleString()} - ${visit.page}${visit.version ? ` (${visit.version})` : ''} - ${visit.ipHash?.substring(0, 8)}...
            </div>
          `).join('')}
        </div>
      </div>
      
      <script>
        function copyUrl(path) {
          const url = window.location.protocol + '//' + window.location.host + '/' + path;
          navigator.clipboard.writeText(url).then(() => {
            alert('URL copied to clipboard: ' + url);
          });
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