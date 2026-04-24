(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 15000, intervalMs = 100) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await predicate();
      if (value) {
        return value;
      }
      await wait(intervalMs);
    }
    return null;
  };
  const historyMethods = [
    "loadInitialTerminalData",
    "processAndCacheData",
    "runProcessIdleTimeout",
    "persistTerminalState",
  ];
  const pxValue = (value) => {
    const parsed = Number.parseFloat(value ?? "");
    return Number.isFinite(parsed) ? parsed : null;
  };
  const rectToObject = (rect) => {
    if (!rect) {
      return null;
    }
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
    };
  };
  const getBlockIdForElement = (elem) => elem?.closest?.("[data-blockid]")?.dataset?.blockid ?? null;
  const describeElement = (elem) => {
    if (!elem) {
      return null;
    }
    return {
      tagName: elem.tagName ?? null,
      id: elem.id || null,
      className: typeof elem.className === "string" ? elem.className : null,
      role: elem.getAttribute?.("role") ?? null,
      blockId: getBlockIdForElement(elem),
    };
  };
  const describeElementChain = (elem, maxDepth = 8) => {
    const chain = [];
    let current = elem;
    for (let idx = 0; current && idx < maxDepth; idx += 1) {
      chain.push(describeElement(current));
      current = current.parentElement;
    }
    return chain;
  };
  const describeScrollContainers = (elem, maxDepth = 10) => {
    const containers = [];
    let current = elem;
    for (let idx = 0; current && idx < maxDepth; idx += 1) {
      const style = window.getComputedStyle(current);
      const scrollable = current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth;
      const overflowed = /(auto|scroll|overlay)/.test(`${style.overflow} ${style.overflowY} ${style.overflowX}`);
      if (scrollable || overflowed) {
        containers.push({
          ...describeElement(current),
          scrollTop: current.scrollTop ?? null,
          scrollHeight: current.scrollHeight ?? null,
          clientHeight: current.clientHeight ?? null,
          overflow: `${style.overflow}/${style.overflowY}/${style.overflowX}`,
          pointerEvents: style.pointerEvents ?? null,
        });
      }
      current = current.parentElement;
    }
    return containers;
  };
  const parseORefId = (oref) => {
    if (typeof oref !== "string") {
      return null;
    }
    const parts = oref.split(":");
    return parts.length > 1 ? parts.slice(1).join(":") : oref;
  };
  const getTabId = () => window.globalStore?.get?.(window.globalAtoms?.staticTabId) ?? null;
  const getBlockData = (blockId) => {
    if (!blockId || !window.WOS?.getWaveObjectAtom || !window.WOS?.makeORef || !window.globalStore?.get) {
      return null;
    }
    try {
      const atom = window.WOS.getWaveObjectAtom(window.WOS.makeORef("block", blockId));
      return window.globalStore.get(atom);
    } catch (error) {
      return null;
    }
  };
  const ensureTermRegistry = () => {
    if (window.__waveSmokeTermRegistry) {
      return window.__waveSmokeTermRegistry;
    }
    const registry = {
      seen: [],
      byBlockId: {},
      hooked: false,
      hookError: null,
      addWrap(wrap) {
        if (!wrap || !wrap.blockId || this.byBlockId[wrap.blockId]) {
          return;
        }
        this.byBlockId[wrap.blockId] = wrap;
        this.seen.push(wrap);
      },
      refreshFromLiveInstances() {
        const liveInstances = window.term?.constructor?.liveInstances;
        if (!(liveInstances instanceof Set)) {
          return;
        }
        for (const wrap of liveInstances) {
          this.addWrap(wrap);
        }
      },
    };
    registry.addWrap(window.term);
    registry.refreshFromLiveInstances();
    let currentValue = window.term;
    try {
      Object.defineProperty(window, "term", {
        configurable: true,
        enumerable: true,
        get() {
          return currentValue;
        },
        set(value) {
          currentValue = value;
          registry.addWrap(value);
        },
      });
      registry.hooked = true;
    } catch (error) {
      registry.hookError = error?.message ?? String(error);
    }
    window.__waveSmokeTermRegistry = registry;
    return registry;
  };

  const started = Date.now();
  await waitFor(() => window.term, 15000, 250);
  const summary = {
    href: location.href,
    title: document.title,
    hasTerm: !!window.term,
    waitedMs: Date.now() - started,
  };
  let createdInitialBlockId = null;
  if (!window.term) {
    summary.createdInitialTerm = {
      requested: true,
      tabId: getTabId(),
    };
    if (summary.createdInitialTerm.tabId && window.RpcApi && window.TabRpcClient) {
      try {
        const initialORef = await window.RpcApi.CreateBlockCommand(window.TabRpcClient, {
          tabid: summary.createdInitialTerm.tabId,
          blockdef: {
            meta: {
              view: "term",
              controller: "shell",
            },
          },
          focused: true,
          rtopts: {
            termsize: {
              rows: 25,
              cols: 80,
            },
          },
        });
        createdInitialBlockId = parseORefId(initialORef);
        summary.createdInitialTerm.createdORef = initialORef;
        summary.createdInitialTerm.createdBlockId = createdInitialBlockId;
        await waitFor(() => window.term, 15000, 250);
      } catch (error) {
        summary.createdInitialTerm.error = error?.message ?? String(error);
      }
    } else {
      summary.createdInitialTerm.error = "missing tabId, RpcApi or TabRpcClient";
    }
    summary.hasTerm = !!window.term;
    summary.waitedMs = Date.now() - started;
  }
  if (!window.term) {
    return summary;
  }

  const registry = ensureTermRegistry();
  const summarizeHelper = (elem) => ({
    exists: !!elem,
    top: elem?.style?.top || null,
    left: elem?.style?.left || null,
    width: elem?.style?.width || null,
    height: elem?.style?.height || null,
    lineHeight: elem?.style?.lineHeight || null,
    zIndex: elem?.style?.zIndex || null,
    rect: rectToObject(elem?.getBoundingClientRect?.()),
  });
  const summarizeWrap = (termWrap) => {
    if (!termWrap?.terminal) {
      return null;
    }
    const terminal = termWrap.terminal;
    const activeBuffer = terminal.buffer.active;
    const cell = terminal._core?._renderService?.dimensions?.css?.cell || {};
    const scrollDom =
      terminal._core?._viewport?._scrollableElement?._domNode ||
      termWrap.connectElem?.querySelector?.(".xterm-scrollable-element") ||
      null;
    const compositionView = termWrap.connectElem?.querySelector?.(".composition-view.active, .composition-view") || null;
    const shellState = termWrap.shellIntegrationStatusAtom ? window.globalStore?.get?.(termWrap.shellIntegrationStatusAtom) : null;
    const lastCommand = termWrap.lastCommandAtom ? window.globalStore?.get?.(termWrap.lastCommandAtom) : null;
    const claudeCodeActive = termWrap.claudeCodeActiveAtom ? window.globalStore?.get?.(termWrap.claudeCodeActiveAtom) : null;
    let shouldAnchorIme = null;
    try {
      shouldAnchorIme =
        typeof termWrap.shouldAnchorImeForAgentTui === "function" ? !!termWrap.shouldAnchorImeForAgentTui() : null;
    } catch (error) {
      shouldAnchorIme = null;
    }
    return {
      blockId: termWrap.blockId,
      loaded: !!termWrap.loaded,
      rows: terminal.rows ?? null,
      cols: terminal.cols ?? null,
      bufferType: activeBuffer?.type ?? null,
      mouseTrackingMode: terminal.modes?.mouseTrackingMode ?? null,
      cursorX: activeBuffer?.cursorX ?? null,
      cursorY: activeBuffer?.cursorY ?? null,
      viewportY: activeBuffer?.viewportY ?? null,
      baseY: activeBuffer?.baseY ?? null,
      length: activeBuffer?.length ?? null,
      historyMethodsPresent: historyMethods.filter((name) => typeof termWrap[name] === "function"),
      hasSerializeAddon: Object.prototype.hasOwnProperty.call(termWrap, "serializeAddon"),
      hasPtyOffset: Object.prototype.hasOwnProperty.call(termWrap, "ptyOffset"),
      heldDataLength: Array.isArray(termWrap.heldData) ? termWrap.heldData.length : null,
      cellHeight: cell.height ?? null,
      cellWidth: cell.width ?? null,
      scrollTop: scrollDom?.scrollTop ?? null,
      scrollHeight: scrollDom?.scrollHeight ?? null,
      clientHeight: scrollDom?.clientHeight ?? null,
      shellState,
      lastCommand,
      claudeCodeActive,
      shouldAnchorIme,
      textarea: summarizeHelper(terminal.textarea),
      composition: summarizeHelper(compositionView),
    };
  };
  const getTermDomRefs = (blockId) => {
    const blockElem = Array.from(document.querySelectorAll("[data-blockid]")).find(
      (elem) => elem.dataset?.blockid === blockId
    );
    const viewElem = blockElem?.querySelector?.(".view-term") || null;
    const connectElem = viewElem?.querySelector?.(".term-connectelem") || null;
    const xtermElem = connectElem?.querySelector?.(".xterm") || null;
    const screenElem =
      connectElem?.querySelector?.(".xterm-screen") ||
      connectElem?.querySelector?.(".xterm-rows") ||
      xtermElem ||
      connectElem ||
      null;
    const scrollableElem = connectElem?.querySelector?.(".xterm-scrollable-element") || null;
    const textarea = connectElem?.querySelector?.(".xterm-helper-textarea") || null;
    const composition = connectElem?.querySelector?.(".composition-view.active, .composition-view") || null;
    return {
      blockElem,
      viewElem,
      connectElem,
      xtermElem,
      screenElem,
      scrollableElem,
      textarea,
      composition,
    };
  };
  const getFocusState = () => {
    const activeElement = document.activeElement;
    const termElem = activeElement?.closest?.(".view-term");
    const focusedTerminalBlock = Array.from(document.querySelectorAll(".block-focused[data-blockid]")).find((elem) =>
      elem.querySelector(".view-term")
    );
    return {
      activeElement: describeElement(activeElement),
      blockId: getBlockIdForElement(activeElement),
      termBlockId: getBlockIdForElement(termElem || activeElement),
      appFocusedBlockIds: Array.from(document.querySelectorAll(".block-focused[data-blockid]")).map(
        (elem) => elem.dataset.blockid
      ),
      appFocusedTerminalBlockId: focusedTerminalBlock?.dataset?.blockid ?? null,
    };
  };
  const getActiveTerminal = () => {
    const focus = getFocusState();
    if (focus.termBlockId) {
      return { blockId: focus.termBlockId, source: "document.activeElement" };
    }
    if (focus.appFocusedTerminalBlockId) {
      return { blockId: focus.appFocusedTerminalBlockId, source: "block-focused" };
    }
    return { blockId: null, source: "unknown" };
  };
  const collectTerminals = () => {
    registry.refreshFromLiveInstances();
    const activeElement = document.activeElement;
    return Array.from(document.querySelectorAll(".view-term"))
      .map((viewElem, index) => {
      const blockElem = viewElem.closest("[data-blockid]");
      const blockId = blockElem?.dataset?.blockid ?? null;
      const refs = getTermDomRefs(blockId);
      const wrap = blockId ? registry.byBlockId[blockId] : null;
      const rect = viewElem.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(viewElem);
      return {
        index,
        blockId,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          computedStyle.display !== "none" &&
          computedStyle.visibility !== "hidden",
        geometry: rectToObject(rect),
        blockFocused: blockElem?.classList?.contains("block-focused") ?? false,
        activeElementInside: !!activeElement && !!refs.connectElem?.contains(activeElement),
        textarea: summarizeHelper(refs.textarea),
        composition: summarizeHelper(refs.composition),
        dom: {
          viewClass: typeof viewElem.className === "string" ? viewElem.className : null,
          connectClass: typeof refs.connectElem?.className === "string" ? refs.connectElem.className : null,
          xtermClass: typeof refs.xtermElem?.className === "string" ? refs.xtermElem.className : null,
          viewport: {
            scrollTop: refs.scrollableElem?.scrollTop ?? null,
            scrollHeight: refs.scrollableElem?.scrollHeight ?? null,
            clientHeight: refs.scrollableElem?.clientHeight ?? null,
          },
        },
        runtimeKnown: !!wrap,
        runtime: summarizeWrap(wrap),
      };
      })
      .sort((leftTerm, rightTerm) => {
        const topDelta = (leftTerm.geometry?.top ?? 0) - (rightTerm.geometry?.top ?? 0);
        if (Math.abs(topDelta) > 24) {
          return topDelta;
        }
        return (leftTerm.geometry?.left ?? 0) - (rightTerm.geometry?.left ?? 0);
      });
  };
  const captureStateMap = () => {
    const stateMap = {};
    for (const term of collectTerminals()) {
      if (!term.blockId) {
        continue;
      }
      stateMap[term.blockId] = {
        runtimeViewportY: term.runtime?.viewportY ?? null,
        domScrollTop: term.dom?.viewport?.scrollTop ?? null,
      };
    }
    return stateMap;
  };
  const diffStateMap = (before, after) => {
    const diff = {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const blockId of keys) {
      if (!blockId) {
        continue;
      }
      const beforeState = before[blockId] ?? {};
      const afterState = after[blockId] ?? {};
      const runtimeChanged =
        beforeState.runtimeViewportY !== null &&
        afterState.runtimeViewportY !== null &&
        beforeState.runtimeViewportY !== afterState.runtimeViewportY;
      const domChanged =
        beforeState.domScrollTop !== null &&
        afterState.domScrollTop !== null &&
        beforeState.domScrollTop !== afterState.domScrollTop;
      diff[blockId] = {
        runtimeBefore: beforeState.runtimeViewportY ?? null,
        runtimeAfter: afterState.runtimeViewportY ?? null,
        runtimeChanged,
        domBefore: beforeState.domScrollTop ?? null,
        domAfter: afterState.domScrollTop ?? null,
        domChanged,
        changed: runtimeChanged || domChanged,
      };
    }
    return diff;
  };
  const getChangedBlocks = (diff) =>
    Object.entries(diff)
      .filter(([, value]) => value.changed)
      .map(([blockId]) => blockId);
  const getTargetAtCenter = (blockId) => {
    const refs = getTermDomRefs(blockId);
    const baseElem = refs.screenElem || refs.xtermElem || refs.connectElem;
    const rect = baseElem?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return {
        element: refs.connectElem || refs.xtermElem || baseElem || null,
        clientX: null,
        clientY: null,
      };
    }
    const clientX = rect.left + Math.max(2, Math.min(rect.width - 2, rect.width / 2));
    const clientY = rect.top + Math.max(2, Math.min(rect.height - 2, rect.height / 2));
    return {
      element: document.elementFromPoint(clientX, clientY) || baseElem,
      clientX,
      clientY,
    };
  };
  const getTargetAtPoint = (blockId, pointName) => {
    const refs = getTermDomRefs(blockId);
    const screenRect = refs.screenElem?.getBoundingClientRect?.();
    const viewRect = refs.viewElem?.getBoundingClientRect?.();
    const scrollRect = refs.scrollableElem?.getBoundingClientRect?.();
    const fallbackRect = refs.connectElem?.getBoundingClientRect?.();
    const rect =
      pointName === "view-right"
        ? viewRect || fallbackRect
        : pointName === "scrollbar-center"
          ? scrollRect || screenRect || fallbackRect
          : screenRect || fallbackRect;
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return {
        pointName,
        element: refs.connectElem || refs.xtermElem || refs.viewElem || null,
        clientX: null,
        clientY: null,
        hit: null,
        chain: [],
        scrollContainers: [],
      };
    }
    const clientY = rect.top + Math.max(2, Math.min(rect.height - 2, rect.height / 2));
    const clientX =
      pointName === "screen-right" || pointName === "view-right"
        ? rect.right - Math.min(8, Math.max(2, rect.width / 4))
        : rect.left + Math.max(2, Math.min(rect.width - 2, rect.width / 2));
    const element = document.elementFromPoint(clientX, clientY) || refs.connectElem || refs.xtermElem || refs.viewElem || null;
    return {
      pointName,
      element,
      clientX,
      clientY,
      hit: describeElement(element),
      chain: describeElementChain(element),
      scrollContainers: describeScrollContainers(element),
      rect: rectToObject(rect),
    };
  };
  const dispatchMouseSequence = (element, clientX, clientY) => {
    if (!element) {
      return;
    }
    for (const eventName of ["pointerdown", "mousedown", "mouseup", "click"]) {
      const EventCtor =
        eventName.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      const event = new EventCtor(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: clientX ?? 0,
        clientY: clientY ?? 0,
        button: 0,
        buttons: 1,
      });
      element.dispatchEvent(event);
    }
  };
  const activateTerminal = async (blockId) => {
    const refs = getTermDomRefs(blockId);
    const target = getTargetAtCenter(blockId);
    dispatchMouseSequence(target.element || refs.connectElem || refs.blockElem, target.clientX, target.clientY);
    refs.textarea?.focus?.();
    await wait(120);
    return getFocusState();
  };
  const seedScrollback = async (termWrap, prefix) => {
    if (!termWrap?.terminal) {
      return;
    }
    const output = Array.from({ length: 180 }, (_, idx) => `${prefix}-${idx}`).join("\r\n") + "\r\n";
    await new Promise((resolve) => termWrap.terminal.write(output, resolve));
    termWrap.terminal.scrollToBottom();
    await wait(80);
  };
  const createSplitTerminal = async (sourceBlockId, targetAction = "splitright") => {
    const tabId = getTabId();
    if (!tabId || !sourceBlockId || !window.RpcApi || !window.TabRpcClient) {
      return { blockId: null, error: "missing tabId, sourceBlockId, RpcApi or TabRpcClient" };
    }
    const blockData = getBlockData(sourceBlockId);
    const blockMeta = { ...(blockData?.meta || {}) };
    if (!blockMeta.view) {
      blockMeta.view = "term";
    }
    if (!blockMeta.controller) {
      blockMeta.controller = "shell";
    }
    const oref = await window.RpcApi.CreateBlockCommand(window.TabRpcClient, {
      tabid: tabId,
      blockdef: {
        meta: blockMeta,
      },
      focused: true,
      targetblockid: sourceBlockId,
      targetaction: targetAction,
      rtopts: {
        termsize: {
          rows: 25,
          cols: 80,
        },
      },
    });
    const blockId = parseORefId(oref);
    await waitFor(() => {
      registry.refreshFromLiveInstances();
      return !!registry.byBlockId[blockId] && !!getTermDomRefs(blockId).viewElem;
    }, 12000, 150);
    return { blockId, oref };
  };
  const selectDiagnosticTarget = (terminals) => {
    const visibleKnown = terminals.filter((term) => term.visible && term.runtimeKnown);
    const agentLike = visibleKnown.find((term) => {
      const lastCommand = `${term.runtime?.lastCommand ?? ""}`.toLowerCase();
      return !!term.runtime?.shouldAnchorIme || !!term.runtime?.claudeCodeActive || /\b(codex|claude|opencode|aider|gemini|qwen)\b/.test(lastCommand);
    });
    if (agentLike) {
      return { blockId: agentLike.blockId, reason: "agent_like_runtime" };
    }
    if (visibleKnown.length >= 3) {
      return { blockId: visibleKnown[Math.floor(visibleKnown.length / 2)].blockId, reason: "middle_visible_terminal" };
    }
    const focused = visibleKnown.find((term) => term.activeElementInside || term.blockFocused);
    if (focused) {
      return { blockId: focused.blockId, reason: "focused_terminal" };
    }
    return { blockId: visibleKnown[0]?.blockId ?? null, reason: "first_visible_terminal" };
  };
  const getStateForBlock = (state, blockId) => state?.[blockId] ?? {};
  const diagnoseLiveWheelPoint = (targetBlockId, pointInfo, before, during, afterStop, defaultPrevented) => {
    const duringDiff = diffStateMap(before, during);
    const afterStopDiff = diffStateMap(before, afterStop);
    const duringChanged = getChangedBlocks(duringDiff);
    const afterStopChanged = getChangedBlocks(afterStopDiff);
    const wrongDuringChanged = duringChanged.filter((blockId) => blockId !== targetBlockId);
    const hitBlockId = pointInfo?.hit?.blockId ?? null;
    const targetBefore = getStateForBlock(before, targetBlockId);
    let diagnosis = "ok";
    if (hitBlockId && hitBlockId !== targetBlockId) {
      diagnosis = "live_hit_wrong_block";
    } else if ((targetBefore.runtimeViewportY ?? 0) <= 0 && (targetBefore.domScrollTop ?? 0) <= 0) {
      diagnosis = "live_no_scrollback";
    } else if (wrongDuringChanged.length > 0) {
      diagnosis = "live_wrong_terminal";
    } else if (!duringChanged.includes(targetBlockId) && defaultPrevented) {
      diagnosis = "live_consumed_without_scroll";
    } else if (!duringChanged.includes(targetBlockId)) {
      diagnosis = "live_no_scroll";
    } else if (!afterStopChanged.includes(targetBlockId)) {
      diagnosis = "live_scrolled_then_snapped_back";
    }
    return {
      diagnosis,
      duringChanged,
      afterStopChanged,
      wrongDuringChanged,
      pass: diagnosis === "ok",
    };
  };
  const runLiveOutputWheelScenario = async (targetBlockId, label) => {
    const targetWrap = registry.byBlockId[targetBlockId];
    if (!targetWrap?.terminal) {
      return {
        label,
        targetBlockId,
        diagnosis: "live_missing_runtime",
        pass: false,
      };
    }
    await activateTerminal(targetBlockId);
    await seedScrollback(targetWrap, `live-${label}`);
    const pointNames = ["screen-center", "screen-right", "view-right", "scrollbar-center"];
    let intervalId = null;
    let writeCount = 0;
    const timeline = [];
    const captureTick = (tickLabel) => {
      timeline.push({
        label: tickLabel,
        ts: Date.now(),
        state: captureStateMap(),
        focus: getFocusState(),
        active: getActiveTerminal(),
        imeOwnerBlockId: window.term?.constructor?.imeOwnerBlockId ?? null,
      });
      if (timeline.length > 18) {
        timeline.shift();
      }
    };
    captureTick("start");
    intervalId = setInterval(() => {
      writeCount += 1;
      targetWrap.terminal.write(`diag-live-${label}-${writeCount}-${"x".repeat(72)}\r\n`);
      if (writeCount % 3 === 0) {
        captureTick(`tick-${writeCount}`);
      }
    }, 80);
    await wait(180);
    const pointResults = [];
    for (const pointName of pointNames) {
      const pointInfo = getTargetAtPoint(targetBlockId, pointName);
      const before = captureStateMap();
      const event = pointInfo.element
        ? new WheelEvent("wheel", {
            deltaY: -720,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
            clientX: pointInfo.clientX ?? 0,
            clientY: pointInfo.clientY ?? 0,
          })
        : null;
      pointInfo.element?.dispatchEvent(event);
      await wait(180);
      const during = captureStateMap();
      await wait(260);
      const afterStop = captureStateMap();
      pointResults.push({
        pointName,
        pointInfo,
        before,
        during,
        afterStop,
        defaultPrevented: event?.defaultPrevented ?? false,
        ...diagnoseLiveWheelPoint(targetBlockId, pointInfo, before, during, afterStop, event?.defaultPrevented ?? false),
      });
    }
    clearInterval(intervalId);
    captureTick("stop");
    return {
      label,
      targetBlockId,
      writeCount,
      target: selectDiagnosticTarget(collectTerminals()),
      pointResults,
      timeline,
      pass: pointResults.every((result) => result.pass),
      diagnoses: Array.from(new Set(pointResults.map((result) => result.diagnosis))),
    };
  };
  const runImeOwnershipSnapshotScenario = async (targetBlockId, label) => {
    const targetWrap = registry.byBlockId[targetBlockId];
    if (!targetWrap?.terminal) {
      return {
        label,
        targetBlockId,
        diagnosis: "ime_live_missing_runtime",
        pass: false,
      };
    }
    await activateTerminal(targetBlockId);
    const snapshots = [];
    const takeSnapshot = (snapshotLabel) => {
      for (const wrap of Object.values(registry.byBlockId)) {
        wrap?.syncImePositionForAgentTui?.();
      }
      const terminals = collectTerminals();
      const styledBlocks = terminals
        .filter((term) => hasVisibleImeOverride(term.textarea) || hasVisibleImeOverride(term.composition))
        .map((term) => term.blockId);
      const wrongStyledBlocks = styledBlocks.filter((blockId) => blockId !== targetBlockId);
      const targetRuntime = summarizeWrap(registry.byBlockId[targetBlockId]);
      snapshots.push({
        label: snapshotLabel,
        focus: getFocusState(),
        active: getActiveTerminal(),
        imeOwnerBlockId: window.term?.constructor?.imeOwnerBlockId ?? null,
        targetShouldAnchorIme: targetRuntime?.shouldAnchorIme ?? null,
        styledBlocks,
        wrongStyledBlocks,
        terminals: terminals.map((term) => ({
          blockId: term.blockId,
          textarea: term.textarea,
          composition: term.composition,
          runtime: {
            cursorX: term.runtime?.cursorX ?? null,
            cursorY: term.runtime?.cursorY ?? null,
            cellHeight: term.runtime?.cellHeight ?? null,
            cellWidth: term.runtime?.cellWidth ?? null,
            shouldAnchorIme: term.runtime?.shouldAnchorIme ?? null,
          },
        })),
      });
    };
    let intervalId = null;
    intervalId = setInterval(() => {
      targetWrap.terminal.write(`ime-live-${label}-${Date.now()}\r\n`);
    }, 110);
    takeSnapshot("start");
    await wait(180);
    takeSnapshot("mid-1");
    await wait(180);
    takeSnapshot("mid-2");
    await wait(180);
    takeSnapshot("mid-3");
    clearInterval(intervalId);
    takeSnapshot("stop");
    const targetSnapshots = snapshots.filter((snapshot) => snapshot.targetShouldAnchorIme);
    let diagnosis = "ime_live_not_applicable";
    if (targetSnapshots.length > 0) {
      if (targetSnapshots.some((snapshot) => snapshot.wrongStyledBlocks.length > 0)) {
        diagnosis = "ime_live_wrong_terminal";
      } else if (targetSnapshots.some((snapshot) => !snapshot.styledBlocks.includes(targetBlockId))) {
        diagnosis = "ime_live_not_anchored";
      } else {
        diagnosis = "ok";
      }
    }
    return {
      label,
      targetBlockId,
      snapshots,
      diagnosis,
      pass: diagnosis === "ok" || diagnosis === "ime_live_not_applicable",
    };
  };
  const hasVisibleImeOverride = (helper) => {
    if (!helper) {
      return false;
    }
    const zIndex = pxValue(helper.zIndex);
    if (zIndex !== null) {
      return zIndex >= 0;
    }
    return [helper.top, helper.left, helper.width, helper.height, helper.lineHeight].some(
      (value) => typeof value === "string" && value.length > 0
    );
  };

  const runWheelScenario = async (targetBlockId, label) => {
    const targetWrap = registry.byBlockId[targetBlockId];
    await activateTerminal(targetBlockId);
    await seedScrollback(targetWrap, `wheel-${label}`);
    const focusBefore = getFocusState();
    const activeBefore = getActiveTerminal();
    const outerTarget = getTargetAtCenter(targetBlockId);
    const beforeOuter = captureStateMap();
    const outerEvent = outerTarget.element
      ? new WheelEvent("wheel", {
          deltaY: -720,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
          clientX: outerTarget.clientX ?? 0,
          clientY: outerTarget.clientY ?? 0,
        })
      : null;
    outerTarget.element?.dispatchEvent(outerEvent);
    await wait(120);
    const afterOuter = captureStateMap();
    const outerDiff = diffStateMap(beforeOuter, afterOuter);
    const outerChangedBlocks = getChangedBlocks(outerDiff);

    targetWrap?.terminal?.scrollToBottom?.();
    await wait(60);
    const refs = getTermDomRefs(targetBlockId);
    const internalTarget =
      targetWrap?.terminal?._core?._viewport?._scrollableElement?._domNode || refs.scrollableElem || null;
    const beforeInternal = captureStateMap();
    const internalEvent = internalTarget
      ? new WheelEvent("wheel", {
          deltaY: -720,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
        })
      : null;
    internalTarget?.dispatchEvent(internalEvent);
    await wait(120);
    const afterInternal = captureStateMap();
    const internalDiff = diffStateMap(beforeInternal, afterInternal);
    const internalChangedBlocks = getChangedBlocks(internalDiff);

    const outerWrongBlocks = outerChangedBlocks.filter((blockId) => blockId !== targetBlockId);
    const targetBufferType = targetWrap?.terminal?.buffer?.active?.type ?? null;
    let diagnosis = "ok";
    if (focusBefore.termBlockId !== targetBlockId && activeBefore.blockId !== targetBlockId) {
      diagnosis = "wheel_focus_mismatch";
    } else if (targetBufferType !== "normal") {
      diagnosis = "wheel_non_normal_buffer";
    } else if (!outerChangedBlocks.includes(targetBlockId) && internalChangedBlocks.includes(targetBlockId)) {
      diagnosis = "wheel_route_problem";
    } else if (outerWrongBlocks.length > 0) {
      diagnosis = "wheel_wrong_terminal";
    } else if (!outerChangedBlocks.includes(targetBlockId) && !internalChangedBlocks.includes(targetBlockId)) {
      diagnosis = "wheel_no_scroll";
    }

    return {
      kind: "normal-scrollback",
      label,
      targetBlockId,
      focusBefore,
      activeBefore,
      targetBufferType,
      outer: {
        dispatchPath: "elementFromPoint",
        target: describeElement(outerTarget.element),
        before: beforeOuter,
        after: afterOuter,
        diff: outerDiff,
        changedBlocks: outerChangedBlocks,
        defaultPrevented: outerEvent?.defaultPrevented ?? false,
      },
      internal: {
        target: describeElement(internalTarget),
        before: beforeInternal,
        after: afterInternal,
        diff: internalDiff,
        changedBlocks: internalChangedBlocks,
        defaultPrevented: internalEvent?.defaultPrevented ?? false,
      },
      diagnosis,
      pass: diagnosis === "ok",
    };
  };
  const runAlternateWheelScenario = async (targetBlockId, label) => {
    const targetWrap = registry.byBlockId[targetBlockId];
    const originals = {
      sendDataHandler: targetWrap?.sendDataHandler,
      multiInputCallback: targetWrap?.multiInputCallback,
    };
    const capturedInput = [];
    try {
      await activateTerminal(targetBlockId);
      if (!targetWrap?.terminal) {
        return {
          kind: "alternate-input",
          label,
          targetBlockId,
          diagnosis: "alternate_missing_runtime",
          pass: false,
        };
      }
      targetWrap.sendDataHandler = (data) => capturedInput.push(data);
      targetWrap.multiInputCallback = (data) => capturedInput.push(data);
      await new Promise((resolve) => targetWrap.terminal.write("\x1b[?1049h", resolve));
      await wait(120);

      const focusBefore = getFocusState();
      const activeBefore = getActiveTerminal();
      const target = getTargetAtCenter(targetBlockId);
      const beforeState = summarizeWrap(targetWrap);
      const event = target.element
        ? new WheelEvent("wheel", {
            deltaY: -720,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
            clientX: target.clientX ?? 0,
            clientY: target.clientY ?? 0,
          })
        : null;
      target.element?.dispatchEvent(event);
      await wait(160);
      const afterState = summarizeWrap(targetWrap);
      const capturedText = capturedInput.join("");
      const arrowInputSent = capturedText.includes("\x1b[A") || capturedText.includes("\x1bOA");

      let diagnosis = "ok";
      if (focusBefore.termBlockId !== targetBlockId && activeBefore.blockId !== targetBlockId) {
        diagnosis = "alternate_wheel_focus_mismatch";
      } else if (beforeState?.bufferType !== "alternate") {
        diagnosis = "alternate_setup_failed";
      } else if (!arrowInputSent) {
        diagnosis = "alternate_wheel_no_arrow_input";
      }

      return {
        kind: "alternate-input",
        label,
        targetBlockId,
        focusBefore,
        activeBefore,
        target: describeElement(target.element),
        before: beforeState,
        after: afterState,
        capturedInput,
        arrowInputSent,
        defaultPrevented: event?.defaultPrevented ?? false,
        diagnosis,
        pass: diagnosis === "ok",
      };
    } finally {
      if (targetWrap) {
        targetWrap.sendDataHandler = originals.sendDataHandler;
        targetWrap.multiInputCallback = originals.multiInputCallback;
        if (targetWrap.terminal?.buffer?.active?.type === "alternate") {
          await new Promise((resolve) => targetWrap.terminal.write("\x1b[?1049l", resolve));
          await wait(80);
        }
        targetWrap.terminal?.scrollToBottom?.();
      }
    }
  };
  const runMouseTrackingWheelScenario = async (targetBlockId, label) => {
    const targetWrap = registry.byBlockId[targetBlockId];
    const originals = {
      sendDataHandler: targetWrap?.sendDataHandler,
      multiInputCallback: targetWrap?.multiInputCallback,
    };
    const capturedInput = [];
    try {
      await activateTerminal(targetBlockId);
      if (!targetWrap?.terminal) {
        return {
          kind: "mouse-tracking-wheel",
          label,
          targetBlockId,
          diagnosis: "mouse_tracking_missing_runtime",
          pass: false,
        };
      }
      targetWrap.sendDataHandler = (data) => capturedInput.push(data);
      targetWrap.multiInputCallback = (data) => capturedInput.push(data);
      await new Promise((resolve) => targetWrap.terminal.write("\x1b[?1049h\x1b[?1003h\x1b[?1006h", resolve));
      await wait(120);

      const focusBefore = getFocusState();
      const activeBefore = getActiveTerminal();
      const target = getTargetAtCenter(targetBlockId);
      const beforeState = summarizeWrap(targetWrap);
      const event = target.element
        ? new WheelEvent("wheel", {
            deltaY: -720,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
            clientX: target.clientX ?? 0,
            clientY: target.clientY ?? 0,
          })
        : null;
      target.element?.dispatchEvent(event);
      await wait(160);

      const afterState = summarizeWrap(targetWrap);
      const capturedText = capturedInput.join("");
      const mouseSequenceSent = capturedText.includes("\x1b[<");
      const arrowInputSent = capturedText.includes("\x1b[A") || capturedText.includes("\x1bOA");
      let diagnosis = "ok";
      if (focusBefore.termBlockId !== targetBlockId && activeBefore.blockId !== targetBlockId) {
        diagnosis = "mouse_tracking_focus_mismatch";
      } else if (beforeState?.bufferType !== "alternate" || beforeState?.mouseTrackingMode === "none") {
        diagnosis = "mouse_tracking_setup_failed";
      } else if (!mouseSequenceSent) {
        diagnosis = arrowInputSent ? "mouse_tracking_sent_arrow_instead_of_mouse" : "mouse_tracking_no_mouse_input";
      }

      return {
        kind: "mouse-tracking-wheel",
        label,
        targetBlockId,
        focusBefore,
        activeBefore,
        target: describeElement(target.element),
        before: beforeState,
        after: afterState,
        capturedInput,
        mouseSequenceSent,
        arrowInputSent,
        defaultPrevented: event?.defaultPrevented ?? false,
        diagnosis,
        pass: diagnosis === "ok",
      };
    } finally {
      if (targetWrap) {
        targetWrap.sendDataHandler = originals.sendDataHandler;
        targetWrap.multiInputCallback = originals.multiInputCallback;
        await new Promise((resolve) => targetWrap.terminal.write("\x1b[?1006l\x1b[?1003l\x1b[?1049l", resolve));
        await wait(80);
        targetWrap.terminal?.scrollToBottom?.();
      }
    }
  };
  const runImeScenario = async (targetBlockId, label, blockIdsToCheck) => {
    const wraps = blockIdsToCheck.map((blockId) => registry.byBlockId[blockId]).filter(Boolean);
    const originals = wraps.map((wrap) => ({
      wrap,
      shouldAnchor: wrap.shouldAnchorImeForAgentTui,
    }));
    try {
      await activateTerminal(targetBlockId);
      for (const item of originals) {
        item.wrap.shouldAnchorImeForAgentTui = () => item.wrap.blockId === targetBlockId;
      }
      for (const item of originals) {
        item.wrap.syncImePositionForAgentTui?.();
      }
      await wait(120);

      const terminals = collectTerminals();
      const focus = getFocusState();
      const active = getActiveTerminal();
      const targetTerminal = terminals.find((term) => term.blockId === targetBlockId) ?? null;
      const runtimeState = summarizeWrap(registry.byBlockId[targetBlockId]);
      const expectedTop =
        runtimeState?.cursorY !== null && runtimeState?.cellHeight !== null
          ? runtimeState.cursorY * runtimeState.cellHeight
          : null;
      const expectedLeft =
        runtimeState?.cursorX !== null && runtimeState?.cellWidth !== null
          ? runtimeState.cursorX * runtimeState.cellWidth
          : null;
      const actualTop = pxValue(targetTerminal?.textarea?.top);
      const actualLeft = pxValue(targetTerminal?.textarea?.left);
      const topDelta = actualTop !== null && expectedTop !== null ? Math.abs(actualTop - expectedTop) : null;
      const leftDelta = actualLeft !== null && expectedLeft !== null ? Math.abs(actualLeft - expectedLeft) : null;
      const aligned = topDelta !== null && leftDelta !== null && topDelta <= 1 && leftDelta <= 1;
      const styledBlocks = terminals
        .filter((term) => hasVisibleImeOverride(term.textarea) || hasVisibleImeOverride(term.composition))
        .map((term) => term.blockId);
      const wrongStyledBlocks = styledBlocks.filter((blockId) => blockId !== targetBlockId);

      let diagnosis = "ok";
      if (focus.termBlockId !== targetBlockId && active.blockId !== targetBlockId) {
        diagnosis = "ime_focus_mismatch";
      } else if (!styledBlocks.includes(targetBlockId)) {
        diagnosis = "ime_not_anchored";
      } else if (wrongStyledBlocks.length > 0) {
        diagnosis = "ime_wrong_terminal";
      } else if (!aligned) {
        diagnosis = "ime_cursor_misaligned";
      }

      return {
        label,
        targetBlockId,
        focus,
        active,
        styledBlocks,
        wrongStyledBlocks,
        expectedTop,
        expectedLeft,
        actualTop,
        actualLeft,
        topDelta,
        leftDelta,
        aligned,
        targetTextarea: targetTerminal?.textarea ?? null,
        targetComposition: targetTerminal?.composition ?? null,
        diagnosis,
        pass: diagnosis === "ok",
        terminals: terminals.map((term) => ({
          blockId: term.blockId,
          activeElementInside: term.activeElementInside,
          textarea: {
            top: term.textarea.top,
            left: term.textarea.left,
            zIndex: term.textarea.zIndex,
          },
          composition: {
            top: term.composition.top,
            left: term.composition.left,
            zIndex: term.composition.zIndex,
          },
        })),
      };
    } finally {
      for (const item of originals) {
        item.wrap.shouldAnchorImeForAgentTui = item.shouldAnchor;
      }
      for (const item of originals) {
        item.wrap.syncImePositionForAgentTui?.();
      }
      await wait(60);
    }
  };

  const primaryWrap = window.term;
  const initialTerminals = collectTerminals();
  let createdBlockId = null;
  let createdORef = null;
  const diagnosticCreatedBlockIds = [];

  if (Object.keys(registry.byBlockId).length < 2) {
    const sourceBlockId = primaryWrap?.blockId ?? initialTerminals[0]?.blockId ?? null;
    summary.createdSplit = {
      requested: true,
      tabId: getTabId(),
      sourceBlockId,
      initialDomCount: initialTerminals.length,
    };
    if (summary.createdSplit.tabId && sourceBlockId && window.RpcApi && window.TabRpcClient) {
      try {
        const blockData = getBlockData(sourceBlockId);
        const blockMeta = { ...(blockData?.meta || {}) };
        if (!blockMeta.view) {
          blockMeta.view = "term";
        }
        if (!blockMeta.controller) {
          blockMeta.controller = "shell";
        }
        createdORef = await window.RpcApi.CreateBlockCommand(window.TabRpcClient, {
          tabid: summary.createdSplit.tabId,
          blockdef: {
            meta: blockMeta,
          },
          focused: true,
          targetblockid: sourceBlockId,
          targetaction: "splitdown",
          rtopts: {
            termsize: {
              rows: 25,
              cols: 80,
            },
          },
        });
        createdBlockId = parseORefId(createdORef);
        summary.createdSplit.createdORef = createdORef;
        summary.createdSplit.createdBlockId = createdBlockId;
        await waitFor(() => {
          const domCount = document.querySelectorAll(".view-term").length;
          return domCount >= Math.max(2, initialTerminals.length + 1) && !!registry.byBlockId[createdBlockId];
        }, 12000, 150);
      } catch (error) {
        summary.createdSplit.error = error?.message ?? String(error);
      }
    } else {
      summary.createdSplit.error = "missing tabId, sourceBlockId, RpcApi or TabRpcClient";
    }
    summary.createdSplit.finalKnownBlockIds = Object.keys(registry.byBlockId);
    summary.createdSplit.finalDomCount = document.querySelectorAll(".view-term").length;
    summary.createdSplit.runtimeKnown = createdBlockId ? !!registry.byBlockId[createdBlockId] : false;
  } else {
    summary.createdSplit = {
      requested: false,
      reason: "already_have_multiple_known_terminals",
      initialDomCount: initialTerminals.length,
      finalDomCount: initialTerminals.length,
      finalKnownBlockIds: Object.keys(registry.byBlockId),
    };
  }

  const scenarioBlockIds = Array.from(new Set([primaryWrap?.blockId, createdBlockId, ...Object.keys(registry.byBlockId)]))
    .filter(Boolean)
    .slice(0, 2);

  for (const blockId of scenarioBlockIds) {
    await seedScrollback(registry.byBlockId[blockId], `seed-${blockId}`);
  }

  const wheelScenarios = [];
  const alternateWheelScenarios = [];
  const mouseTrackingWheelScenarios = [];
  const imeScenarios = [];
  if (scenarioBlockIds.length >= 2) {
    for (let index = 0; index < scenarioBlockIds.length; index += 1) {
      wheelScenarios.push(await runWheelScenario(scenarioBlockIds[index], `term-${index + 1}`));
    }
    for (let index = 0; index < scenarioBlockIds.length; index += 1) {
      alternateWheelScenarios.push(await runAlternateWheelScenario(scenarioBlockIds[index], `term-${index + 1}`));
    }
    for (let index = 0; index < scenarioBlockIds.length; index += 1) {
      mouseTrackingWheelScenarios.push(await runMouseTrackingWheelScenario(scenarioBlockIds[index], `term-${index + 1}`));
    }
    for (let index = 0; index < scenarioBlockIds.length; index += 1) {
      imeScenarios.push(await runImeScenario(scenarioBlockIds[index], `term-${index + 1}`, scenarioBlockIds));
    }
  }

  let diagnosticTarget = null;
  const visibleKnownBeforeDiagnostic = collectTerminals().filter((term) => term.visible && term.runtimeKnown);
  if (visibleKnownBeforeDiagnostic.length < 3) {
    let sourceBlockId = primaryWrap?.blockId ?? visibleKnownBeforeDiagnostic[0]?.blockId ?? null;
    while (sourceBlockId && collectTerminals().filter((term) => term.visible && term.runtimeKnown).length < 3) {
      try {
        const created = await createSplitTerminal(sourceBlockId, "splitright");
        if (!created?.blockId) {
          break;
        }
        diagnosticCreatedBlockIds.push(created.blockId);
        sourceBlockId = created.blockId;
        await wait(240);
      } catch (error) {
        summary.diagnosticCreateError = error?.message ?? String(error);
        break;
      }
    }
  }
  diagnosticTarget = selectDiagnosticTarget(collectTerminals());
  const liveWheelScenario = diagnosticTarget?.blockId
    ? await runLiveOutputWheelScenario(diagnosticTarget.blockId, "continuous-middle")
    : null;
  const imeOwnershipLiveScenario = diagnosticTarget?.blockId
    ? await runImeOwnershipSnapshotScenario(diagnosticTarget.blockId, "continuous-middle")
    : null;

  summary.term = summarizeWrap(primaryWrap);
  summary.registry = {
    hooked: registry.hooked,
    hookError: registry.hookError,
    seenCount: registry.seen.length,
    knownBlockIds: Object.keys(registry.byBlockId),
  };
  summary.knownTerminalCount = Object.keys(registry.byBlockId).length;
  summary.focusOwner = getFocusState();
  summary.activeTerminal = getActiveTerminal();
  summary.terminals = collectTerminals();
  summary.scenarioBlockIds = scenarioBlockIds;
  summary.diagnostic = {
    target: diagnosticTarget,
    visibleKnownCount: collectTerminals().filter((term) => term.visible && term.runtimeKnown).length,
    createdBlockIds: diagnosticCreatedBlockIds,
    liveWheel: liveWheelScenario,
    imeOwnershipLive: imeOwnershipLiveScenario,
  };
  summary.wheel = {
    scenarios: [...wheelScenarios, ...alternateWheelScenarios, ...mouseTrackingWheelScenarios],
    normalScenarios: wheelScenarios,
    alternateScenarios: alternateWheelScenarios,
    mouseTrackingScenarios: mouseTrackingWheelScenarios,
    allPassed:
      wheelScenarios.length >= 2 &&
      alternateWheelScenarios.length >= 2 &&
      mouseTrackingWheelScenarios.length >= 2 &&
      wheelScenarios.every((scenario) => scenario.pass) &&
      alternateWheelScenarios.every((scenario) => scenario.pass) &&
      mouseTrackingWheelScenarios.every((scenario) => scenario.pass),
    diagnoses: Array.from(
      new Set([...wheelScenarios, ...alternateWheelScenarios, ...mouseTrackingWheelScenarios].map((scenario) => scenario.diagnosis))
    ),
  };
  summary.ime = {
    scenarios: imeScenarios,
    allPassed: imeScenarios.length >= 2 && imeScenarios.every((scenario) => scenario.pass),
    diagnoses: Array.from(new Set(imeScenarios.map((scenario) => scenario.diagnosis))),
  };
  summary.cleanup = {
    createdBlockId: createdBlockId || createdInitialBlockId,
    createdBlockIds: Array.from(
      new Set([createdBlockId, createdInitialBlockId, ...diagnosticCreatedBlockIds].filter(Boolean))
    ),
    needsCleanup: !!createdBlockId || !!createdInitialBlockId || diagnosticCreatedBlockIds.length > 0,
  };
  summary.diagnostics = [];
  if (summary.terminals.length < 2) {
    summary.diagnostics.push("dom_terminal_count_lt_2");
  }
  if (summary.knownTerminalCount < 2) {
    summary.diagnostics.push("known_terminal_count_lt_2");
  }
  if (!summary.wheel.allPassed) {
    summary.diagnostics.push("wheel_check_failed");
  }
  if (!summary.ime.allPassed) {
    summary.diagnostics.push("ime_check_failed");
  }
  if (liveWheelScenario && !liveWheelScenario.pass) {
    summary.diagnostics.push("live_wheel_check_failed");
  }
  if (imeOwnershipLiveScenario && !imeOwnershipLiveScenario.pass) {
    summary.diagnostics.push("live_ime_check_failed");
  }

  return summary;
})()
