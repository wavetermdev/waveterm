# Wave Terminal 国际化(i18n)实施方案

**文档版本:** 1.0
**创建日期:** 2025-12-12
**状态:** 已批准,待实施

---

## 📋 执行摘要

本文档详细规划Wave Terminal前端国际化(i18n)实施方案,目标是为应用添加多语言支持,首先支持中文,并为未来扩展更多语言奠定架构基础。

### 核心需求
- ✅ 动态语言切换(无需重启应用)
- ✅ 按模块/功能组织翻译文件
- ✅ 默认英文 + 系统语言自动检测
- ✅ 全界面国际化(100+组件文件)
- ✅ 可扩展架构支持未来多语言

### 技术方案
- **核心库:** react-i18next + i18next 23.x
- **语言检测:** i18next-browser-languagedetector
- **类型安全:** TypeScript类型提示完整支持

---

## 🏗️ 架构设计

### 1. 技术栈选型

#### 选择: react-i18next (推荐⭐⭐⭐⭐⭐)

**依赖包:**
```json
{
  "i18next": "^23.17.0",
  "react-i18next": "^14.1.0",
  "i18next-browser-languagedetector": "^8.0.0"
}
```

**选型理由:**
1. ✅ GitHub 9k+ stars,社区活跃,长期维护
2. ✅ 完美支持TypeScript类型安全
3. ✅ 与Jotai/React 19无缝集成
4. ✅ 支持懒加载,减少打包体积
5. ✅ 丰富插件生态(格式化、复数、上下文等)
6. ✅ 完美支持Electron环境

### 2. 文件组织结构

```
frontend/
├── locales/                          # 翻译文件根目录
│   ├── en/                          # 英文翻译(默认)
│   │   ├── common.json              # 通用文本(按钮、菜单)
│   │   ├── editor.json              # 代码编辑器
│   │   ├── terminal.json            # 终端相关
│   │   ├── ai.json                  # AI面板
│   │   ├── settings.json            # 设置页面
│   │   ├── modals.json              # 模态框
│   │   ├── notifications.json       # 通知消息
│   │   ├── onboarding.json          # 用户引导
│   │   ├── errors.json              # 错误消息
│   │   └── help.json                # 帮助文档
│   ├── zh-CN/                       # 简体中文翻译
│   │   └── [相同文件结构]
│   └── README.md                    # 多语言贡献指南
├── app/
│   ├── i18n/                        # i18n工具目录
│   │   ├── config.ts                # i18n初始化配置
│   │   ├── resources.ts             # 翻译资源集中管理
│   │   ├── types.ts                 # TypeScript类型定义
│   │   └── hooks.ts                 # 自定义Hooks(可选)
│   └── element/
│       └── language-switcher.tsx    # 语言切换组件
└── wave.ts                          # 在此导入i18n配置
```

### 3. 命名空间规划

| 命名空间 | 覆盖范围 | 预计条目数 | 优先级 |
|---------|---------|-----------|--------|
| **common** | 通用文本(按钮、菜单、操作) | 100-150 | 🔥 高 |
| **editor** | 代码编辑器相关 | 50-80 | 🟡 中 |
| **terminal** | 终端界面和命令 | 80-100 | 🔥 高 |
| **ai** | AI面板和对话 | 60-80 | 🔥 高 |
| **settings** | 设置和配置 | 100-120 | 🟡 中 |
| **modals** | 所有模态框 | 80-100 | 🔥 高 |
| **notifications** | 通知和提示 | 40-60 | 🟡 中 |
| **onboarding** | 用户引导流程 | 50-70 | 🟡 中 |
| **errors** | 错误消息 | 60-80 | 🟡 中 |
| **help** | 帮助和文档 | 50-70 | 🟢 低 |

---

## 📝 详细实施计划

### 阶段 1: 基础架构搭建 (4-6小时)

#### 步骤 1.1: 安装依赖
```bash
npm install i18next react-i18next i18next-browser-languagedetector
```

#### 步骤 1.2: 创建i18n配置
**文件:** `frontend/app/i18n/config.ts`

```typescript
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";

i18n.use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources,
        fallbackLng: "en",
        defaultNS: "common",
        ns: ["common", "editor", "terminal", "ai", "settings", "modals", "notifications", "onboarding", "errors", "help"],
        detection: {
            order: ["localStorage", "navigator"],
            caches: ["localStorage"],
            lookupLocalStorage: "wave-language",
        },
        interpolation: {
            escapeValue: false, // React already escapes
        },
        react: {
            useSuspense: false, // 避免Electron环境下的Suspense问题
        },
    });

export default i18n;
```

#### 步骤 1.3: 创建翻译资源管理
**文件:** `frontend/app/i18n/resources.ts`

