/*
 * AUTOGENERATED - DON'T EDIT
 * Your edits in this file will be overwritten in the next build!
 * Modify the docusaurus.config.js file at your site's root instead.
 */
export default {
  "title": "Wave Terminal Documentation",
  "tagline": "Level Up Your Terminal With Graphical Widgets",
  "favicon": "img/logo/wave-logo_appicon.svg",
  "url": "https://docs.waveterm.dev",
  "baseUrl": "/docsite/",
  "organizationName": "wavetermdev",
  "projectName": "waveterm-docs",
  "deploymentBranch": "main",
  "onBrokenAnchors": "ignore",
  "onBrokenLinks": "throw",
  "onBrokenMarkdownLinks": "warn",
  "trailingSlash": false,
  "i18n": {
    "defaultLocale": "en",
    "locales": [
      "en"
    ],
    "path": "i18n",
    "localeConfigs": {}
  },
  "plugins": [
    [
      "content-docs",
      {
        "path": "docs",
        "routeBasePath": "/",
        "exclude": [
          "features/**"
        ]
      }
    ],
    "ideal-image",
    [
      "@docusaurus/plugin-sitemap",
      {
        "changefreq": "daily",
        "filename": "sitemap.xml"
      }
    ]
  ],
  "themes": [
    [
      "classic",
      {
        "customCss": "src/css/custom.css"
      }
    ]
  ],
  "themeConfig": {
    "docs": {
      "sidebar": {
        "hideable": false,
        "autoCollapseCategories": false
      },
      "versionPersistence": "localStorage"
    },
    "colorMode": {
      "defaultMode": "light",
      "disableSwitch": false,
      "respectPrefersColorScheme": true
    },
    "navbar": {
      "logo": {
        "src": "img/logo/wave-light.png",
        "srcDark": "img/logo/wave-dark.png",
        "href": "https://www.waveterm.dev/"
      },
      "hideOnScroll": true,
      "items": [
        {
          "type": "doc",
          "position": "left",
          "docId": "index",
          "label": "Docs"
        }
      ]
    },
    "metadata": [
      {
        "name": "keywords",
        "content": "terminal, developer, development, command, line, wave, linux, macos, windows, connection, ssh, cli, waveterm, documentation, docs, ai, graphical, widgets, remote, open, source, open-source, go, golang, react, typescript, javascript"
      },
      {
        "name": "og:type",
        "content": "website"
      },
      {
        "name": "og:site_name",
        "content": "Wave Terminal Documentation"
      },
      {
        "name": "application-name",
        "content": "Wave Terminal Documentation"
      },
      {
        "name": "apple-mobile-web-app-title",
        "content": "Wave Terminal Documentation"
      }
    ],
    "footer": {
      "copyright": "Copyright © 2024 Command Line Inc. Built with Docusaurus.",
      "style": "light",
      "links": []
    },
    "algolia": {
      "appId": "B6A8512SN4",
      "apiKey": "e879cd8663f109b2822cd004d9cd468c",
      "indexName": "waveterm"
    },
    "blog": {
      "sidebar": {
        "groupByYear": true
      }
    },
    "prism": {
      "additionalLanguages": [],
      "theme": {
        "plain": {
          "color": "#bfc7d5",
          "backgroundColor": "#292d3e"
        },
        "styles": [
          {
            "types": [
              "comment"
            ],
            "style": {
              "color": "rgb(105, 112, 152)",
              "fontStyle": "italic"
            }
          },
          {
            "types": [
              "string",
              "inserted"
            ],
            "style": {
              "color": "rgb(195, 232, 141)"
            }
          },
          {
            "types": [
              "number"
            ],
            "style": {
              "color": "rgb(247, 140, 108)"
            }
          },
          {
            "types": [
              "builtin",
              "char",
              "constant",
              "function"
            ],
            "style": {
              "color": "rgb(130, 170, 255)"
            }
          },
          {
            "types": [
              "punctuation",
              "selector"
            ],
            "style": {
              "color": "rgb(199, 146, 234)"
            }
          },
          {
            "types": [
              "variable"
            ],
            "style": {
              "color": "rgb(191, 199, 213)"
            }
          },
          {
            "types": [
              "class-name",
              "attr-name"
            ],
            "style": {
              "color": "rgb(255, 203, 107)"
            }
          },
          {
            "types": [
              "tag",
              "deleted"
            ],
            "style": {
              "color": "rgb(255, 85, 114)"
            }
          },
          {
            "types": [
              "operator"
            ],
            "style": {
              "color": "rgb(137, 221, 255)"
            }
          },
          {
            "types": [
              "boolean"
            ],
            "style": {
              "color": "rgb(255, 88, 116)"
            }
          },
          {
            "types": [
              "keyword"
            ],
            "style": {
              "fontStyle": "italic"
            }
          },
          {
            "types": [
              "doctype"
            ],
            "style": {
              "color": "rgb(199, 146, 234)",
              "fontStyle": "italic"
            }
          },
          {
            "types": [
              "namespace"
            ],
            "style": {
              "color": "rgb(178, 204, 214)"
            }
          },
          {
            "types": [
              "url"
            ],
            "style": {
              "color": "rgb(221, 221, 221)"
            }
          }
        ]
      },
      "magicComments": [
        {
          "className": "theme-code-block-highlighted-line",
          "line": "highlight-next-line",
          "block": {
            "start": "highlight-start",
            "end": "highlight-end"
          }
        }
      ]
    },
    "tableOfContents": {
      "minHeadingLevel": 2,
      "maxHeadingLevel": 3
    }
  },
  "headTags": [
    {
      "tagName": "link",
      "attributes": {
        "rel": "preload",
        "as": "font",
        "type": "font/woff2",
        "data-next-font": "size-adjust",
        "href": "/docsite/fontawesome/webfonts/fa-sharp-regular-400.woff2"
      }
    },
    {
      "tagName": "link",
      "attributes": {
        "rel": "sitemap",
        "type": "application/xml",
        "title": "Sitemap",
        "href": "/docsite/sitemap.xml"
      }
    }
  ],
  "stylesheets": [
    "/docsite/fontawesome/css/fontawesome.min.css",
    "/docsite/fontawesome/css/sharp-regular.min.css"
  ],
  "staticDirectories": [
    "static",
    "storybook"
  ],
  "baseUrlIssueBanner": true,
  "future": {
    "experimental_faster": {
      "swcJsLoader": false,
      "swcJsMinimizer": false,
      "swcHtmlMinimizer": false,
      "lightningCssMinimizer": false,
      "mdxCrossCompilerCache": false,
      "rspackBundler": false
    },
    "experimental_storage": {
      "type": "localStorage",
      "namespace": false
    },
    "experimental_router": "browser"
  },
  "onDuplicateRoutes": "warn",
  "customFields": {},
  "presets": [],
  "scripts": [],
  "clientModules": [],
  "titleDelimiter": "|",
  "noIndex": false,
  "markdown": {
    "format": "mdx",
    "mermaid": false,
    "mdx1Compat": {
      "comments": true,
      "admonitions": true,
      "headingIds": true
    },
    "anchors": {
      "maintainCase": false
    }
  }
};
