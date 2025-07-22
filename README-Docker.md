# Docker Setup for MDCMS

## Quick Start

1. **Build and run the application:**
   ```bash
   docker compose up -d
   ```

2. **Access the application:**
   - Website: https://localhost:3000
   - Admin: https://localhost:3000/admin
   - Password: `demo-password-123`

3. **Stop the application:**
   ```bash
   docker compose down
   ```

## Directory Structure

The Docker setup maps these local directories to the container:

```
mdcms/
├── content/          # Your markdown files (mapped to container)
├── themes/           # CSS theme files (mapped to container)  
├── ssl/              # SSL certificates (mapped to container)
├── config.json       # Configuration file (mapped to container)
├── analytics.json    # Analytics data (mapped to container)
├── compose.yml       # Docker Compose configuration
└── Dockerfile        # Docker build instructions
```

## Adding Content

1. **Add new markdown files:**
   - Place `.md` files in the `./content/` directory
   - Use versioning: `story.md`, `story.v2.md`, etc.
   - Add assets in subdirectories: `./content/story/image.jpg`

2. **Add new themes:**
   - Place `.css` files in the `./themes/` directory
   - Reference in markdown front matter: `theme: "your-theme"`

3. **Files are immediately available** - no container restart needed!

## SSL Certificates

For HTTPS to work, place your certificates in the `./ssl/` directory:
- `cert.pem` - SSL certificate
- `key.pem` - Private key

For development, generate self-signed certificates:
```bash
mkdir ssl
openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes
```

## Configuration

Edit `config.json` to change settings:
- Port (default: 3000)
- Admin password
- Default theme
- SSL certificate paths

## Logs and Monitoring

- **View logs:** `docker compose logs -f mdcms`
- **Health check:** `docker compose ps`
- **Container stats:** `docker stats mdcms-app`

## Data Persistence

All data is stored in local directories that are mapped to the container:
- Content files persist in `./content/`
- Analytics data persists in `./analytics.json`
- Configuration persists in `./config.json`

## Security Notes

- Container runs as non-root user for security
- Only necessary ports are exposed
- SSL/HTTPS is enforced for production use
- Change the default admin password in `config.json`

## Troubleshooting

1. **Port already in use:**
   ```bash
   # Change port in compose.yml
   ports:
     - "3001:3000"  # Use port 3001 instead
   ```

2. **Permission issues:**
   ```bash
   # Fix file permissions
   sudo chown -R $USER:$USER ./content ./themes ./ssl
   chmod -R 755 ./content ./themes ./ssl
   ```

3. **SSL certificate errors:**
   - Ensure certificates exist in `./ssl/`
   - Check certificate validity
   - For development, accept self-signed certificate warnings