```typescript
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 英文翻译
import aiEN from "@/locales/en/ai.json";
import commonEN from "@/locales/en/common.json";
import editorEN from "@/locales/en/editor.json";
import errorsEN from "@/locales/en/errors.json";
import helpEN from "@/locales/en/help.json";
import modalsEN from "@/locales/en/modals.json";
import notificationsEN from "@/locales/en/notifications.json";
import onboardingEN from "@/locales/en/onboarding.json";
import settingsEN from "@/locales/en/settings.json";
import terminalEN from "@/locales/en/terminal.json";

// 中文翻译
import aiZH from "@/locales/zh-CN/ai.json";
import commonZH from "@/locales/zh-CN/common.json";
import editorZH from "@/locales/zh-CN/editor.json";
import errorsZH from "@/locales/zh-CN/errors.json";
import helpZH from "@/locales/zh-CN/help.json";
import modalsZH from "@/locales/zh-CN/modals.json";
import notificationsZH from "@/locales/zh-CN/notifications.json";
import onboardingZH from "@/locales/zh-CN/onboarding.json";
import settingsZH from "@/locales/zh-CN/settings.json";
import terminalZH from "@/locales/zh-CN/terminal.json";

export const resources = {
    en: {
        common: commonEN,
        editor: editorEN,
        terminal: terminalEN,
        ai: aiEN,
        settings: settingsEN,
        modals: modalsEN,
        notifications: notificationsEN,
        onboarding: onboardingEN,
        errors: errorsEN,
        help: helpEN,
    },
    "zh-CN": {
        common: commonZH,
        editor: editorZH,
        terminal: terminalZH,
        ai: aiZH,
        settings: settingsZH,
        modals: modalsZH,
        notifications: notificationsZH,
        onboarding: onboardingZH,
        errors: errorsZH,
        help: helpZH,
    },
} as const;
```

#### 步骤 1.4: TypeScript类型定义
**文件:** `frontend/app/i18n/types.ts`

```typescript
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "react-i18next";
import { resources } from "./resources";

declare module "react-i18next" {
    interface CustomTypeOptions {
        defaultNS: "common";
        resources: (typeof resources)["en"];
    }
}
```

#### 步骤 1.5: 集成到主应用
**文件:** `frontend/wave.ts` (修改)

在 `initWave()` 函数的开头添加:
```typescript
import "@/app/i18n/config"; // 导入i18n配置
```

**预期结果:**
- ✅ i18n配置加载成功
- ✅ 系统语言自动检测
- ✅ TypeScript类型提示正常

---

### 阶段 2: 创建翻译文件骨架 (6-8小时)

#### 步骤 2.1: 创建英文翻译文件

**文件:** `frontend/locales/en/common.json`
```json
{
  "app": {
    "name": "Wave Terminal",
    "tagline": "Open-Source AI-Native Terminal",
    "description": "Built for Seamless Workflows"
  },
  "actions": {
    "copy": "Copy",
    "paste": "Paste",
    "cut": "Cut",
    "save": "Save",
    "cancel": "Cancel",
    "ok": "OK",
    "close": "Close",
    "delete": "Delete",
    "edit": "Edit",
    "open": "Open",
    "create": "Create",
    "search": "Search",
    "back": "Back",
    "forward": "Forward",
    "refresh": "Refresh",
    "settings": "Settings"
  },
  "menu": {
    "file": "File",
    "edit": "Edit",
    "view": "View",
    "help": "Help"
  }
}
```

**其他命名空间文件结构:**
- `editor.json` - 编辑器相关文本
- `terminal.json` - 终端操作和提示
- `ai.json` - AI对话和提示
- `settings.json` - 设置界面所有文本
- `modals.json` - 所有模态框标题和内容
- `notifications.json` - 通知消息模板
- `onboarding.json` - 用户引导流程文本
- `errors.json` - 错误消息模板
- `help.json` - 帮助文档内容

#### 步骤 2.2: 创建中文翻译骨架

**文件:** `frontend/locales/zh-CN/common.json`
```json
{
  "app": {
    "name": "Wave 终端",
    "tagline": "开源AI原生终端",
    "description": "专为无缝工作流而构建"
  },
  "actions": {
    "copy": "复制",
    "paste": "粘贴",
    "cut": "剪切",
    "save": "保存",
    "cancel": "取消",
    "ok": "确定",
    "close": "关闭",
    "delete": "删除",
    "edit": "编辑",
    "open": "打开",
    "create": "创建",
    "search": "搜索",
    "back": "返回",
    "forward": "前进",
    "refresh": "刷新",
    "settings": "设置"
  },
  "menu": {
    "file": "文件",
    "edit": "编辑",
    "view": "视图",
    "help": "帮助"
  }
}
```

