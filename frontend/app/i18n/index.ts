// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "@/app/i18n/i18n-next";
import { initLanguageFromSettings } from "./hooks";

initLanguageFromSettings();

export { useAppLanguage, useT } from "./hooks";
