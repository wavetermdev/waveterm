import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/search',
    component: ComponentCreator('/search', '5de'),
    exact: true
  },
  {
    path: '/',
    component: ComponentCreator('/', '9e4'),
    routes: [
      {
        path: '/',
        component: ComponentCreator('/', 'a85'),
        routes: [
          {
            path: '/',
            component: ComponentCreator('/', '1d9'),
            routes: [
              {
                path: '/config',
                component: ComponentCreator('/config', '451'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/connections',
                component: ComponentCreator('/connections', 'b73'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/customization',
                component: ComponentCreator('/customization', '194'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/customwidgets',
                component: ComponentCreator('/customwidgets', '96c'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/faq',
                component: ComponentCreator('/faq', '850'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/keybindings',
                component: ComponentCreator('/keybindings', 'a8d'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/layout',
                component: ComponentCreator('/layout', '69f'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/quickstart',
                component: ComponentCreator('/quickstart', 'd2c'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/releasenotes',
                component: ComponentCreator('/releasenotes', '8b8'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/telemetry',
                component: ComponentCreator('/telemetry', 'ce6'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/widgets',
                component: ComponentCreator('/widgets', 'a31'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/wsh',
                component: ComponentCreator('/wsh', 'b75'),
                exact: true,
                sidebar: "defaultSidebar"
              },
              {
                path: '/',
                component: ComponentCreator('/', '87e'),
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