**预期结果:**
- ✅ 10个命名空间文件 × 2语言 = 20个JSON文件
- ✅ 文件结构一致,key路径对齐
- ✅ 英文文件包含所有现有硬编码文本

---

### 阶段 3: 核心组件国际化改造 (20-30小时)

#### 步骤 3.1: 改造通用组件 (优先级:🔥高)

**改造文件列表:**
1. `frontend/app/element/button.tsx`
2. `frontend/app/element/modal.tsx`
3. `frontend/app/element/input.tsx`
4. `frontend/app/modals/messagemodal.tsx`

**改造示例 - Modal组件:**

```typescript
// 改造前 (frontend/app/modals/modal.tsx:95-96)
const ModalFooter = ({
    cancelLabel = "Cancel",
    okLabel = "Ok",
    ...
}) => {
    // ...
}

// 改造后
import { useTranslation } from "react-i18next";

const ModalFooter = ({
    cancelLabel,
    okLabel,
    ...
}) => {
    const { t } = useTranslation("common");
    const finalCancelLabel = cancelLabel ?? t("actions.cancel");
    const finalOkLabel = okLabel ?? t("actions.ok");
    // ...
}
```

#### 步骤 3.2: 改造关键界面 (优先级:🔥高)

**文件列表:**
- `frontend/app/app.tsx` - 上下文菜单("Cut", "Copy", "Paste")
- `frontend/app/tab/tabbar.tsx` - 标签栏按钮和提示
- `frontend/app/modals/about.tsx` - 关于对话框
- `frontend/app/onboarding/onboarding.tsx` - 用户引导

**示例 - 关于对话框:**
```typescript
// frontend/app/modals/about.tsx
const AboutModal = () => {
    const { t } = useTranslation("common");
    return (
        <Modal>
            <div className="text-[25px]">{t("app.name")}</div>
            <div className="leading-5">
                {t("app.tagline")}
                <br />
                {t("app.description")}
            </div>
        </Modal>
    );
};
```

#### 步骤 3.3: 改造AI面板 (优先级:🔥高)
- 命名空间: `ai`
- 文件数: 12个TSX文件
- 包含: AI对话界面、工具使用提示、速率限制提示等

#### 步骤 3.4-3.6: 其他模块改造
- 设置界面 (`settings`)
- 编辑器和终端 (`editor`, `terminal`)
- 帮助和通知 (`help`, `notifications`)

**预期结果:**
- ✅ 所有组件完成国际化改造
- ✅ 无硬编码英文文本残留
- ✅ TypeScript类型检查通过

---

### 阶段 4: 语言切换功能实现 (4-6小时)

#### 步骤 4.1: 创建语言切换组件

**文件:** `frontend/app/element/language-switcher.tsx`

```typescript
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { memo } from "react";
import { useTranslation } from "react-i18next";

interface Language {
    code: string;
    name: string;
    nativeName: string;
}

const SUPPORTED_LANGUAGES: Language[] = [
    { code: "en", name: "English", nativeName: "English" },
    { code: "zh-CN", name: "Chinese Simplified", nativeName: "简体中文" },
];

const LanguageSwitcher = memo(() => {
    const { i18n } = useTranslation();

    const handleLanguageChange = (langCode: string) => {
        i18n.changeLanguage(langCode);
    };

    return (
        <div className="language-switcher">
            <select
                value={i18n.language}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="language-select"
            >
                {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                        {lang.nativeName}
                    </option>
                ))}
            </select>
        </div>
    );
});

LanguageSwitcher.displayName = "LanguageSwitcher";

export { LanguageSwitcher };
```

#### 步骤 4.2: 集成到设置页面
- 在 `frontend/app/view/waveconfig/waveconfig.tsx` 添加语言选择器
- 添加相应的样式

#### 步骤 4.3: 添加快捷切换入口
- 在主菜单或标签栏添加语言切换快捷方式

**预期结果:**
- ✅ 用户可在设置中切换语言
- ✅ 语言切换实时生效,无需刷新
- ✅ 用户选择保存到localStorage

---

### 阶段 5: 中文翻译填充 (10-15小时)

#### 步骤 5.1: 翻译通用文本
- 文件: `frontend/locales/zh-CN/common.json`
- 方法: 人工翻译 + AI辅助检查
- 预计: 100-150条

#### 步骤 5.2: 翻译各模块
- 逐个命名空间翻译
- 保持术语一致性

**术语对照表:**
| 英文 | 中文 | 说明 |
|------|------|------|
| Terminal | 终端 | - |
| Editor | 编辑器 | - |
| Workspace | 工作区 | - |
| Tab | 标签页 | - |
| Block | 块 | - |
| Connection | 连接 | - |
| Settings | 设置 | - |
| Preview | 预览 | - |

