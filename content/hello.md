---
title: "Hello World"
theme: "default"
description: "Welcome to MDCMS - your new markdown-based content management system"
date: "2025-01-22"
author: "MDCMS"
---

# Welcome to MDCMS!

This is your first page running on MDCMS - a markdown-based content management system designed for easy content creation and versioning.

## What Makes MDCMS Special?

- **Version Control**: Create multiple versions of your content (perfect for fan fiction!)
- **Easy Editing**: Just write in markdown and save
- **Beautiful Themes**: Switch between different visual styles
- **Analytics**: Track your visitors and popular content
- **HTTPS Security**: Secure by default

## Getting Started

1. **Create Content**: Add `.md` files to the `content/` directory
2. **Set Themes**: Use `theme: "dark"` or `theme: "minimal"` in your front matter
3. **Add Versions**: Create `story.v2.md`, `story.v3.md` for different versions
4. **Include Images**: Put them in a directory like `content/story/image.jpg`

## Example Content Structure

```
content/
├── hello.md           # This page
├── my-story.md        # Version 1 of your story
├── my-story.v2.md     # Version 2 with updates
└── my-story/          # Assets for your story
    └── cover.jpg      # Story cover image
```

## Admin Features

Visit `/admin` (password: `change-me-in-production`) to:

- View visitor statistics
- See popular pages
- Copy shareable URLs
- Monitor recent activity

## Themes

Try different themes by changing the front matter:

- `theme: "default"` - Clean, modern design
- `theme: "dark"` - Dark mode for comfortable reading
- `theme: "minimal"` - Typography-focused minimalism

## Next Steps

1. Update the admin password in `config.json`
2. Create your first story or article
3. Customize the themes to match your style
4. Share your content with the world!

Happy writing! 🚀