import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/docsite/',
    component: ComponentCreator('/docsite/', '2ab'),
    routes: [
      {
        path: '/docsite/',
        component: ComponentCreator('/docsite/', '837'),
        routes: [
          {
            path: '/docsite/',
            component: ComponentCreator('/docsite/', 'd82'),
            routes: [
              {
                path: '/docsite/config',
                component: ComponentCreator('/docsite/config', 'a2a'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/connections',
                component: ComponentCreator('/docsite/connections', 'f42'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/customization',
                component: ComponentCreator('/docsite/customization', '866'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/customwidgets',
                component: ComponentCreator('/docsite/customwidgets', '8db'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/faq',
                component: ComponentCreator('/docsite/faq', 'a19'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/gettingstarted',
                component: ComponentCreator('/docsite/gettingstarted', '8c4'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/keybindings',
                component: ComponentCreator('/docsite/keybindings', '36a'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/layout',
                component: ComponentCreator('/docsite/layout', '170'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/presets',
                component: ComponentCreator('/docsite/presets', 'e74'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/releasenotes',
                component: ComponentCreator('/docsite/releasenotes', '49b'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/telemetry',
                component: ComponentCreator('/docsite/telemetry', 'b75'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/widgets',
                component: ComponentCreator('/docsite/widgets', '5bf'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/wsh',
                component: ComponentCreator('/docsite/wsh', '493'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/docsite/',
                component: ComponentCreator('/docsite/', '6cc'),
                exact: true,
                sidebar: "defaultSidebar"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