#### 步骤 5.3: 翻译质量检查
- ✅ 所有key都有对应翻译
- ✅ 翻译符合中文表达习惯
- ✅ 专业术语统一
- ✅ 长度适配UI布局

---

### 阶段 6: 测试与优化 (6-8小时)

#### 功能测试清单
- [ ] 语言切换实时生效
- [ ] 刷新后语言设置保持
- [ ] 系统语言自动检测正确
- [ ] 所有界面文本正确显示
- [ ] 无遗漏的硬编码文本

#### UI适配测试
- [ ] 中文文本长度适配布局
- [ ] 按钮、菜单不发生溢出
- [ ] 对话框标题和内容正常显示
- [ ] 移动端适配(如有)

#### 性能测试
- [ ] 语言切换响应速度 < 100ms
- [ ] 应用启动时间无明显增加
- [ ] 翻译文件加载不阻塞渲染

---

### 阶段 7: 文档和扩展支持 (3-4小时)

#### 步骤 7.1: 编写开发者文档
**文件:** `frontend/locales/README.md`

内容包括:
- i18n架构说明
- 如何添加新翻译key
- 如何添加新语言
- 命名规范和最佳实践

#### 步骤 7.2: 准备多语言扩展模板
- 支持的语言列表
- 如何贡献新语言翻译
- 翻译文件结构说明

---

## ⚠️ 注意事项与风险

### 1. TypeScript配置调整
需要在 `tsconfig.json` 中确保:
```json
{
  "compilerOptions": {
    "resolveJsonModule": true,
    "paths": {
      "@/locales/*": ["frontend/locales/*"]
    }
  }
}
```

### 2. Electron环境特殊处理
- 使用 `useSuspense: false` 避免加载问题
- 主进程和渲染进程需分别初始化i18n(如需要)

### 3. 性能优化建议
- 考虑懒加载命名空间(首屏只加载 `common`)
- 打包时排除未使用的语言文件

### 4. 代码质量保证
- 所有新增代码遵循项目Prettier规范
- 组件使用 `memo` 优化性能
- 使用 `forwardRef` 暴露ref
- 设置 `displayName` 便于调试

---

## 📊 工作量估算

| 阶段 | 工作量 | 复杂度 | 可并行 |
|------|--------|--------|--------|
| 阶段1: 基础架构 | 4-6h | 🔴 高 | ❌ |
| 阶段2: 翻译骨架 | 6-8h | 🟡 中 | ❌ |
| 阶段3: 组件改造 | 20-30h | 🔴 高 | ⚠️ 部分 |
| 阶段4: 语言切换 | 4-6h | 🟡 中 | ✅ |
| 阶段5: 中文翻译 | 10-15h | 🟢 低 | ✅ |
| 阶段6: 测试优化 | 6-8h | 🟡 中 | ❌ |
| 阶段7: 文档编写 | 3-4h | 🟢 低 | ✅ |
| **总计** | **53-77h** | - | - |

---

## ✅ 质量标准

### 代码质量要求
- ✅ 通过ESLint和TypeScript检查
- ✅ 符合Prettier格式化规范
- ✅ 无硬编码文本残留
- ✅ 组件性能无明显退化

### 翻译质量要求
- ✅ 翻译准确,符合语言习惯
- ✅ 术语统一,风格一致
- ✅ 覆盖率100%
- ✅ UI布局适配良好

### 用户体验要求
- ✅ 语言切换流畅(<100ms)
- ✅ 界面无闪烁或错位
- ✅ 默认语言检测准确
- ✅ 设置持久化可靠

---

## 🚀 后续扩展

### 添加新语言步骤
1. 在 `frontend/locales/` 创建语言目录(如 `ja/`)
2. 复制 `en/` 目录下所有JSON文件
3. 翻译所有文本内容
4. 在 `frontend/app/i18n/resources.ts` 导入新语言
5. 在 `language-switcher.tsx` 添加语言选项
6. 测试验证

### 潜在功能增强
- 🔮 支持语言包热更新
- 🔮 集成翻译管理平台(如Lokalise)
- 🔮 自动检测缺失翻译key
- 🔮 翻译覆盖率统计仪表板

---

## 📚 参考资料

- [react-i18next官方文档](https://react.i18next.com/)
- [i18next官方文档](https://www.i18next.com/)
- [TypeScript支持](https://react.i18next.com/latest/typescript)
- [Wave Terminal贡献指南](../CONTRIBUTING.md)

---

**文档维护:** 本文档应随项目演进持续更新

**最后更新:** 2025-12-12
