# Progress Log

## 褰撳墠浠诲姟

- `TASK-001`锛氶涔﹀叆鍙ｅ寮轰笌 Harness 鍒濆鍖?
## 褰撳墠闃舵

- `Verify`

鍙€夐樁娈碉細

- `Research`
- `Plan`
- `Implement`
- `Verify`

## 宸茬‘璁や簨瀹?
- 鍙充笂瑙掑揩鎹峰叆鍙ｆ潵鑷粯璁?widgets 閰嶇疆锛屼笉鏄崟鐙啓姝诲湪鏌愪釜鍥哄畾 header 涓?- 鐜版湁缃戦〉瀹瑰櫒缁熶竴鍩轰簬 Electron `webview`锛岄€傚悎缁х画澶嶇敤
- 鏈満宸叉敞鍐?`feishu://` 涓?`lark://` 鍗忚锛屽彲浣滀负鏈湴椋炰功 App 浼樺厛鍚姩璺緞
- 椋炰功瑙嗗浘宸叉帴鍏ユ湰鍦?App 鑷姩鍙戠幇銆佽矾寰勫彲閰嶇疆銆佺綉椤靛厹搴?- 椋炰功鏂扮獥鍙ｅ凡鏀逛负缁ф壙 `persist:feishu` 鍒嗗尯
- 鍙充笂瑙掑揩鎹峰叆鍙ｅ綋鍓嶉噰鐢ㄥ弻鍏ュ彛锛歚Feishu App` 涓?`Feishu Web`

## 褰撳墠淇敼

- `emain/emain-feishu.ts`
- `emain/emain-ipc.ts`
- `emain/preload.ts`
- `frontend/app/view/feishuview/feishuview.tsx`
- `frontend/app/view/feishuweb/feishuweb.tsx`
- `frontend/app/view/webview/webview.tsx`
- `frontend/app/view/webview/webviewenv.ts`
- `frontend/app/block/blockregistry.ts`
- `frontend/app/block/blockutil.tsx`
- `pkg/wconfig/defaultconfig/widgets.json`
- `pkg/wconfig/defaultconfig/settings.json`
- `pkg/wconfig/settingsconfig.go`
- `frontend/types/custom.d.ts`
- `frontend/types/gotypes.d.ts`
- `schema/settings.json`
- `AGENTS.md`
- `CLAUDE.md`
- `.harness/*`
- `scripts/verify.ps1`

## 鏈€鏂拌拷鍔?
- `2026-04-16 20:42`锛氬皢 Feishu App 鍏ュ彛鏀逛负鏈湴 App 鎺у埗鍗＄墖锛屽苟鏂板鈥滈殣钘忓崱鐗団€濇寜閽紱璇ユ寜閽彧鍏抽棴褰撳墠 Wave block锛屼笉鍏抽棴鏈湴椋炰功 App
- `2026-04-16 21:06`锛氫负 `Feishu Web` 杩藉姞椤甸潰鍐呭彸涓婅鎮诞鈥滈殣钘忓崱鐗団€濇寜閽紝閬垮厤 header 鎸夐挳琚竷灞€鎸ゆ帀鍚庣敤鎴锋棤娉曞叧闂崱鐗?- `2026-04-17`锛氭寜鐢ㄦ埛瑕佹眰鍥為€€棰濆閫氳搴旂敤鍏ュ彛锛屽彧淇濈暀椋炰功鐩稿叧鑳藉姏
- `2026-04-17`锛氬彸渚?`feishu / fei-web` widget 鏀逛负鍒囨崲琛屼负锛氳嫢褰撳墠 tab 宸叉湁瀵瑰簲鍗＄墖锛屽啀娆＄偣鍑诲浘鏍囦細鐩存帴鍏抽棴璇ョ被鍗＄墖

## 褰撳墠闃诲

- 椋炰功鐪熷疄鐧诲綍涓庤亰澶?smoke 闇€瑕佸彲鐢ㄨ处鍙锋€?- 闈?Windows 鐜涓嬬殑鏈湴 App 鑷姩鍙戠幇灏氭湭鍋氱湡鏈洪獙璇?- 褰撳墠浠撳簱杩愯鎬?smoke 杩樺彈鏈湴鍚姩鐜闃诲锛氱洿鎺ュ墠鍙板惎鍔?Electron 鏃讹紝`wavesrv` 浼氬洜 `WCLOUD_ENDPOINT` 缂哄け/鏃犳晥鑰岄€€鍑猴紝瀵艰嚧搴旂敤鏃犳硶绋冲畾鍋滅暀鍦ㄥ彲浜や簰鐣岄潰

## 涓嬩竴姝ユ渶灏忓姩浣?
1. 鍦ㄥ彲鐢ㄧ幆澧冧腑琛ュ仛鐪熷疄椋炰功鐧诲綍 / 鑱婂ぉ smoke
2. 纭鏄惁闇€瑕佷负鏈湴寮€鍙戠幆澧冭ˉ榻?`WCLOUD_ENDPOINT`

## 楠岃瘉璁板綍

- `2026-04-16 20:09`锛歚scripts/verify.ps1`锛岄€氳繃锛堝寘鍚?`git diff --check` 涓?`npm.cmd run build:dev`锛?- `2026-04-16 20:09`锛氬皾璇曚娇鐢?`agent-browser` + Electron CDP 鍋氭渶灏?smoke锛岄樆濉烇紱椤圭洰杩愯鏃?`wavesrv` 鎻愬墠閫€鍑猴紝鏃ュ織鏄剧ず `invalid wcloud endpoint, WCLOUD_ENDPOINT not set or invalid`
- `2026-04-16 20:42`锛歚npm.cmd run build:dev`锛岄€氳繃锛涘簲鐢ㄥ凡閲嶅惎鍒?`Wave (Dev)`
- `2026-04-16 22:00`锛歚scripts/verify.ps1`锛岄€氳繃锛堝寘鍚?`git diff --check` 涓?`npm.cmd run build:dev`锛?- `2026-04-16 22:05`锛歚C:\Users\yucohu\.config\waveterm-dev\widgets.json` 涓?`.harness/feature-list.json` 鍧囧彲姝ｅ父 `ConvertFrom-Json`
- `2026-04-16 22:05`锛氬凡閲嶅惎 `Wave (Dev)`锛屼富 Electron 杩涚▼ PID 涓?`21464`
- `2026-04-17`锛歚scripts/verify.ps1` 閫氳繃锛堝寘鍚?`git diff --check` 涓?`npm.cmd run build:dev`锛?- `2026-04-17`锛氬凡閲嶅惎 `Wave (Dev)`锛屼富 Electron 杩涚▼ PID 涓?`37632`
- `2026-04-17`锛歚npm.cmd run build:dev`锛岄€氳繃锛涘凡绉婚櫎棰濆閫氳搴旂敤鍏ュ彛鐩稿叧浠ｇ爜
- `2026-04-17`锛氭寜鐢ㄦ埛瑕佹眰瀹屾垚棰濆閫氳搴旂敤鍏ュ彛鍥為€€锛沗scripts/verify.ps1` 閫氳繃
- `2026-04-17`锛氬凡閲嶅惎 `Wave (Dev)`锛屼富 Electron 杩涚▼ PID 涓?`11996`

## 鍓╀綑椋庨櫓

- 椋炰功绔欑偣鐧诲綍/鑱婂ぉ寮圭獥閾捐矾鏄惁瀹屽叏绋冲畾锛屼粛闇€鐪熷疄璐﹀彿楠岃瘉
- `Feishu Web` 鎮诞鎸夐挳浠呰鐩栧綋鍓?block 鐨勫叧闂綋楠岋紝灏氭湭琛ュ厖鏇村椤靛唴蹇嵎鎿嶄綔
- 褰撳墠 smoke 缁撹鍙鐩栨瀯寤轰笌涓昏繘绋嬫棩蹇楋紝涓嶈鐩栫湡瀹炲彲浜や簰 UI 娴佺▼

## 2026-04-17 Packaging

- 鐗堟湰瑙勫垯鏂板涓?`YYYY.M.D-N`锛屽綋鍓嶆湰鍦板寘鐗堟湰宸插垏涓?`2026.4.17-1`
- 鏂板 Windows `buildVersion` 鏄犲皠锛屽畨瑁呭寘鏂囦欢鐗堟湰鍙槧灏勪负 `2026.4.17.1`
- 宸蹭骇鍑?`make/Wave-win32-x64-2026.4.17-1.exe` 涓?`make/Wave-win32-x64-2026.4.17-1.zip`
- 褰撳墠鐜缂哄皯 `task` / `go` / `zig`锛屾湰杞棤娉曟寜浠撳簱鏍囧噯瀹屾暣閲嶇紪鍚庣鐗堟湰閾撅紝鍙兘澶嶇敤鐜版湁 `dist/bin`
- 閫氳繃璁剧疆 `ELECTRON_BUILDER_NSIS_DIR` / `ELECTRON_BUILDER_NSIS_RESOURCES_DIR` 澶嶇敤浜嗘湰鏈?`manual-tools`锛岀粫杩囦簡 NSIS 鍦ㄧ嚎涓嬭浇璇佷功澶辫触
- `msi` 浠嶅彈 WiX 鍦ㄧ嚎涓嬭浇璇佷功澶辫触闃诲锛屾湭浜у嚭 `.msi`
- `make/win-unpacked/Wave.exe` 鐨勬枃浠剁増鏈粛鏄剧ず Electron `41.1.0`锛涜嫢瑕佸悓姝ユ垚鏃堕棿鐗堝彿锛岄渶瑕佹仮澶?`signAndEditExecutable` 渚濊禆閾炬垨琛ラ綈鏈満 `winCodeSign/rcedit`
## 2026-04-17 Startup Fix

- 宸插畾浣嶆寮忓寘鈥滄參鍚姩 / UI 鍍忔棫鐗堟湰 / 椋炰功鍏ュ彛鏈嚭鐜扳€濈殑鍏卞悓鏍瑰洜锛歚frontend/wave.ts` 涓?`preloadMonaco()` 璋冪敤浜嗘湭瀵煎叆鐨?`fireAndForget`
- 宸插湪 `frontend/wave.ts` 琛ュ洖 `@/util/util` 鐨?`fireAndForget` 瀵煎叆锛岄伩鍏?`initWave` 鍦ㄩ灞忓垵濮嬪寲鍚庢姏鍑?`ReferenceError`
- 宸叉墽琛?`scripts/verify.ps1`銆乣npm.cmd run build:prod`锛屽苟閲嶆柊鐢熸垚 `make/win-unpacked`銆乣make/Wave-win32-x64-2026.4.17-1.exe`銆乣make/Wave-win32-x64-2026.4.17-1.zip`
- 宸插惎鍔?`make/win-unpacked/Wave.exe` 澶嶆牳姝ｅ紡鐗堟棩蹇楋紱`2026-04-17 14:14` 杩欒疆鍚姩涓嶅啀鍑虹幇 `fireAndForget is not defined` / `Error in initWave`
- 褰撳墠榛樿 `widgets.json` 涓庢寮忕増鐢ㄦ埛閰嶇疆鍧囦笉鎷︽埅椋炰功鍏ュ彛锛氶粯璁ら厤缃粛鍖呭惈 `feishu` 涓?`fei-web`锛宍C:\Users\yucohu\.config\waveterm\widgets.json` 褰撳墠涓嶅瓨鍦?- 缁х画鎺掓煡鈥滄墦寮€鎱⑩€濇椂锛屽凡纭棣栧睆涓婚樆濉炵偣涔嬩竴鏄?`initBare()` 鎶?`setWindowInitStatus("ready")` 缁戝畾鍦?`document.fonts.ready` 涓婏紝瀵艰嚧涓荤獥鍙ｅ湪瀛椾綋鍏ㄩ儴鍔犺浇瀹屾垚鍓嶆棤娉曠户缁?`wave-init`
- 宸插皢 `frontend/wave.ts` 璋冩暣涓猴細瀛椾綋浠嶅湪鍚庡彴鍔犺浇锛屼絾 `ready` 鐘舵€侀€氳繃浜嬩欢寰幆绔嬪嵆涓婃姤锛屼笉鍐嶈瀛椾綋鍔犺浇鍗′綇涓荤獥鍙ｅ垵濮嬪寲锛涙湡闂存浘楠岃瘉鍒?`requestAnimationFrame()` 鍦ㄩ殣钘忛〉浼氳鑺傛祦锛屽凡鍥為€€涓?`setTimeout(..., 0)` 閬垮厤闅愯棌绐楀彛姝婚攣
- 姝ｅ紡鍖呮棩蹇楀姣旓細`2026-04-17 14:59` 鍩虹嚎浠?`waveterm-app starting` 鍒?`show window` 绾?`4.010s`锛宍tabview init` 涓?`1425ms`锛沗2026-04-17 15:11` 鏂扮増浠庡惎鍔ㄥ埌 `show window` 绾?`3.087s`锛屼富 `tabview init` 闄嶅埌 `781ms`
- 宸茶ˉ鍋氣€滃惎鍔ㄤ腑閲嶅鍙屽嚮鈥濋獙璇侊細`2026-04-17 15:12` 鏃ュ織鍑虹幇 `second-instance event`锛屼絾鏈啀鍑虹幇 `createNewWaveWindow` / `creating new window`锛屾渶缁堝彧鏄剧ず鎭㈠绐楀彛锛岃鏄庡惎鍔ㄤ腑浜屾鍚姩鏀惧ぇ鎱㈡劅鐨勯棶棰樹粛琚纭嫤鎴?## 2026-04-17 Widget Compatibility Fix

- 宸茬‘璁ゅ彸渚ч涔﹀叆鍙ｇ己澶辩殑鐩存帴鏍瑰洜涓嶆槸鍓嶇鏈墦鍖咃紝鑰屾槸姝ｅ紡鍖呬粛澶嶇敤鏃?`wavesrv`锛堟棩蹇楁樉绀?`wave version: 0.14.4 (202604151554)`锛夛紝鍏跺唴宓岄粯璁?`widgets.json` 鏃╀簬椋炰功鍏ュ彛鏀瑰姩
- 宸插湪 `frontend/app/workspace/widgets.tsx` 澧炲姞鍏煎閫昏緫锛氬綋鍓嶇鍖呯増鏈笌鍚庣 `fullConfig.version` 涓嶄竴鑷存椂锛屽洖閫€鍚堝苟鍓嶇鎵撳寘鍐呯疆鐨?`pkg/wconfig/defaultconfig/widgets.json`
- 宸查澶栧湪姝ｅ紡鐗堣繍琛屾椂閰嶇疆 `C:\Users\yucohu\.config\waveterm\widgets.json` 鍐欏叆 `defwidget@feishu` / `defwidget@feishuweb`锛岀‘淇濆綋鍓嶆満鍣ㄤ笂鐨勬寮忕増涔熻兘鎷垮埌椋炰功鍏ュ彛
- 宸查噸鏂版墽琛?`scripts/verify.ps1`銆乣npm.cmd run build:prod`銆乣electron-builder --win dir nsis zip`锛屽苟閲嶅惎 `make/win-unpacked/Wave.exe`

## 2026-04-17 Crash / History Follow-up

- 缁х画鎺掓煡鈥滃伓鍙戦棯閫€ + 鍘嗗彶璁板綍鏈繚瀛樷€濇椂锛屽凡鍦ㄥ墠绔粓绔鍣?`frontend/app/view/term/termwrap.ts` 瀹氫綅鍒颁竴涓珮姒傜巼鏍瑰洜锛歚runProcessIdleTimeout()` 閲囩敤閫掑綊 `setTimeout + requestIdleCallback`锛屼絾 `dispose()` 涔嬪墠娌℃湁鍙栨秷宸叉寕璧风殑 timeout / idle callback锛汿ermWrap 琚攢姣佸悗锛岃繖浜涘洖璋冧粛鍙兘缁х画鎵ц骞惰闂凡閲婃斁鐨?terminal / serialize addon锛屽睘浜庡吀鍨嬬殑鈥滈攢姣佸悗寮傛鍥炶皟缁х画璺戔€濋棶棰?- 鍚屼竴閾捐矾杩樺瓨鍦ㄦ寔涔呭寲鏃舵満鍋忔櫄鐨勯棶棰橈細缁堢鐘舵€佺紦瀛?`cache:term:full` 鍙細鍦ㄢ€滅疮璁¤緭鍑鸿秴杩囬槇鍊尖€濅笖鈥? 绉掑悗鎷垮埌 idle 鏃堕棿鈥濇椂淇濆瓨锛涘鏋滅獥鍙ｈ闅愯棌銆佸簲鐢ㄩ€€鍑恒€侀〉闈㈠嵏杞芥垨 renderer 寮傚父缁堟锛屾渶杩戜竴娈电粓绔姸鎬佹洿瀹规槗鏉ヤ笉鍙婅惤鐩?- 宸插湪 `frontend/app/view/term/termwrap.ts` 鍋氭渶灏忎慨澶嶏細鏂板 idle/timeout 鍙栨秷閫昏緫锛沗dispose()` 鍓嶅厛鍋氫竴娆″己鍒剁粓绔姸鎬佹寔涔呭寲锛涘苟鍦?`visibilitychange(hidden)` / `beforeunload` 鏃惰拷鍔犱竴娆″厹搴曚繚瀛橈紝闄嶄綆閫€鍑哄墠涓庡紓甯稿墠涓㈢姸鎬佹鐜?- 宸插湪 `emain/emain.ts` 澧炲姞 `render-process-gone` / `child-process-gone` 鏃ュ織锛屽悗缁嫢浠嶆湁闂€€锛屽彲鐩存帴浠庢寮忕増鏃ュ織閲岀湅鍒板叿浣撳穿婧冭繘绋嬬被鍨嬨€侀€€鍑虹爜鍜屽搴?`webContents`
- 褰撳墠鐜浠嶇己灏?`go` / `task` / `zig`锛屽洜姝ゅ儚 `pkg/filestore` 杩欑被鍚庣缂撳瓨鍒风洏鍛ㄦ湡鐨勬簮鐮佺骇浼樺寲锛屾湰杞棤娉曠紪璇戣繘姝ｅ紡鍖咃紱浠庝唬鐮佷笂鐪嬶紝鍚庣 blockfile 浠嶉噰鐢ㄥ紓姝?cache flush锛岃繖浠嶆槸鈥滄瀬绔穿婧冩椂鏈€杩戣緭鍑哄彲鑳戒涪澶扁€濈殑鍓╀綑楂樻鐜囩偣
- 宸叉墽琛?`npm.cmd run build:prod`銆乣scripts/verify.ps1`銆乣electron-builder --win dir`锛屽苟鍚姩 `make/win-unpacked/Wave.exe` 鍋氭寮忓寘鐑熸祴锛沗2026-04-17 15:26` 杩欒疆鏃ュ織鏄剧ず `waveterm-app starting`銆乣wavesrv ready signal received true 564 ms`銆乣show window ...`锛屾湭鍑虹幇鏂扮殑棣栧睆寮傚父鏃ュ織

## 2026-04-17 Packaging Follow-up

- 宸插皢 `electron-builder.config.cjs` 鐨?Windows NSIS 鏈湴宸ュ叿鎺ュ叆锛屼粠 `file://...7z` 鏀逛负鑷姩澶嶇敤 `LOCALAPPDATA\\electron-builder\\manual-tools\\nsis-*` 宸茶В鍘嬬洰褰曪紝骞跺湪瀛樺湪鏃舵敞鍏?`ELECTRON_BUILDER_NSIS_DIR` / `ELECTRON_BUILDER_NSIS_RESOURCES_DIR`
- `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip` 宸查€氳繃锛孨SIS 涓嶅啀鎶?`unsupported protocol scheme "file"`
- 鏈€鏂颁骇鐗╂椂闂村凡鍒锋柊锛歚make\\Wave-win32-x64-2026.4.17-1.exe` `15:38:00`銆乣make\\Wave-win32-x64-2026.4.17-1.exe.blockmap` `15:38:03`銆乣make\\1.yml` `15:38:03`銆乣make\\Wave-win32-x64-2026.4.17-1.zip` `15:37:18`銆乣make\\win-unpacked\\Wave.exe` `15:36:11`

## 2026-04-17 UI Clarity / Drag Smoothness / Visual Polish

- 宸插畾浣?4K 娓呮櫚搴﹂珮姒傜巼鍘熷洜锛歚body` 鍏ㄥ眬 `transform: translateZ(0)` / `backface-visibility` 浼氭妸鏁撮〉鏂囨湰鏀捐繘鍚堟垚灞傦紝Windows 楂?DPI 涓嬪鏄撳嚭鐜版枃瀛楀拰杈圭嚎鍙戣櫄锛涘悓鏃堕粯璁ら厤鑹插ぇ閲忕函榛?浣庡姣旈€忔槑灞傦紝璁╃晫闈㈡樉寰楃硦鍜屽帇鏆椼€?- 宸插畾浣嶆嫋鎷芥帀甯х洿鎺ュ師鍥犱箣涓€锛歚TileLayout` 鎷栨嫿 hover 琚?`throttle(50ms)` 闄愬埗鍒扮害 20fps锛涙澶栨嫋鎷芥€?`filter: blur(8px)`銆乺esize 鎬?`backdrop-filter`銆侀珮 DPR 鎷栨嫿棰勮 PNG 涔熶細鍦?4K 灞忎笂澧炲姞缁樺埗鎴愭湰銆?- 宸蹭慨澶?浼樺寲锛氱Щ闄ゅ叏灞€鍚堟垚灞傚己鍒舵彁鍗囷紱鎷栨嫿 hover 鏀逛负 16ms锛涙嫋鎷戒腑鍚敤鏇寸煭杩囨浮锛涚Щ闄ゆ嫋鎷?blur锛涢檺鍒舵嫋鎷介瑙堟渶楂?DPR锛涗负 tile 鑺傜偣澧炲姞 paint containment锛涢檷浣庨珮鎴愭湰 blur銆?- 宸插仛杞婚噺瑙嗚鍗囩骇锛氭柊澧炴繁娴疯摑/缈＄繝楂樺厜榛樿鑳屾櫙锛岄潪 terminal 鍖哄煙浠庣函榛戞敼涓烘洿娓呮櫚鐨?slate glass 琛ㄥ眰锛涘悓姝?tab銆乥lock銆乼ailwind token銆佺獥鍙ｈ儗鏅壊銆?- 楠岃瘉锛歚scripts/verify.ps1` 閫氳繃锛沗npm.cmd run build:prod` 閫氳繃锛沗electron-builder --win dir` 閫氳繃锛涘惎鍔?`make/win-unpacked/Wave.exe` 鍚庢棩蹇楀嚭鐜?`show window`锛屾湭瑙佹柊鐨?render/child process gone 鏃ュ織銆?- 鏈畬鍏ㄩ獙璇侊細鐪熷疄 4K 涓昏娓呮櫚搴︿笌闀挎椂闂存嫋鎷藉抚鐜囦粛闇€鐢ㄦ埛鍦ㄧ洰鏍囨樉绀哄櫒涓婃墜鎰熺‘璁わ紱鏈噸鏂扮敓鎴?NSIS/zip 姝ｅ紡瀹夎鍖呫€?

## 2026-04-17 Feishu Image Preview Compatibility

- 鐢ㄦ埛鎴浘鏄剧ず椋炰功娑堟伅鍥剧墖鍖哄煙鎻愮ず鈥滄殏涓嶆敮鎸佹煡鐪嬶紝璇风◢鍚庡啀璇曗€濄€傚凡纭杩欎笉鏄?Wave 鏈湴鍥剧墖娓叉煋缁勪欢闂锛岃€屾槸 Feishu Web 鍦?Electron `<webview>` 鍐呯殑绔欑偣鍏煎閾捐矾闂銆?- 楂樻鐜囧師鍥?1锛欶eishu Web 浣跨敤榛樿 Electron UA 鏃讹紝鍥剧墖/棰勮鑳藉姏鍙兘璧伴檷绾ф垨涓嶆敮鎸佸垎鏀紱宸蹭负 `feishuweb` 鍗曠嫭璁剧疆鍘绘帀 `Electron/...` 鏍囪瘑鐨勬闈?Chrome UA锛屼笉褰卞搷閫氱敤 Web 鍏ュ彛銆?- 楂樻鐜囧師鍥?2锛歐ave 鍘熸湰缁熶竴 deny `<webview>` 鐨?`window.open` 骞惰浆鎴?Wave 鍐呮柊 block锛汧eishu 鐨勫浘鐗囨煡鐪?棰勮鍙兘渚濊禆 `about:blank`銆乣blob:` 鎴栧悓鍩熷脊绐楄繑鍥炲€笺€傚凡鍦ㄤ富杩涚▼涓粎瀵?Feishu/Lark opener 鐨?Feishu/璧勬簮/blank/blob/data 寮圭獥鏀捐锛岄檷浣庘€滄殏涓嶆敮鎸佹煡鐪嬧€濈殑姒傜巼銆?- 宸蹭负 `feishuweb` 寮€鍚?`nativeWindowOpen=yes` web preference锛岀敤浜庡吋瀹逛緷璧栧師鐢?popup 琛屼负鐨勫浘鐗囨煡鐪嬮摼璺€?- 楠岃瘉锛歚npm.cmd run build:dev` 閫氳繃锛沗git diff --check` 閫氳繃锛沗npm.cmd run build:prod` 閫氳繃锛沗electron-builder --win dir` 閫氳繃锛涘凡鍚姩鏈€鏂?`make/win-unpacked/Wave.exe`锛屾棩蹇楀嚭鐜?`show window`锛屽苟杩涘叆 `https://ycnflp4nd2cp.feishu.cn/next/messenger/`銆?- 鏈畬鍏ㄩ獙璇侊細鐪熷疄椋炰功鍥剧墖鏄惁鎭㈠闇€瑕佺敤鎴峰湪宸茬櫥褰曡处鍙烽噷瀹為檯鎵撳紑璇ユ秷鎭‘璁わ紱濡傛灉浠嶅け璐ワ紝涓嬩竴姝ュ簲鎶?Feishu WebView DevTools console/network锛岄噸鐐圭湅鍥剧墖璧勬簮鐘舵€佺爜銆乸opup URL 鍜岀珯鐐圭幆澧冩娴嬬粨鏋溿€?

## 2026-04-17 Terminal Scrollback / Resize Loss Fix

- 宸插畾浣嶁€滄秷鎭鍚炪€佹粴杞粦涓嶅埌鏈€涓婇潰銆佺缉鏀惧悗璁板綍涓㈠け鈥濈殑楂樻鐜囨牴鍥狅細缁堢榛樿 `scrollback` 鍙湁 2000 琛岋紝Codex/闀挎枃鏈緭鍑哄湪缂╂斁鎴栧崱鐗囧彉绐勬椂浼氳Е鍙?xterm 閲嶆帓锛岄暱琛岃鎷嗘垚鏇村鐗╃悊琛屽悗瓒呰繃缂撳啿涓婇檺锛屾棫琛屼細琚?xterm 瑁佹帀锛涙寔涔呭寲鐨?`cache:term:full` 鍙堜細璁板綍瑁佸壀鍚庣殑鐘舵€侊紝瀵艰嚧閲嶆柊鎵撳紑鍚庝篃鍙兘鐪嬪埌琚埅鏂悗鐨勫巻鍙层€?- 宸插皢鍓嶇榛樿缁堢婊氬姩缂撳啿鎻愬崌鍒?50000 琛岋紝骞舵妸鍙厤缃笂闄愭彁鍗囧埌 200000 琛岋紱鍚屾椂琛ュ厖 `term:scrollback` 榛樿閰嶇疆涓?schema 鑼冨洿銆?- 宸插湪缁堢缂╂斁/鍙樼獎鍓嶆牴鎹綋鍓?buffer 琛屾暟涓庡垪瀹藉彉鍖栭浼伴噸鎺掑悗鐨勮鏁帮紝蹇呰鏃跺厛涓存椂鎵╁ぇ scrollback锛屽啀鎵ц xterm resize锛岄伩鍏嶇缉鏀惧姩浣滄湰韬鎺夋棫娑堟伅銆?- 宸蹭紭鍖栧垵濮嬫仮澶嶇瓥鐣ワ細褰撳簳灞?`term` 鍘熷 blockfile 鏈惊鐜鐩栦笖涓嶈秴杩?2MB 鏃讹紝浼樺厛浠庡師濮嬬粓绔枃浠堕噸鏀炬仮澶嶏紝闄嶄綆鍥犳棫 `cache:term:full` 宸茶瑁佸壀鑰屾案涔呮仮澶嶄笉鍏ㄧ殑姒傜巼锛涘惊鐜鐩栨垨杩囧ぇ鏂囦欢浠嶄繚鐣欑紦瀛樿矾寰勶紝閬垮厤鍚姩杩囨參銆?- 楠岃瘉閫氳繃锛歚npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts`銆乣git diff --check`銆乣npm.cmd run build:dev`銆乣npm.cmd run build:prod`銆乣npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip`銆?- 宸插埛鏂颁骇鐗╋細`make\win-unpacked\Wave.exe`銆乣make\Wave-win32-x64-2026.4.17-1.exe`銆乣make\Wave-win32-x64-2026.4.17-1.zip`銆乣make\Wave-win32-x64-2026.4.17-1.exe.blockmap`銆乣make\1.yml`銆?- 宸插惎鍔ㄦ柊鐗?`make\win-unpacked\Wave.exe` 鍋?smoke锛屾棩蹇楀嚭鐜?`show window`锛屾湭鍦ㄦ湰杞?tail 涓湅鍒版柊鐨?`render-process-gone` / `child-process-gone`銆?- 鍓╀綑椋庨櫓锛氬鏋滃崟涓粓绔緭鍑鸿秴杩?2MB 鐨勫簳灞?circular blockfile 鍙繚鐣欒寖鍥达紝鏃╀簬 circular 璧风偣鐨勫唴瀹逛粛鏃犳硶鎭㈠锛涘鏋滄煇浜?CLI 涓诲姩鍙戦€佹竻绌?scrollback 鎺у埗搴忓垪锛學ave 涓嶈兘鏃犳潯浠堕樆姝紝鍚﹀垯浼氱牬鍧忓叏灞?浜や簰绋嬪簭琛屼负銆?

## 2026-04-17 Terminal Wheel Follow-up

- 鐢ㄦ埛澶嶆祴鍚庣‘璁も€滃巻鍙插閲?缂╂斁淇濇姢鈥濅慨澶嶅悗锛岄紶鏍囨粴杞粛鏃犳硶婊氬姩缁堢鍘嗗彶銆?- 宸茶繘涓€姝ュ畾浣嶆牴鍥狅細`frontend/app/view/term/termwrap.ts` 鐨勮嚜瀹氫箟 wheel handler 鍦?`terminal.modes.mouseTrackingMode !== "none"` 鏃剁洿鎺ユ斁寮冨鐞嗭紱Codex/Claude Code 绛変氦浜掑紡 CLI 浼氬惎鐢ㄧ粓绔紶鏍囨ā寮忥紝瀵艰嚧婊氳疆浜嬩欢琚?CLI/xterm 榧犳爣鍗忚鍚冩帀锛學ave 娌℃湁鏈轰細鎵ц `terminal.scrollLines()`銆?- 宸茶皟鏁寸瓥鐣ワ細鏅€?buffer 涓嬶紝鍗充娇缁堢搴旂敤寮€鍚?mouse tracking锛屼篃鐢?Wave 浼樺厛澶勭悊婊氳疆婊氬姩鍘嗗彶锛沘lternate buffer 浠嶄笉鎶㈠崰婊氳疆锛岄伩鍏嶇牬鍧?vim/less/tmux 绛夊叏灞忕▼搴忕殑浜や簰璇箟銆?- 宸茶ˉ鍏?`shouldHandleTerminalWheel()` 鍗曟祴锛岃鐩?normal buffer銆乤lternate buffer銆佸凡鍙栨秷浜嬩欢涓夌鍦烘櫙銆?- 楠岃瘉閫氳繃锛歚npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts`銆乣git diff --check`銆乣npm.cmd run build:dev`銆乣npm.cmd run build:prod`銆乣npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip`銆?- 宸插埛鏂板苟鍚姩鏂扮増 `make\win-unpacked\Wave.exe`锛涗骇鐗╂椂闂达細`Wave.exe` 17:13:35锛孨SIS exe 17:15:32锛寊ip 17:14:50锛涙棩蹇楀嚭鐜?`show window`锛屾湭鐪嬪埌鏂扮殑 renderer/child 宕╂簝鏃ュ織銆?- 鍓╀綑椋庨櫓锛氬鏋滄煇涓?CLI 浣跨敤 alternate screen 骞朵笖鑷繁涓嶅搷搴旈紶鏍囨粴杞紝Wave 浠嶄笉浼氬己琛屾姠婊氳疆锛涜繖灞炰簬淇濇姢鍏ㄥ睆绋嬪簭浜や簰鐨勫彇鑸嶏紝鍚庣画鍙€冭檻鍋氫竴涓樉寮忊€滃己鍒舵粴鍘嗗彶鈥濆揩鎹烽敭鎴栧紑鍏炽€?

## 2026-04-17 Alternate Buffer Wheel Paging Fix

- 缁撳悎鐢ㄦ埛鎴浘缁х画瀹氫綅鍚庯紝纭褰撳墠涓昏闂涓嶆槸鏅€?scrollback锛岃€屾槸 Codex/Agent 绫诲叏灞?TUI 杩愯鍦?terminal alternate buffer 涓紱杩欑被鐣岄潰椤堕儴鍐呭灞炰簬搴旂敤鍐呴儴瑙嗗浘锛宍terminal.scrollLines()` 鏃犳硶璁╁叾鍥炴粴銆?- 宸插湪 `frontend/app/view/term/termwrap.ts` 璋冩暣 wheel 澶勭悊锛氬綋 active buffer 涓?`alternate` 鏃讹紝涓嶅啀灏濊瘯婊氬姩 xterm viewport锛岃€屾槸鎶婃粴杞浆鎹㈡垚缁堢杈撳叆搴忓垪鍙戦€佺粰 PTY銆?- 褰撳墠瀹炵幇灏?alternate buffer 鐨勬粴杞槧灏勪负 `PageUp` / `PageDown`锛坄\x1b[5~` / `\x1b[6~`锛夛紝骞舵寜婊氳疆骞呭害鏀惧ぇ涓哄娆″垎椤佃緭鍏ワ紝浼樺厛淇濊瘉 Codex/绫讳技 TUI 鐨勬秷鎭垪琛ㄥ彲鍥炴粴銆?- 淇濈暀 normal buffer 鐨?scrollback 閫昏緫锛屽洜姝ゆ櫘閫?shell 杈撳嚭缁х画璧?xterm 鍘嗗彶婊氬姩锛屽叏灞?TUI 鍒欒蛋鍐呴儴缈婚〉銆?- 宸茶ˉ鍏?`getAlternateWheelInputSequence()` 鍗曟祴锛屽苟鏇存柊 `shouldHandleTerminalWheel()` 璇箟锛岃鐩?normal/alternate/cancelled wheel 鍦烘櫙銆?- 楠岃瘉閫氳繃锛歚npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts`锛?7 涓敤渚嬮€氳繃锛夈€乣git diff --check`銆乣npm.cmd run build:dev`銆乣npm.cmd run build:prod`銆乣npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip`銆?- 宸插埛鏂板苟鍚姩鏈€鏂颁骇鐗╋細`make\win-unpacked\Wave.exe` 鏃堕棿 `17:57:19`锛宍make\Wave-win32-x64-2026.4.17-1.exe` 鏃堕棿 `17:59:06`锛宍make\Wave-win32-x64-2026.4.17-1.zip` 鏃堕棿 `17:58:29`锛涙棩蹇楀凡鍑虹幇 `show window`銆?- 鍓╀綑椋庨櫓锛氬鏋滄煇浜?alternate-screen 绋嬪簭鏈韩涓嶆敮鎸?`PageUp/PageDown` 缈婚〉锛岃€屽彧鏀寔榧犳爣婊氳疆浜嬩欢鎴栬嚜瀹氫箟蹇嵎閿紝鍒欎粛鍙兘闇€瑕佷负鐗瑰畾 TUI 鍐嶈ˉ涓撻棬鍏煎锛涗笅涓€姝ヨ嫢鐢ㄦ埛浠嶅弽棣堟棤鏁堬紝搴旀姄鍙栬鍛戒护鐨勭湡瀹?`lastcmd`銆乥uffer type 鍜?wheel 鍚庡簲鐢ㄥ搷搴旀棩蹇楋紝杩涗竴姝ユ寜鍏蜂綋 TUI 鍋氶€傞厤銆?

## 2026-04-17 Agent TUI IME Anchor Fix

- 鐢ㄦ埛鍙嶉鍦?Codex 绫诲璇濈粓绔唴杈撳叆鏃讹紝鈥滄墦瀛楃殑妗?/ 杈撳叆娉曞€欓€変綅缃窇鍒版渶涓婇潰鈥濓紝鍒ゆ柇涓?xterm 鍦?alternate buffer 涓娇鐢ㄧ湡瀹?cursor 鍧愭爣瀹氫綅 IME锛岃€?Agent TUI锛堝 Codex/Claude/opencode锛夋妸浜や簰杈撳叆鏍忓浐瀹氱粯鍒跺湪搴曢儴锛屽鑷翠簩鑰呬笉涓€鑷淬€?- 宸插皾璇曚娇鐢?`agent-browser` + `electron` skill 鍋氳嚜鍔ㄥ寲宸℃锛涘綋鍓?Wave 鍦?CDP 鐩爣鏋氫妇涓粎鏆撮湶鍑?`about:blank`锛屾棤娉曠洿鎺ョǔ瀹氭姄鍙栦富 UI 浜や簰鍏冪礌锛屽洜姝ゆ敼涓哄熀浜庣幇鏈変唬鐮侀摼璺仛瀹氬悜淇锛屽苟淇濈暀璇ラ樆濉炶褰曘€?- 宸插湪 `frontend/app/view/term/termwrap.ts` 涓虹粓绔畨瑁?IME anchor 淇锛氬綋妫€娴嬪埌褰撳墠鏄?alternate buffer 涓斿懡浠?鍙鏂囨湰鍖归厤 Codex銆丆laude Code銆乷pencode 绛?Agent TUI 鏃讹紝鐒︾偣銆佽緭鍏ャ€乧omposition 涓?render 鏈熼棿浼氭妸 xterm helper textarea / composition-view 閲嶆柊閿氬畾鍒扮粓绔簳閮ㄨ緭鍏ヨ闄勮繎銆?- 璇ヤ慨澶嶅彧瀵?Agent TUI 鐢熸晥锛屼笉褰卞搷鏅€?shell銆乿im銆乴ess 绛夊父瑙勭粓绔?鍏ㄥ睆绋嬪簭鐨勯粯璁よ緭鍏ュ畾浣嶃€?- 宸插湪 `frontend/app/view/term/termutil.ts` 鏂板 `shouldAnchorImeToBottomForCommand()`锛屽苟琛ュ厖鍗曟祴瑕嗙洊 Codex/Claude/opencode 鍛戒护涓庢櫘閫?shell/editor 鍦烘櫙銆?- 楠岃瘉閫氳繃锛歚npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts`锛?9 涓敤渚嬮€氳繃锛夈€乣git diff --check`銆乣npm.cmd run build:dev`銆乣npm.cmd run build:prod`銆乣npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip`銆?- 宸插埛鏂颁骇鐗╁苟鍚姩锛歚make\win-unpacked\Wave.exe` 鏃堕棿 `21:50:28`锛宍make\Wave-win32-x64-2026.4.17-1.exe` 鏃堕棿 `21:52:28`锛宍make\Wave-win32-x64-2026.4.17-1.zip` 鏃堕棿 `21:51:49`锛涙棩蹇楀嚭鐜?`show window`銆?- 鍓╀綑椋庨櫓锛氬綋鍓?IME 閿氬畾瀵?Agent TUI 閲囩敤鍛戒护鍚?鍙鏂囨湰鍚彂寮忚瘑鍒紱鑻ュ悗缁敤鎴蜂娇鐢ㄥ叾浠栧簳閮ㄨ緭鍏ユ爮 TUI锛屽彲鑳介渶瑕佺户缁ˉ鐧藉悕鍗曟垨鎶芥垚鍙厤缃鍒欍€?

## 2026-04-17 Codex Wheel Routing Follow-up

- 鐢ㄦ埛澶嶆祴纭锛氭櫘閫氱粓绔尯鍩熸粴杞凡鎭㈠锛屼絾 `Codex` 杩欑被 Agent TUI 浠嶆棤娉曟粴鍔ㄥ叾鍐呴儴娑堟伅鍒楄〃锛岃鏄庘€渁lternate buffer 涓€寰嬩氦鍥?xterm 鍘熺敓 wheel鈥濅細璇激渚濊禆 `PageUp/PageDown` 缈婚〉鐨?Agent 鐣岄潰銆?- 宸插湪 `frontend/app/view/term/termwrap.ts` / `frontend/app/view/term/termutil.ts` 缁嗗寲鍒嗘祦锛?  - 鏅€?`normal buffer`锛氱户缁敱 Wave 澶勭悊鍘嗗彶婊氬姩銆?  - `alternate buffer` + 鏅€氬叏灞忕▼搴?+ 宸插紑鍚?mouse tracking锛氫氦鍥?xterm 鍘熺敓榧犳爣鍗忚銆?  - `alternate buffer` + `Codex/Claude/opencode/aider/gemini/qwen` 绛?Agent TUI锛氱户缁繚鐣?Wave 鐨?`PageUp/PageDown` 婊氳疆鍏滃簳锛岄伩鍏嶆秷鎭垪琛ㄦ棤娉曟粴鍔ㄣ€?- 宸茶ˉ鍏?`shouldHandleTerminalWheel()` 鍗曟祴瑕嗙洊鈥淎gent TUI 鍦?mouse tracking 寮€鍚椂浠嶅己鍒惰蛋 fallback鈥濈殑鍦烘櫙銆?- 楠岃瘉閫氳繃锛歚npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts`锛?1/21 閫氳繃锛夈€乣git diff --check`銆乣npm.cmd run build:dev`銆?- 鍓╀綑椋庨櫓锛氬綋鍓?Agent TUI 璇嗗埆浠嶅熀浜庡懡浠ゅ悕 / 鍙鏂囨湰鍚彂寮忥紱濡傛灉鍚庣画杩樻湁鍏朵粬搴曢儴杈撳叆寮?TUI锛屽彲鑳介渶瑕佺户缁ˉ鐧藉悕鍗曟垨鏀逛负鍙厤缃鍒欍€?

## 2026-04-20 Codex Alternate Buffer Cleanup + Stable Detection

- 鍩轰簬鐢ㄦ埛鏂版埅鍥剧户缁畾浣嶅悗锛岀‘璁も€淐odex 鐢婚潰娣蜂贡鈥濈殑楂樻鐜囨牴鍥犱笉鍙湪婊氳疆锛岃€屽湪浜庝袱灞傞棶棰樺彔鍔狅細
  1. xterm 鐨?`CSI ? 1049 h` alternate buffer 鍒囨崲榛樿涓嶄細鍍忕粓绔簲鐢ㄩ鏈熼偅鏍锋竻绌烘棫 alt buffer锛屽鑷翠笂涓€娆?Agent TUI 鐨勬畫鐣欏唴瀹瑰彲鑳界暀鍦ㄦ柊浼氳瘽閲岋紱鎴浘閲岄噸澶嶇殑 `Working` 鏇寸鍚堣繖绉嶁€滄棫 alt buffer 娈嬪奖 + 鏂颁竴杞粯鍒垛€濈殑琛ㄧ幇銆?  2. Agent TUI 璇嗗埆鍘熷厛鏄寜褰撳墠鍙鏂囨湰/last command 涓存椂鍒ゆ柇锛孋odex 杩涘叆宸ヤ綔鎬佸悗鍙鏂囨湰鍙兘涓嶅啀鍖呭惈鏄庢樉鏍囪瘑锛屽鑷村悓涓€浼氳瘽閲屾粴杞?IME 璺敱绛栫暐鍦ㄥ師鐢?mouse 涓?`PageUp/PageDown` fallback 涔嬮棿鏉ュ洖鍒囨崲锛岃繘涓€姝ユ斁澶х敾闈笌浜や簰娣蜂贡鎰熴€?- 宸插湪 `frontend/app/view/term/termwrap.ts` 鍔犱袱澶勬渶灏忎慨澶嶏細
  - 鐩戝惉 `DECSET 1049`锛屽湪鐪熸鍒囧埌 alternate buffer 鏃朵粎瀵硅繖娆″垏鎹㈡墽琛屼竴娆℃竻绌猴紝鍘绘帀鏃?alt buffer 娈嬬暀銆?  - 鏂板绋冲畾鐨?Agent TUI 浼氳瘽璇嗗埆锛氫紭鍏堢湅 `shell:lastcmd`锛屽叾娆″洖鐪?normal buffer 灏鹃儴鐨勫惎鍔ㄥ懡浠わ紙渚嬪 `PS ...> codex --yolo`锛夛紝鍐嶉€€鍥炲埌 active buffer 鍙鏂囨湰锛涜繘鍏ュ悗鍦ㄨ alternate-buffer 浼氳瘽鍐呬繚鎸佺ǔ瀹氾紝涓嶅啀姣忔 wheel/render 涓存椂鎶栧姩銆?- 宸插湪 `frontend/app/view/term/termutil.ts` 鏂板 `textContainsAgentTuiCommand()`锛屽苟琛ュ厖 PowerShell / 甯歌 shell prompt 鐨勮瘑鍒祴璇曘€?- 楠岃瘉閫氳繃锛?  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts`锛?3/23 閫氳繃锛?  - `git diff --check`
  - `npm.cmd run build:dev`
  - `npm.cmd run build:prod`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
- 褰撳墠 `make\win-unpacked` 宸插埛鏂帮紝鍙洿鎺ラ噸鍚?`make\win-unpacked\Wave.exe` 澶嶆祴 Codex 缁堢鐢婚潰涓庢粴杞€?
## 2026-04-20 Codex Normal Buffer Agent TUI Stabilization

- 缁х画鍩轰簬鐪熷疄 `term` 鍘熷鏁版嵁鎺掓煡鍚庯紝纭褰撳墠杩欐壒 `codex` 浼氳瘽楂樻鐜囧苟鏈娇鐢?alternate buffer锛岃€屾槸鍦?normal buffer 涓€氳繃 `CSI ? 2026 h/l` 鍚屾閲嶇粯锛涙鍓嶁€滃彧鎶?alternate buffer 褰撲綔 Agent TUI鈥濈殑鍋囪涓嶅畬鏁淬€?- 宸插畾浣嶅埌涓€涓洿鐩存帴鐨勭姸鎬佹満闂锛歚frontend/app/view/term/termwrap.ts` 浼氬湪姣忔 normal-buffer `onBufferChange` 鏃舵妸 `agentTuiActive` 鐩存帴娓呮帀锛屽鑷?`codex` 杩欑被 normal-buffer TUI 鍦ㄥ悓涓€浼氳瘽閲岄绻佷涪澶辫瘑鍒紝婊氳疆 fallback銆佽鍙ｅ洖搴曚笌 IME 閿氬畾閮藉彲鑳藉湪涓€娆℃鍐欏叆涔嬮棿鎶栧姩澶辨晥銆?- 宸插湪 `frontend/app/view/term/termwrap.ts` 鍋氭渶灏忎慨澶嶏細
  - normal / alternate buffer 缁熶竴璧扮ǔ瀹氱殑 `isAgentTuiActive()` 鍒ゆ柇锛屼笉鍐嶅湪 normal-buffer 鍐欏叆鏃舵棤鏉′欢娓呯┖ Agent TUI 鐘舵€侊紱
  - Agent TUI 妫€娴嬫敼涓虹患鍚?`shell:lastcmd`銆乣shell:state`銆乺ecent `2026` 鍚屾閲嶇粯娲诲姩銆乶ormal buffer 灏鹃儴鍛戒护浠ュ強褰撳墠 viewport/tail 鍙绛惧悕锛岃€屼笉鏄彧鐪?active buffer 椤堕儴鏂囨湰锛?  - IME 搴曢儴閿氬畾涓嶅啀閿欒鍦板彧闄?alternate buffer锛岄伩鍏?normal-buffer Agent TUI 涓嬪啀娆″洖閫€鍒伴敊璇緭鍏ヤ綅缃€?- 鏈疆楠岃瘉閫氳繃锛?  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `npm.cmd run build:dev`
  - `npm.cmd run build:prod`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
  - 鏈満 smoke锛氫娇鐢ㄦ渶鏂?`make\win-unpacked\Wave.exe` 瀹屾垚鈥滃惎鍔ㄥ簲鐢?-> 鍚姩 codex -> 鍏抽棴/寮烘潃 Wave -> 閲嶅紑鈥濈殑涓よ疆绐楀彛鎴浘妫€鏌ワ紝閲嶅紑鍚庢湭鍐嶅嚭鐜版棫甯ф贩鏉傘€侀《閮ㄥぇ闈㈢Н绌虹櫧鎴栧乏鍙崇獥鍙ｇ姸鎬侀敊涔便€?- 褰撳墠浜х墿宸插埛鏂帮細`make\win-unpacked\Wave.exe` 鏃堕棿 `2026-04-20 10:41:53`銆?
## 2026-04-20 Codex Wheel / IME / Fit Follow-up

- 鍩轰簬鐢ㄦ埛鏈€鏂板弽棣堢户缁畾浣嶅悗锛岀‘璁よ繖杞畫鐣欓棶棰樺垎鎴愪笁灞傦細
  1. `frontend/app/view/term/termwrap.ts` 浠嶄細鎶?Agent TUI 鐨勬粴杞粺涓€寮哄埗鏀瑰啓鎴?`PageUp/PageDown`锛屽嵆浣垮綋鍓?`codex` 浼氳瘽宸茬粡鍦?normal buffer 涓紑鍚簡鍘熺敓 mouse tracking锛屽鑷村拰 Windows Terminal 鐩告瘮婊氳疆璇箟涓嶄竴鑷达紝娑堟伅鍒楄〃渚濈劧涓嶉『鐣呫€?  2. `frontend/app/view/term/fitaddon.ts` 鍦ㄦ湭鏄惧紡鎻愪緵 `scrollbarWidth` 鏃朵細閫€鍥炲埌绉佹湁 DOM 瀹藉害宸祴閲忥紱杩欐潯閾捐矾鍦ㄥ綋鍓?xterm v6 + Wave 瀹瑰櫒涓嬩笉绋冲畾锛屽鏄撴妸缁堢鍒楁暟绠楃獎锛岃〃鐜颁负 Codex 鏂囨湰鎻愬墠鎹㈣銆佸彸渚х暀鐧借繃澶с€侀〉闈㈡涓嶅鑷€傚簲銆?  3. IME 搴曢儴閿氬畾铏界劧宸叉湁锛屼絾缂哄皯鍦ㄧ粓绔噸鏂?fit / resize 鍚庣殑鍐嶆鍚屾锛屽鑷撮潰鏉垮昂瀵稿彉鍖栨垨閲嶆帓鍚庯紝杈撳叆娉曞€欓€変綅缃粛鍙兘椋樺洖閿欒琛屻€?- 宸插仛鏈€灏忚寖鍥翠慨澶嶏細
  - 鍦?`frontend/app/view/term/termutil.ts` 鏂板 `getTerminalWheelStrategy()`锛屾妸婊氳疆璺敱缁嗗寲涓?`ignore / native / page / scrollback` 鍥涚被锛涘浜庡紑鍚?mouse tracking 鐨?Agent TUI锛屼紭鍏堜氦杩?xterm 鍘熺敓 wheel锛岃€屼笉鏄户缁己濉?`PageUp/PageDown`銆?  - 鍦?`frontend/app/view/term/termwrap.ts` 涓敼涓烘寜涓婅堪绛栫暐鍒嗘祦婊氳疆锛涘悓鏃堕噸鏂扮粰 `FitAddon` 娉ㄥ叆绋冲畾鐨?`scrollbarWidth`锛屽苟鍦ㄨ繍琛屾椂淇℃伅鍔犺浇銆佸垵濮嬬粓绔洖鏀惧拰姣忔 `handleResize()` 缁撴潫鍚庡埛鏂?Agent TUI 鐘舵€佷笌 IME 閿氱偣銆?  - 鍦?`frontend/app/view/term/fitaddon.ts` 涓妸灏哄娴嬮噺鏀逛负浼樺厛浣跨敤鏄惧紡 `scrollbarWidth` / `overviewRuler.width` 涓?`getBoundingClientRect()`锛岄伩鍏嶄緷璧?xterm 绉佹湁婊氬姩瀹瑰櫒瀹藉樊锛屾彁鍗?Codex 杩斿洖鍐呭鐨勮嚜閫傚簲灞曠ず绋冲畾鎬с€?  - 鍦?`frontend/app/view/term/termutil.test.ts` 涓ˉ鍏呮粴杞瓥鐣ュ崟娴嬶紝瑕嗙洊 normal shell銆丄gent TUI fallback銆丄gent TUI native wheel銆乤lternate-screen native wheel 绛夊満鏅€?- 鏈疆楠岃瘉閫氳繃锛?  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `npm.cmd run build:dev`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
- 楠岃瘉澶囨敞锛?  - 涓€斾竴娆?`build:dev` 鐨?`EBUSY` 鏉ヨ嚜鎴戞妸 `build` 鍜?`verify` 骞惰璺戝鑷寸殑 `dist` 鎶㈤攣锛屼笉鏄粨搴撴湰韬棶棰橈紱涓茶閲嶈窇鍚庡凡閫氳繃銆?  - 鏋勫缓浠嶄細杈撳嚭鏃㈡湁鐨?Vite 璀﹀憡锛坄electron` 鐨?`fs/path` browser externalized銆乣cytoscape -> mermaid -> cytoscape` circular chunk锛夛紝杩欒疆鏈柊澧炵浉鍏抽棶棰樸€?- 鍓╀綑椋庨櫓锛?  - 杩欒疆涓昏閫氳繃浠ｇ爜閾捐矾鍜屾瀯寤洪獙璇佹敹鍙ｏ紝灏氭湭鍦ㄧ洰鏍囨樉绀哄櫒涓婂仛鐪熷疄榧犳爣/杈撳叆娉曟墜鎰?smoke锛涜嫢 `codex` 鏌愪釜鐗堟湰鏀瑰洖鍙 `PageUp/PageDown` 鑰屼笉璁ゅ師鐢?wheel锛屼粛鍙兘闇€瑕佸啀涓虹壒瀹?Agent TUI 鍋氫竴灞傚彲閰嶇疆 fallback銆?
## 2026-04-20 Codex Wheel Strategy Follow-up 2

- 鐢ㄦ埛澶嶆祴鍚庝粛鍙嶉鈥滅湅璧锋潵娌＄敓鏁堚€濓紝缁х画鎺掓煡鏃跺彂鐜版湁涓ゅ眰娣锋穯锛?  1. 鐢ㄦ埛寰堝彲鑳界偣鍒颁簡鏃х殑 `win-unpacked` / 鏃ц繍琛屽疄渚嬶紝鍥犱负涓婁竴杞櫧鐒惰窇浜?`build:dev`锛屼絾褰撴椂骞舵病鏈夌珛鍒婚噸鎵?`make\win-unpacked\Wave.exe`锛?  2. 鍗充娇浣跨敤浜嗘柊浠ｇ爜锛宍frontend/app/view/term/termutil.ts` 閲屾垜涓婁竴杞粛鎶娾€渘ormal buffer + Agent TUI + 鏃?mouse tracking鈥濊矾鐢辨垚浜?`PageUp/PageDown`锛岃繖鍜?Windows Terminal 鐨勮涓轰笉涓€鑷达紱瀵逛簬褰撳墠杩欑被 normal-buffer `codex` 浼氳瘽锛屾纭涓哄簲鏄粴 xterm scrollback锛岃€屼笉鏄己鍒跺垎椤佃緭鍏ャ€?- 宸插仛淇锛?  - 灏?`getTerminalWheelStrategy()` 璋冩暣涓猴細`normal buffer` 榛樿濮嬬粓璧?`scrollback`锛屽彧鏈?`alternate buffer` 鎵嶅湪鏃?mouse tracking 鏃惰蛋 `page` fallback锛沗agentTuiActive` 浠呭湪宸插紑鍚?mouse tracking 鏃跺垏鍒?`native`銆?  - 琛ュ厖瀵瑰簲鍗曟祴锛岃鐩?鈥渘ormal-buffer Agent TUI -> scrollback鈥?鍜?鈥渁lternate-buffer app -> page fallback鈥?涓や釜鍦烘櫙銆?  - 閲嶆柊鎵ц浜?`npm.cmd run build:dev`銆乣electron-builder --win dir` 鍜?`scripts/verify.ps1`锛屽苟鍒锋柊浜?`make\win-unpacked\Wave.exe`銆?- 杩囩▼璁板綍锛?  - 浣跨敤 `agent-browser` 杩?Electron 鏃讹紝纭娴忚鍣ㄧ骇 CDP 宸茶繛鍒版柊鎵撳寘鐨?`Wave.exe`锛屼絾 CDP/鎴浘瀵瑰綋鍓嶇獥鍙ｆ姄鍙栦笉绋冲畾锛屽伐鍏蜂細鎺夊埌 `about:blank` 鎴栭粦灞忕獥鍙ｏ紝涓嶈兘浣滀负杩欒疆 UI 鏄惁鐢熸晥鐨勫彲闈犱緷鎹€?  - 鏈疆閲嶇偣浠モ€滅‘淇濇渶鏂板寘宸查噸鎵?+ 璺敱绛栫暐鏀瑰 + 鏋勫缓楠岃瘉閫氳繃鈥濅负鏀跺彛銆?
## 2026-04-20 Wheel / IME Follow-up 3

- 缁х画鏍规嵁鐢ㄦ埛鈥滆緭鍏ユ硶鍜屾粴杞粛鏈夐棶棰樷€濈殑鍙嶉瀹氫綅鍚庯紝纭鏈変笁涓珮姒傜巼鏍瑰洜锛?  1. rontend/app/view/term/termwrap.ts 瀹為檯浠嶅湪寮曠敤 npm 鍖?@xterm/addon-fit锛屽鑷存湰鍦拌ˉ涓佺増 rontend/app/view/term/fitaddon.ts 娌℃湁鐪熸鐢熸晥锛岀粓绔搴︿笌 IME 閿氱偣浼氱户缁蛋鏃ф祴閲忛€昏緫锛?  2. rontend/app/view/term/osc-handlers.ts 鐨?handleOsc16162Command() 涓鍒犱簡 const terminal = termWrap.terminal;锛屼細鍦ㄦ敹鍒?shell prompt 鐨?A 鍛戒护鏃惰Е鍙戣繍琛屾椂 ReferenceError锛岃繘鑰屾壈涔?shell 闆嗘垚鐘舵€佷笌 Agent TUI 妫€娴嬶紱
  3. 涔嬪墠鐨勬粴杞疄鐜扮粦鍦ㄥ灞?DOM capture锛屼笖瀵?Agent TUI 鐨?normal-buffer + mouse tracking 璺敱涓嶅鎺ヨ繎 Windows Terminal锛屽鏄撳嚭鐜扳€滄粴杞湅璧锋潵娌＄敓鏁堚€濇垨琚敊璇姭鎸佹垚缁堢 scrollback銆?- 鏈疆宸插仛鏈€灏忚寖鍥翠慨澶嶏細
  - rontend/app/view/term/termwrap.ts 鏀瑰洖寮曠敤椤圭洰鍐?./fitaddon锛屽苟鏀圭敤 xterm 鐨?ttachCustomWheelEventHandler() 鎺ョ婊氳疆鍒嗘祦锛?  - 婊氳疆绛栫暐璋冩暣涓猴細Agent TUI 鍦ㄥ紑鍚?mouse tracking 鏃朵紭鍏堣蛋鍘熺敓 wheel锛涙櫘閫?normal buffer 浠嶈蛋 Wave scrollback锛沘lternate buffer 鏃?mouse tracking 鏃朵繚鐣?PageUp/PageDown fallback锛?  - IME 閿氱偣鏀逛负鍥哄畾鍒?Agent 瀵硅瘽杈撳叆鍖虹殑搴曢儴涓棿浣嶇疆锛屽悓鏃跺悓姝?helper textarea / composition view 鐨?	op / left / width / opacity / z-index锛?  - osc-handlers.ts 琛ュ洖 	erminal 鍙橀噺锛屾仮澶?shell prompt marker 涓?shell 闆嗘垚鐘舵€侀摼璺紱
  - Agent TUI 鍙绛惧悕涓庝繚娲诲垽鏂暐鏀惧锛屽噺灏戣繍琛岃繃绋嬩腑鐘舵€佹姈鍔ㄣ€?- 鏈疆楠岃瘉锛?  -
pm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts 閫氳繃锛?1/31锛?  - powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1 閫氳繃
  -
pm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir 閫氳繃
- 澶囨敞锛氫腑閫斿崟鐙窇鐨勪竴娆?
pm.cmd run build:dev 鍥犱笌 erify 骞跺彂鎵ц瀵艰嚧 dist 鐩綍 EBUSY锛屽睘浜庢瀯寤虹洰褰曢攣鍐茬獊锛屼笉鏄唬鐮佸洖褰掞紱涓茶楠岃瘉鍚庡凡纭閫氳繃銆?

## 2026-04-20 Restore Official Terminal Logic

- 根据用户要求回看 git 原作者逻辑后，确认当前未提交的滚轮 / IME / fit 改动偏离官方主线较大。
- 已将 `frontend/app/view/term/termwrap.ts`、`frontend/app/view/term/termutil.ts`、`frontend/app/view/term/termutil.test.ts`、`frontend/app/view/term/fitaddon.ts`、`frontend/app/view/term/osc-handlers.ts` 全部恢复到 `HEAD` 官方逻辑。
- 官方逻辑要点：滚轮仍由 `termwrap.ts` 的原始 capture handler 处理；IME 不做 Agent TUI 专用锚点重写，回到 xterm 自身 helper textarea / composition-view 逻辑；`termwrap.ts` 回到 npm `@xterm/addon-fit`，不再使用我之前强行接入的本地 `fitaddon.ts`；OSC 16162 `R` 保留退出 alternate buffer 的处理。
- 已验证 `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts` 通过，`powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` 通过。

## 2026-04-20 IME / Wheel Minimal Patch After Official Baseline

- 根据最新截图，官方基线下仍存在两个问题：xterm composition view 在 Codex / Agent TUI 场景下会跑到左上角；Wave 的 capture wheel handler 仍会在 mouse tracking 开启时先吞掉滚轮，导致 xterm 原生 mouse wheel 协议无法接管。
- 根因判断：xterm v6 的 `CompositionHelper.updateCompositionElements()` 只在 `buffer.isCursorInViewport` 时更新 composition 坐标；当 Codex / Agent TUI 的光标状态和可视对话输入区不一致时，composition view 保留默认左上角。滚轮方面，Wave 自定义 capture handler 比 xterm 自身 wheel listener 更早执行并 `preventDefault / stopPropagation`。
- 本轮最小修复：
  - `frontend/app/view/term/termutil.ts` 的 `shouldHandleTerminalWheel()` 增加 `mouseTrackingMode` 判断；只要 mouse tracking active，就交还 xterm 原生处理。
  - `frontend/app/view/term/termwrap.ts` 在调用 `shouldHandleTerminalWheel()` 时传入 `terminal.modes.mouseTrackingMode`。
  - `frontend/app/view/term/termwrap.ts` 增加 Agent/Codex 场景下的 IME composition 坐标兜底；仅对 `codex / claude / opencode / aider / gemini / qwen` 或可见 Agent 签名生效，把 active `.composition-view` 与 helper textarea 移到对话区域中部，避免左上角。
- 验证：`npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts` 通过；`powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` 通过；`electron-builder --win dir` 通过。
## 2026-04-20 Wheel / IME History Restore Follow-up

- 继续根据用户“历史记录影响滚轮和输入法”的线索排查后，确认除了此前的 wheel / IME 路由外，还有一个恢复链路问题：`frontend/app/view/term/termwrap.ts` 在初始加载 `cache:term:full` / `term` 期间会先订阅实时 append，但加载完成后没有把 `heldData` 回放到终端，导致恢复后的 viewport、cursor 与最新会话状态可能滞后，进而放大 Codex 场景下的滚轮失效与 IME 锚点错位。
- 本轮修复：
  - 在 `termwrap.ts` 增加 `flushHeldTerminalData()`，在 `loadInitialTerminalData()` 完成后立即回放加载期间缓存的实时增量，避免恢复后的终端状态停留在旧历史快照。
  - 将 Agent / Codex 场景下的恢复与 resize 收口为 `scheduleAgentTuiViewportSync()`：初始化恢复后、输入法聚焦时、以及每次 resize 后都补一次 `scrollToBottom + IME sync`，优先把 viewport 拉回当前对话输入区域，再同步 composition / textarea 位置。
  - 调整滚轮策略：`normal buffer` 即使开启 mouse tracking 也继续由 Wave 处理 scrollback；仅 `alternate buffer + mouse tracking` 交还 xterm 原生协议，避免 Codex 这类 normal-buffer 会话被错误让渡给 mouse 协议后看起来“滚轮没反应”。
  - 调整 `fitaddon.ts` 的尺寸测量，优先用显式 scrollbar 宽度和 `getBoundingClientRect()` / `parseFloat()`，减小列宽误算导致的窄列换行与 IME 锚点漂移。
- 验证通过：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
- 当前最新产物已刷新为 `make\win-unpacked\Wave.exe`；建议用户关闭旧 Wave 进程后直接启动这个新产物复测 Codex 终端的滚轮、IME 和恢复后的首屏状态。
## 2026-04-20 Terminal Wheel Baseline + IME Viewport Row Fix

- 根据用户要求重新回看 git 历史与原作者主线后，确认当前 fork 的终端滚轮逻辑已经明显偏离上游：`upstream/main`（`wavetermdev/waveterm`）当前并没有外层 `connectElem` capture wheel 拦截，而本 fork 在 `termwrap.ts` 增加了自定义滚轮分流与 `PageUp/PageDown` fallback，这一层会让问题定位变得失真。
- 新增专项任务包 `TASK-TERM-001`，把本轮范围收紧为：滚轮、IME、历史恢复、最小 smoke，不再夹带无关 UI 改动。
- 本轮代码修正：
  - 移除 `frontend/app/view/term/termwrap.ts` 外层自定义 wheel handler，回到原作者/xterm 原生滚轮路径。
  - 清理 `frontend/app/view/term/termutil.ts` / `frontend/app/view/term/termutil.test.ts` 中仅服务于这层自定义 wheel 的辅助函数与测试，避免继续围绕错误抽象修补。
  - 修正 `frontend/app/view/term/termwrap.ts` 中 Agent TUI IME 锚点的核心计算错误：此前错误使用 `buffer.cursorY` 作为 viewport 内行号；在有历史滚动偏移时，这会把输入法位置错误锚到上方。现改为用 `cursorAbsoluteY - viewportY` 计算真实可视行。
- 运行态验证结论：
  - 使用 `agent-browser` 连接 Electron 后，确认 xterm 内部真实滚动容器是 `xterm-scrollable-element`，不是我们之前一直盯着的旧 `xterm-viewport` DOM 高度。
  - 通过直接调用 `window.term.terminal._core._viewport._scrollableElement.delegateScrollFromMouseWheelEvent(...)`，验证左侧 Codex 终端滚动链路可把 `ydisp` 从 `3475` 改到 `3461`，说明回到 xterm 原生滚轮后核心滚动管线是通的。
  - 在有历史偏移的情况下，调用 `window.term.syncImePositionForAgentTui()` 后，`textarea.style.top` 可从错误的 `90px` 变为 `594px`，验证 IME 位置已随 `viewportY` 正确移动，而不是继续卡在 `cursorY` 对应的顶部位置。
  - CDP 自动化对真实 OS 鼠标滚轮坐标的命中仍不稳定；因此本轮把它作为辅助证据，不把它当成唯一通过依据。
- 验证通过：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `npm.cmd run build:dev`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
- 辅助产物：
  - 任务包：`.harness\task-packets\TASK-TERM-001.md`
  - 运行态截图：`D:\files\AI_output\waveterm-term-smoke\wave-tab1.png`
  - 运行态截图：`D:\files\AI_output\waveterm-term-smoke\wave-after-ime-wheel-fix.png`

## 2026-04-20 Terminal Wheel / IME Official-Logic Follow-up 4

- 根据用户要求继续回看上游和 xterm v6 官方逻辑后，本轮只保留最小差异：普通 `normal buffer` 仍交给 xterm 原生 viewport 滚动；只有 `normal buffer + mouse tracking` 这一类 Codex/Agent TUI 易失效场景，在 capture 阶段转回 xterm 的 `SmoothScrollableElement.delegateScrollFromMouseWheelEvent()`，避免被 xterm 的 mouse protocol 分支吞掉滚轮。
- `alternate buffer + mouse tracking` 仍不拦截，继续交给终端应用自身处理，避免破坏 vim/tmux/全屏 TUI 的官方语义。
- IME 兜底改为仅在 Agent/Codex 场景生效，并固定到对话区域中部：不再优先使用 xterm 当前 `cursorY`，避免历史恢复、viewport 偏移或 Agent TUI 重绘后把中文组合框带到左上/顶部旧行。
- `fitaddon.ts` 的测量逻辑回退到当前仓库/上游基线，只保留 `termwrap.ts` 中显式注入 `overviewRuler.width` 的本地 FitAddon 用法，减少页面自适应问题的变量。
- 验证通过：`npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`。
- 验证通过：`npm.cmd run build:dev`、`powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`、`npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`。
- 运行态 smoke：使用 `agent-browser` 连接新打包的 `make\win-unpacked\Wave.exe`，确认 T1 终端目标可达；强制 Agent IME 场景后，helper textarea 从顶部 `90px` 调整到中部 `1116px`（113 行、18px 行高、0.55 位置）。
- 当前最新产物：`make\win-unpacked\Wave.exe`，时间 `2026-04-20 16:16:46`。
- 剩余风险：自动化无法稳定覆盖真实中文输入法候选窗的系统级显示位置；需要用户关闭所有旧 Wave 进程后，从上述新产物手动复测 Codex 会话滚轮和中文输入法候选框。

## 2026-04-20 Terminal Fit / Visible Region Follow-up 5

- 根据用户最新截图，进一步确认本轮更像是终端可绘制行数没有随容器真实高度 fit 上去，而不是单纯滚轮事件没进来：背景区域已铺满，但 Codex/Agent 对话只占用了较小的逻辑终端高度。
- 本轮根因收口为两点：
  1. `frontend/app/view/term/fitaddon.ts` 仅依赖 `getComputedStyle(parent).height/width`，当父容器在某些布局阶段给出 `auto` / 非稳定值时，会导致 `proposeDimensions()` 算不出最终 rows，终端继续停留在默认或旧行数；
  2. `frontend/app/view/term/termwrap.ts` 只在构造时立刻 `handleResize()` 一次，某些情况下首次 fit 发生在布局尚未稳定前，后续 Codex 启动时就可能沿用较小的逻辑终端高度。
- 修复方式：
  - `fitaddon.ts` 改为优先读 computed style，失败或非正值时回退到 `getBoundingClientRect()`；padding 改为 `parseFloat()`，并对可用宽高做 `Math.max(0, ...)` 防守，避免 rows/cols 因 NaN 或负值失真；
  - `termwrap.ts` 在首次 `handleResize()` 后补三次延迟 resize（0ms / 50ms / 250ms），确保容器稳定后再做一次真实 fit 并把最终尺寸发给 controller。
- 运行态验证：
  - 新打包产物下通过 `agent-browser` 连接 `T1` 终端页，两个终端块的 `fitAddon.proposeDimensions()` 与 `terminal.rows` 均为 `113`，容器高度 `2037px`，说明逻辑行数已与真实显示高度对齐。
- 验证通过：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `npm.cmd run build:dev`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
- 当前最新产物：`make\win-unpacked\Wave.exe`，时间 `2026-04-20 16:36:12`。
- 剩余风险：该问题和真实用户会话内容/恢复历史强相关；虽然运行态已确认终端 rows 跟容器高度一致，但仍建议用户关闭所有旧 Wave 进程后，直接用该新产物重开 Codex 会话复测截图中的“只占一小块”问题。

## 2026-04-20 Terminal History / Persist Guard Restore

- 接手当前未提交改动后，先定位到正在处理本仓库的 Codex 进程是 `PID 35804`；其子进程曾在 `2026-04-20 17:11` 执行 `scripts/verify.ps1`，表现为长时间运行 `electron-vite build --mode development`，不是完全卡死，而是前端 dev 构建本身要约 2 分钟且内存占用接近 4GB。
- 继续对比未提交 `termwrap.ts` 与仓库当前基线后，确认这轮真正的回归点不是单纯 IME/fit，而是修滚轮/输入法时误删了多处历史恢复保护：
  - 删除了 `dispose()` / `visibilitychange` / `beforeunload` 上的 `persistTerminalState(true)`，会重新放大“退出前没落盘、恢复后状态滞后”的老问题；
  - 删除了 `cancelProcessIdleTimeout()` / `processIdleTimeoutId` / `processIdleCallbackId`，让 idle 持久化调度在销毁后继续跑的风险重新回来；
  - 删除了 `shouldReplayFullTermFile()`、缓存恢复时的 `await doTerminalWrite(...)`、以及 resize 前的 scrollback 保护，会让“历史恢复影响滚轮/IME 锚点”的变量再次混进来；
  - 把 `mainFileSubject?.release()` 改成了无保护调用，存在提早 `dispose()` 时空引用风险。
- 本轮修复策略：不回退 `scheduleDeferredResize()` 与 Agent/Codex IME 兜底，但把以上历史恢复/持久化保护全部补回，仅保留与本任务直接相关的终端改动，避免继续在错误基线上反复打补丁。
- 本轮验证：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts` 通过；
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` 通过；
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir` 未通过，但阻塞原因为本地已有 `make\win-unpacked\Wave.exe --remote-debugging-port=9222` 正在运行，占用了 `make\win-unpacked\dxcompiler.dll`，报错 `EPERM: operation not permitted, unlink ...\\make\\win-unpacked\\dxcompiler.dll`，不是当前代码编译错误。
- 当前结论：之前“为什么一直解决不了”主要有两个叠加原因：
  1. 修滚轮/IME 时把历史恢复与持久化保护误删了，导致每轮都在引入新回归，问题空间始终不收敛；
  2. 同时拿 `make\win-unpacked\Wave.exe` 做 remote-debugging smoke，又直接往同一输出目录跑 `electron-builder --win dir`，验证链路互相锁文件，容易让人误判为“代码还没修好”。

## 2026-04-20 Official Terminal Baseline Restore Follow-up

- 根据用户“照抄官方源码”的明确要求，本轮重新以 `upstream/main` 的 `frontend/app/view/term/termwrap.ts` 为基线收口：
  - 移除外层自定义 wheel capture handler，滚轮回到 xterm / 上游原生 viewport 路径；
  - 移除本地 full-term replay、强制 unload 持久化、dispose 前强制 persist、idle cancel 等历史恢复扩展，恢复上游 `loadInitialTerminalData()` / `processAndCacheData()` / `runProcessIdleTimeout()` 主线；
  - 回到官方 `@xterm/addon-fit`，不再接入本地 `fitaddon.ts`；
  - 只保留两处最小差异：首次布局后的延迟 `fit()`，以及 Codex/Agent 场景下将 IME helper textarea / composition view 锚到对话中部。
- 本轮运行态验证：
  - 已启动最新 `make\win-unpacked\Wave.exe --remote-debugging-port=9222`，产物时间 `2026-04-20 17:26:05`；
  - `agent-browser` 连接 `T1` 后确认两个终端块均为 `rows=113 / cols=208`，容器高度 `2037px`，`scrollTop=0 / scrollBottom=112`；
  - 在 Wave 内启动 `codex.cmd` 后，Codex 终端 `textarea` 自动锚到中部：`top=1116px`、`left=864px`；
  - xterm 原生滚动管线可用：`terminal.scrollLines(-10)` 将 `ydisp` 从 `3595` 改到 `3585`；`delegateScrollFromMouseWheelEvent(...)` 将 `ydisp` 从 `3595` 改到 `3581`。
- 本轮验证通过：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
- 剩余风险：
  - `agent-browser screenshot` 在 4K Electron 窗口上仍偶发 CDP 读取超时，因此本轮以运行态 DOM/xterm 内部状态作为主要证据；
  - 系统级中文输入法候选窗无法完全自动化截图验证，仍需用户在当前已启动的新包中手动输入中文确认候选框位置。

## 2026-04-20 PTY TermSize Sync Root Cause Fix

- 用户复测截图仍显示 Codex 内容只使用终端上方约 30 行。继续现场验证后确认真正根因不是 xterm 前端高度：
  - 前端 xterm 已是 `rows=113 / cols=208`；
  - 但 Wave 内 PowerShell 执行 `[Console]::WindowHeight; [Console]::WindowWidth` 返回 `30 / 80`；
  - 说明 Codex/ConPTY 实际收到的终端尺寸仍是默认小窗口，所以 Codex TUI 只能在上方小区域排版。
- 根因定位：
  - `termwrap.ts` 原逻辑只在 `oldRows/oldCols` 与 `terminal.rows/cols` 发生变化时发送 `ControllerInputCommand(... termsize ...)`；
  - 首次 `handleResize()` 可能早于后端 shell/pty ready，后续 `fit()` 结果虽然仍是 `113x208`，但因为前端行列没有变化，不会再次把尺寸发给后端；
  - 后端 `pkg/blockcontroller/shellcontroller.go` 的 `updateTermSize()` 本身可工作，手动制造一次前端 resize 后，PowerShell 会从 `30x80` 正确变为 `113x208`。
- 本轮修复：
  - `frontend/app/view/term/termwrap.ts` 新增 `syncControllerTermSize(reason)`，用于显式把当前 `terminal.rows/cols` 发给后端；
  - `handleResize(forceTermSizeSync)` 支持在尺寸未变化时强制同步 PTY 尺寸；
  - `initTerminal()` 完成后调用 `scheduleDeferredResize(true)`，确保 shell/pty ready 后即使前端行列没变，也会把真实尺寸同步到 ConPTY。
- 现场复测：
  - 已重新打包并启动最新 `make\win-unpacked\Wave.exe --remote-debugging-port=9222`，产物时间 `2026-04-20 17:51:51`；
  - `agent-browser` 连接 `T1` 后，前端仍为 `rows=113 / cols=208`；
  - 在 Wave 内 PowerShell 执行 `[Console]::WindowHeight; [Console]::WindowWidth`，返回 `113` 和 `208`，确认 PTY 尺寸已真正同步。
- 验证通过：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`

## 2026-04-20 Codex IME Auto Anchor / Wheel Runtime Smoke

- 用户继续反馈“上面有被吞掉、输入法位置不对”后，本轮用 `agent-browser` 直接连接最新 Electron 包复现：
  - 可见终端和离屏终端都会恢复到 `rows=113 / cols=208`；
  - 可见终端 PowerShell 执行 `[Console]::WindowHeight; [Console]::WindowWidth` 返回 `113 / 208`，确认后端 ConPTY 已不是 `30 / 80`；
  - 启动 `codex` 后，`shouldAnchorImeForAgentTui()` 为 `true`，但旧逻辑没有在 Codex 输出到达后自动重排 xterm helper textarea，导致 textarea 仍停在 Codex 当前 cursor 行，例如 `top=486px / left=18px / zIndex=-5`。
- 本轮修复：
  - `shouldAnchorImeForAgentTui()` 增加 shell prompt tail 判断，避免 Codex 退出回到 `PS ...>` 后仍因为历史画面里有 “OpenAI Codex” 而继续锚定输入法；
  - `scheduleImePositionSync()` 增加 pending guard，避免流式输出时堆积大量 `0ms / 16ms / 100ms` 定时器；
  - xterm `onRender` 和 `doTerminalWrite()` 完成后都会触发 IME 同步，确保 Codex TUI 输出到达后自动把 helper textarea/composition view 锚回对话中部。
- 最新运行态验证：
  - 已重新打包并启动 `make\win-unpacked\Wave.exe --remote-debugging-port=9222`，产物时间 `2026-04-20 18:30:59`；
  - `agent-browser` 连接 `T1` 后，在可见终端执行 PowerShell 尺寸命令返回 `113 / 208`；
  - 启动 `codex` 后，textarea 自动锚到 `top=1116px / left=864px / zIndex=5`；
  - 发送 `Ctrl+C` 退出 Codex 后，`shouldAnchorImeForAgentTui()` 变为 `false`，textarea override 被清理；
  - normal buffer wheel smoke：派发向上滚轮后 `viewportY` 从 `3596` 变为 `3556`，事件被 `preventDefault()`，说明滚轮路径生效。
- 验证通过：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
- 剩余风险：
  - 系统级中文输入法候选窗本身无法由 CDP 直接截图验证，本轮以 xterm helper textarea/composition view 的真实 DOM 坐标作为自动化验收依据；
  - `agent-browser screenshot` 在当前 4K Electron 窗口上仍会超时，因此截图证据暂不作为通过条件。

## 2026-04-21 Full Installer / Zip Artifact Validation

- 用户指出 `make\Wave-win32-x64-2026.4.17-1.exe`、`.exe.blockmap`、`.zip` 的时间仍停留在 `2026-04-17`，并质疑“是不是根本没打到最新包”。现场复核后确认该怀疑是对的：
  - 前一轮只执行了 `electron-builder --win dir`，只会刷新 `make\win-unpacked`；
  - `make\Wave-win32-x64-2026.4.17-1.exe`、`.exe.blockmap`、`.zip` 仍然是 `2026-04-17 21:52` 的旧分发产物，所以如果用户双击它们，看到的确实不是最新修复。
- 本轮修复动作不是代码逻辑，而是把完整 Windows 分发链路重新跑通：
  - 先执行 `npm.cmd run build:dev`；
  - 再以 `WAVETERM_WINDOWS_INSTALLERS=1` 执行 `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip`，强制重新产出安装器与 zip；
  - 新产物时间：
    - `make\Wave-win32-x64-2026.4.17-1.zip` -> `2026-04-21 10:57:29`
    - `make\Wave-win32-x64-2026.4.17-1.exe` -> `2026-04-21 10:58:22`
    - `make\Wave-win32-x64-2026.4.17-1.exe.blockmap` -> `2026-04-21 10:58:25`
- 额外运行态验证：
  - `zip` 包解压到 `make\zip-smoke` 后启动 `Wave.exe --remote-debugging-port=9224`，`location.href` 指向 `make/zip-smoke/resources/app.asar/...`；
  - 在该 `zip` 包内 PowerShell 返回 `113 / 208`，启动 `codex` 后 textarea 自动锚到 `top=1116px / left=864px / zIndex=5`；
  - `installer exe` 以 `/S /D=...` 静默安装到 `make\installer-smoke`，退出码 `0`；
  - 再从 `make\installer-smoke\Wave.exe --remote-debugging-port=9225` 启动，`location.href` 指向 `make/installer-smoke/resources/app.asar/...`；
  - 在该安装器落地产物内 PowerShell 同样返回 `113 / 208`，启动 `codex` 后 textarea 自动锚到 `top=1116px / left=864px / zIndex=5`，wheel smoke 中 `viewportY` 从 `3597` 变为 `3557`。
- 结论：
  - 用户昨天点到的确实是旧安装包，不是最新修复；
  - 现在 `win-unpacked`、`zip`、`installer exe` 三条分发链路都已验证到同一份新代码；
  - 产物名仍叫 `2026.4.17-1` 只是因为 `package.json` 版本号还没变，不代表内容没更新；是否要再改版本号/产物名属于发布管理问题，不是本轮终端根因修复本身。

## 2026-04-21 Artifact Version Bump

- 为了彻底消除“明明是新代码，但文件名看起来像旧包”的误导，本轮把构建版本从 `2026.4.17-1` 提升到 `2026.4.21-1`：
  - `package.json` -> `2026.4.21-1`
  - `package-lock.json` 顶层版本同步到 `2026.4.21-1`
- 重新执行完整构建与打包后，新分发产物为：
  - `make\Wave-win32-x64-2026.4.21-1.zip` -> `2026-04-21 11:17:26`
  - `make\Wave-win32-x64-2026.4.21-1.exe` -> `2026-04-21 11:18:08`
  - `make\Wave-win32-x64-2026.4.21-1.exe.blockmap` -> `2026-04-21 11:18:11`
- 新文件名产物验证：
  - `zip` 解压到 `make\zip-smoke-2026.4.21-1` 后运行，`location.href` 指向 `make/zip-smoke-2026.4.21-1/resources/app.asar/...`；
  - 该新 zip 包内 PowerShell 返回 `113 / 208`；
  - 另外也已生成目录版 `make\Wave-win32-x64-2026.4.21-1\Wave.exe`，避免用户再点到旧目录名。
- 补充说明：
  - 新旧 zip 大小依旧都在 `2178xx KB` 左右，这是 Electron 分发包的正常现象；体积近似不代表内容没变，真正有效的是时间戳、SHA256 和运行态路径。

## 2026-04-21 Wheel / IME Cursor Alignment Fix

- 用户给出 Windows Terminal 参考图后，本轮重新收口需求：
  - “吞内容”主问题已经解决；
  - 当前优先级变为两点：滚轮找回，以及输入框/输入法组合文本要对齐当前实际输入位置，而不是固定在中线。
- 本轮根因：
  1. `frontend/app/view/term/termwrap.ts` 的 normal buffer wheel 兜底挂在 `connectElem` 的 **capture** 阶段，并且会 `stopPropagation()`，这会抢在 xterm 内部的 `xterm-scrollable-element` 之前截获事件；
  2. xterm 当前真实滚动条并不依赖 `.xterm-viewport.scrollHeight`，而是依赖内部 `_viewport._scrollableElement`；运行态确认其 `scrollHeight=66780`、`scrollTop=64746`，说明右侧滚动条仍是 xterm 自己维护的；
  3. IME 兜底之前固定锚到 `rows * 0.55` 的中线，和用户给出的 Windows Terminal 参考不一致；正确行为应当跟随当前 cursor 行列。
- 本轮修复：
  - wheel 兜底改为 **bubble** 阶段监听，不再在 capture 阶段抢占 xterm 内部 wheel 处理；
  - 仅在 `wholeLines !== 0` 时才调用 `preventDefault()/stopPropagation()`，避免吞掉无法折算成整行的小滚轮增量；
  - IME 锚点改为使用当前 `buffer.active.cursorY / cursorX` 与 cell 尺寸计算 `top/left`，不再固定在中线。
- 运行态验证：
  - 在最新 `make\win-unpacked\Wave.exe --remote-debugging-port=9229` 中，启动 `codex` 后：
    - `cursor = { x: 2, y: 32 }`
    - textarea = `top=576px / left=18px / zIndex=5`
    - 与当前 cursor 计算出的期望值一致；
  - 直接把 `WheelEvent` 派发到 xterm 内部 `_viewport._scrollableElement._domNode` 后，`viewportY` 从 `3597` 变为 `3557`，说明 xterm 自身滚动链路已恢复，不再被外层 capture handler 抢断；
  - `agent-browser mouse wheel` 在 Electron + CDP 下仍会超时且抓不到 DOM `wheel` 事件，因此这部分继续记录为工具限制，而不是代码未生效。
- 验证通过：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
  - `WAVETERM_WINDOWS_INSTALLERS=1 npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip`

## 2026-04-21 Remove Terminal History Cache / Restore

- 用户最新明确要求是不再需要“历史记录”，并指出这套历史恢复逻辑本身已经影响问题判断；因此本轮不再继续修补 `cache:term:full`，而是直接从前端停用这条链路。
- 已在 `frontend/app/view/term/termwrap.ts` 做最小范围移除：
  - 删掉 `cache:term:full` 读取入口与 `loadInitialTerminalData()` 调用；
  - 删掉 `SerializeAddon`、`processAndCacheData()`、`runProcessIdleTimeout()`、`BlockService.SaveTerminalState(...)` 调用；
  - 初始化阶段改为只订阅当前会话 `term` blockfile 的实时 append，不再恢复旧终端快照。
- 为避免初始化窗口内丢实时输出，本轮补了 `flushHeldTerminalData()`：在 `loaded=false` 期间进入 `heldData` 的 append 数据会在 `loaded=true` 后顺序回放，保证“去历史”不等于“丢首屏实时输出”。
- 验证结果：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts` 通过；
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` 通过；
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir` 通过，最新 `make\win-unpacked\Wave.exe` 时间为 `2026-04-21 15:45:49`。
- 补充记录：
  - 代码检索确认 `termwrap.ts` 中已不再引用 `cache:term:full`、`SaveTerminalState`、`loadInitialTerminalData`、`runProcessIdleTimeout`、`processAndCacheData`、`SerializeAddon`、`fetchWaveFile`。
  - `agent-browser` 仍可通过 `agent-browser.cmd` 使用，但 PowerShell 直接执行 `agent-browser.ps1` 会被本机 execution policy 拦截；这是本机策略限制，不是仓库阻塞。

## 2026-04-21 Terminal Smoke Automation Loop

- 按 `$architect-improvement-loop` 和用户批准的方向 A，新增 `TASK-TERM-002`，目标是先建立终端回归 smoke 自动化闭环，避免继续反复出现旧包、旧实例、历史恢复残留、滚轮/IME 无法确认的问题。
- 新增 `scripts/smoke-terminal.ps1`：
  - 默认只关闭仓库 `make` 目录下的旧 `Wave.exe`，不动仓库外安装版；如需全量关闭可显式传 `-KillAllWave`；
  - 自动启动 `make\win-unpacked\Wave.exe --remote-debugging-port=<free-port>`；
  - 通过 CDP 直接执行运行态断言，不依赖 `agent-browser.ps1`；
  - 静态确认 `termwrap.ts` 不包含历史恢复/缓存关键字符串；
  - 运行态确认 `window.term` 可达、历史方法为空、`serializeAddon=false`、wheel 能改变 `viewportY`、IME textarea 与 cursor 对齐；
  - 输出 JSON 与截图到 `D:\files\AI_output\waveterm-terminal-smoke`。
- 首次 smoke 有意外但很关键的失败：当时源码已停用历史链路，但运行态 bundle 仍暴露 `loadInitialTerminalData` / `processAndCacheData` / `runProcessIdleTimeout`，说明 `make\win-unpacked` 仍是旧前端 bundle；失败结果在 `D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-161932.json`。
- 串行重跑 `scripts\verify.ps1` 与 `electron-builder --win dir` 后，第二次 smoke 通过：
  - JSON：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-162451.json`
  - 截图：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-162451.png`
  - `Wave.exe` 时间：`2026-04-21T16:23:14.5073581+08:00`
  - SHA256 前缀：`0A9EC1A4814CB56A`
  - rows/cols：`55 / 103`
  - runtime 历史方法：空
  - `serializeAddon`：`false`
  - wheel：`viewportY 127 -> 87`
  - IME：`topDelta=0`、`leftDelta=0`
- 验证通过：
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`

## 2026-04-21 Architect Loop Approval A

- 用户在最新截图反馈“输入框问题仍未解决，滚轮问题又出现”后，按 `$architect-improvement-loop` 继续做 review，没有直接再次改业务代码。
- 复盘结论：
  - 当前业务逻辑问题已从“单 terminal DOM patch 是否生效”转为“多 terminal split-pane 焦点归属与真实 wheel 路径是否正确”；
  - 当前 smoke 虽然已证明最新包、无历史恢复、单 terminal DOM 断言通过，但它仍通过 `window.term` 单实例、强制 `shouldAnchorImeForAgentTui=()=>true` 和直派发内部 `.xterm-scrollable-element` 的方式验证，覆盖不到用户截图暴露的真实路径；
  - `frontend/app/view/term/termwrap.ts` 当前 wheel 兜底在 bubble 阶段先判断 `event.defaultPrevented`，这使它在 xterm 已先消费事件的场景下根本不会运行；IME 逻辑也没有绑定真实 active terminal ownership。
- 已根据用户批准 A 创建两个后续任务包：
  - `TASK-TERM-003`：多 terminal 焦点与真实事件路径 smoke 补强
  - `TASK-TERM-004`：将 wheel / IME 修复收口到 xterm 官方扩展点与焦点归属
- 这是规划工件更新，不包含新的终端业务代码改动。

## 2026-04-21 TASK-TERM-003 Multi-Terminal Smoke

- 已完成 `TASK-TERM-003` 的脚本实现，新增 `scripts/smoke-terminal.runtime.js`，并让 `scripts/smoke-terminal.ps1`：
  - 自动枚举页面上的多个 terminal block，而不是只看 `window.term`
  - 在运行态用 `window.term` setter hook 记录新建 `TermWrap`
  - 必要时通过 `RpcApi.CreateBlockCommand(... targetaction=splitdown ...)` 自动创建第二个 terminal 做 split-pane smoke
  - 对每个 terminal 输出 blockId、几何位置、focus owner、textarea/composition-view 样式以及 runtime rows/cols/bufferType/viewportY
  - 区分 `elementFromPoint` 外层真实 wheel 路径与内部 `.xterm-scrollable-element` fallback
  - 截图后自动删除 smoke 临时创建的 block，避免污染用户工作区
- 运行结果：
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave` 已执行
  - 结果 JSON：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-165710.json`
  - 截图：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-165710.png`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` 通过
- 结论收敛：
  - smoke 已稳定发现 `3` 个 DOM terminal，并拿到 `2` 个已知 `TermWrap`
  - `wheel` 在当前多 terminal smoke 中通过，`outerChanged` / `internalChanged` 都只命中目标 terminal
  - `IME ownership` 失败，诊断为 `ime_wrong_terminal`
  - 失败细节显示一个非目标 terminal 仍保留 helper textarea 的 `top/left/zIndex`，这说明后续 `TASK-TERM-004` 应优先修复“非 active terminal 的 IME helper 清理 / ownership 判定”，而不是继续盲修 wheel

## 2026-04-21 TASK-TERM-004 Wheel / IME Ownership 收口

- 已按 `TASK-TERM-004` 把终端修复收口到更接近 xterm 官方路径：
  - `frontend/app/view/term/termwrap.ts` 的 normal buffer wheel 改为优先走 xterm `attachCustomWheelEventHandler`
  - 仅在 `mouseTrackingMode !== "none"` 且 `normal` buffer 时保留一个极窄的 capture fallback，避免再次用粗粒度外层 DOM listener 抢事件
  - 新增 `TermWrap.liveInstances` 与静态 `imeOwnerBlockId`，让 IME helper override 只属于当前 owner terminal
  - 在 `focus` / `compositionstart` 时先调用 xterm 私有 `_syncTextArea()`，与官方 issue `#5734` / PR `#5759` 的修复点保持一致
- 这一轮也顺手修正了 smoke 的验证盲区：
  - `scripts/smoke-terminal.runtime.js` 现在优先从 `TermWrap.liveInstances` 枚举终端实例
  - 当前工作区没有 terminal 时会自动创建首个 shell terminal
  - IME ownership 断言不再把 xterm 默认 `z-index:-5` 当成“错误 terminal 仍有 override”
- 最终验证：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts` 通过
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` 通过
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir` 通过，刷新后的 `make\win-unpacked\Wave.exe` 时间为 `2026-04-21T17:16:35.2754971+08:00`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave` 通过
    - JSON：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-172449.json`
    - 截图：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-172449.png`
- 结果：
  - `dom terminal = 2`
  - `known runtime = 2`
  - `wheel diagnoses = ok`
  - `ime diagnoses = ok`
- 当前剩余风险：
  - 系统级中文输入法候选窗仍无法通过 CDP 直接截图；当前自动化以 helper textarea / composition-view 的真实 DOM ownership 作为代理指标

## 2026-04-21 TASK-TERM-004 Real Wheel Follow-up

- 用户继续反馈“依然没有滚轮”后，本轮不再只依赖 JS `dispatchEvent(new WheelEvent(...))`，新增 `scripts/smoke-terminal-real-wheel.ps1` 走 CDP 真实输入路径：
  - 启动 `make\win-unpacked\Wave.exe --remote-debugging-port=<free-port>`；
  - 复用 `scripts/smoke-terminal.runtime.js` 准备多 terminal split-pane 场景；
  - 对每个目标 terminal 的 `screen-center` 与 `screen-right` 坐标发送 `Input.dispatchMouseEvent(type=mouseWheel, deltaY=-720)`；
  - 断言只有目标 terminal 的 `viewportY` / scroll state 变化。
- 真实复现结论：
  - 最新 `win-unpacked` 成品中的真实鼠标滚轮路径已通过，2 个 terminal 的 `screen-center` / `screen-right` 均为 `ok`；
  - 因此用户截图中的“没有滚轮”更像是仍在运行旧安装包/旧实例，或打开了同名旧版本，而不是当前 `make\win-unpacked` 内的 wheel 事件路径仍失败。
- 为避免同名旧包误用，本轮将版本号从 `2026.4.21-1` 提升到 `2026.4.21-2`，并重新产出：
  - `make\win-unpacked\Wave.exe`，时间 `2026-04-21 18:37:50`，SHA256 `C7FEF2CC7EC1280C98EAEB6CC3C8FDBD08346755382E1332CA7B9E5D5490DCE1`
  - `make\Wave-win32-x64-2026.4.21-2.exe`，时间 `2026-04-21 18:40:18`，SHA256 `2D53B26D7C4D18BE9642A20460544E04CD6401B2952C68928E31891D154BB4BC`
  - `make\Wave-win32-x64-2026.4.21-2.zip`，时间 `2026-04-21 18:39:18`，SHA256 `96C5E0222D1BD38600E8279B31AF4272358BD89307D2843544B7BA9D83E8EB76`
- 最终验证：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts` 通过；
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` 通过；
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir nsis zip` 通过；
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal-real-wheel.ps1 -KillExistingRepoWave` 通过，JSON 为 `D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260421-184158.json`；
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave` 通过，JSON 为 `D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-184339.json`。

## 2026-04-21 Architect Loop Approval A（第二轮）

- 用户在最新截图中确认“输入法恢复了，滚轮又没了”，并明确要求按 `$architect-improvement-loop` 彻底解决该问题。
- 本轮未直接继续改业务代码，而是先重新做研究，结论如下：
  - 当前实现只覆盖 `normal buffer` 的 wheel：`frontend/app/view/term/termwrap.ts` 在非 `normal` 时直接退出；
  - 当前 smoke 也只把 `normal buffer` 当成成功路径，`scripts/smoke-terminal.runtime.js` 把 `non-normal-buffer` 视为失败，而不是覆盖范围；
  - `frontend/app/view/term/termutil.ts` 仍保留 alternate buffer 的 wheel fallback 设计，但当前 `termwrap.ts` 没有把这条路径真正接回去；
  - 这与用户截图一致：Codex 交互态很可能不是普通 `normal buffer` 场景，因此出现“IME 正常但滚轮没了”。
- 用户已批准推荐方向 A，因此新增 `TASK-TERM-005`：
  - 任务名：`Codex / alternate buffer 全视图滚轮收口`
  - 目标：把当前只覆盖 normal buffer 的滚轮补丁升级为“按 active terminal 收口的全视图 wheel router”，并让 smoke 明确覆盖 Codex / alternate buffer / mouse tracking 场景。
- 本轮只新增任务包与 `.harness` 工件，不包含新的终端业务代码改动。

## 2026-04-22 TASK-TERM-005 Final Verification

- 已在最新 `make\win-unpacked\Wave.exe` 上完成最终真实滚轮复核：
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal-real-wheel.ps1 -KillExistingRepoWave`
- 结果通过：
  - JSON：`D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260422-110300.json`
  - 截图：`D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260422-110300.png`
  - `make\win-unpacked\Wave.exe` 时间：`2026-04-22T10:59:49.3611836+08:00`
  - SHA256：`665EEF5E7CC24CCA7B3E27543AACC59B42076542DE1337156364DFB51C90838C`
- 关键结论：
  - `runtime.wheel.allPassed = true`
  - `runtime.ime.allPassed = true`
  - `realWheel.allPassed = true`
  - 2 个 terminal 的 `screen-center` / `screen-right` 全部为 `ok`
- 额外排查：
  - 本机常见安装路径仅发现仓库内两份 `Wave.exe`
  - 未发现额外安装版 `Wave.exe` 干扰当前验证
- 当前判断：
  - 最新仓库成品里的 IME 与滚轮路径都已恢复
  - 若你现场仍异常，更可能是启动入口不是当前仓库这份最新成品，或现场命中区域与当前 smoke 路径仍有差异

## 2026-04-22 TASK-TERM-005 Scrollback Follow-up

- 用户最新手测反馈：滚轮与 IME 已恢复，但 Codex / Agent 输出基本只能回看一页，前面的输出会被吞掉。
- 本轮复盘后确认这不是 `term:scrollback` 配置本身过小，而是 Agent TUI 路径仍会主动进入 `alternate screen` 并发送 `CSI 3 J` 清空 scrollback，导致历史只能保留当前页。
- 已在 `frontend/app/view/term/termwrap.ts` 做最小收口：
  - 对 agent 命令（`codex|claude|opencode|aider|gemini|qwen`）抑制 `47/1047/1049` alternate screen 进入
  - 对 agent repaint 场景抑制 `CSI 3 J` 清空 scrollback
  - 保持现有 wheel / IME 修复不回退
- 已扩展 `scripts/smoke-terminal.runtime.js`：
  - 新增 `agent-repaint-scrollback` 场景
  - 断言 seed 历史仍可见、最新 repaint 内容可见、active buffer 仍是 `normal`
- 本轮验证：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal-real-wheel.ps1 -KillExistingRepoWave`
- 最新结果：
  - `D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260422-112409.json`
  - `D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260422-112519.json`
  - `make\win-unpacked\Wave.exe` 时间：`2026-04-22T11:22:55.2418461+08:00`
  - `make\win-unpacked\Wave.exe` SHA256：`BA03754F45CB5DF8BF0E7FF3FF9625E414AAB5A45C2DB1DC37A65B95800194E4`
  - `runtime.agentScrollback.allPassed = true`
  - `runtime.wheel.allPassed = true`
  - `runtime.ime.allPassed = true`
  - `realWheel.allPassed = true`

## 2026-04-22 TASK-TERM-005 Live Wheel Revert

- 用户最新手测反馈说明：上轮“强行保留 agent 历史”的方向把 Codex / TUI 的实时滚动搞坏了，表现为：
  - 又无法滚动
  - 输出进行中也无法滚动
- 本轮重新对照 `@xterm/xterm` 官方 wheel 逻辑，并用 `agent-browser` 连到 Electron 实机窗口做快照确认：
  - 当前真正需要的是：**mouse-tracking / alternate buffer 时，让应用自己接收 wheel**
  - 不能再由 Wave 在这些场景下强行把 wheel 改写成 `PageUp/PageDown`，更不能强压成 normal-buffer scrollback
- 已做收口：
  - 回退上轮对 agent TUI 的 `47/1047/1049` alternate-screen 抑制
  - 回退上轮对 agent repaint `CSI 3 J` 的 scrollback 保留特判
  - `frontend/app/view/term/termutil.ts` 现在只在 `normal buffer` 下拦截 wheel 做 scrollback
  - `frontend/app/view/term/termwrap.ts` 保留 normal-buffer + mouse-tracking 的极窄 capture fallback；`alternate buffer` 与 `mouse-tracking` 交回 xterm / 应用侧
- smoke 也同步改回更接近官方语义：
  - `alternate buffer` 场景现在断言收到的是 xterm 官方 fallback 的箭头序列，而不是自造的 `PageUp`
  - 新增 `mouse-tracking-wheel` 场景，断言 wheel 会变成真正的鼠标协议输入（`ESC [ < ...`），而不是被 Wave 吃掉
- 本轮验证：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal-real-wheel.ps1 -KillExistingRepoWave`
- 最新结果：
  - `D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260422-114610.json`
  - `D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260422-114631.json`
  - `make\win-unpacked\Wave.exe` 时间：`2026-04-22T11:45:35.2099308+08:00`
  - `make\win-unpacked\Wave.exe` SHA256：`3A535573D27CC7F34D1C12931283AA5B0127229F7901C7A52238796D6A837AF6`
  - `runtime.wheel.allPassed = true`
  - `runtime.ime.allPassed = true`
  - `runtime.wheel.mouseTrackingScenarios[*].mouseSequenceSent = true`
  - `realWheel.allPassed = true`

## 2026-04-22 Architect Re-Intake: TASK-TERM-005 False Positive

- 用户在最新一轮 `$architect-improvement-loop` 中再次明确：**输入法位置又错了、滚轮又没了、输出内容只能看到最新几行**；这直接否定了 `TASK-TERM-005` 当前 `.harness` 中的 `passing` 判定。
- 本轮未继续改终端业务代码，先回到研究与决策阶段，重新核对了三类证据：
  - 本地当前实现：`frontend/app/view/term/termwrap.ts` 与 `frontend/app/view/term/termutil.ts`
  - 官方参考：`@xterm/xterm` 6.0.0 的 `CoreBrowserTerminal.ts` / `Viewport.ts`
  - 上游原始逻辑：`upstream/main` 的 `frontend/app/view/term/termwrap.ts`
- 复盘结论：
  - `upstream/main` 并没有当前这套 `attachCustomWheelEventHandler + capture fallback + imeOwnerBlockId` 组合逻辑，说明问题已不再是“单纯照抄 upstream”就能自动收敛，而是我们这条分支在多轮补丁间互相打架；
  - xterm 官方 wheel 语义本身区分 `normal scrollback`、`alternate buffer fallback`、`mouse protocol`，但当前 smoke 仍主要验证“静态 seed 后是否能滚”，没有覆盖**输出进行中**的真实滚动路径；
  - `scripts/smoke-terminal.runtime.js` 当前只命中 `screen-center` / `screen-right`，并通过 monkey patch 强制 `shouldAnchorImeForAgentTui`，仍不足以证明“中间 Codex pane 真实 DOM 命中区域 + 活动 terminal / IME owner”在持续输出时是正确的；
  - 这也是为什么 smoke 全绿、用户实测仍反复失败：自动化验证路径与真实交互路径没有完全重合。
- 因此本轮把 `TASK-TERM-005` 状态回退为 `failing`，并把下一轮工作从“继续盲改 wheel/IME 逻辑”改为“先补中间 Codex pane 专项诊断闭环，再进入最小修复包”。
- 推荐的最小下一步是新建专项任务包（暂命名 `TASK-TERM-006`，待用户批准后落盘），只做以下事情：
  - 记录中间 Codex pane 在**持续输出期间**的 `elementFromPoint` 命中元素、active terminal、buffer type、mouseTrackingMode；
  - 记录滚轮事件是否落在 `.xterm-viewport` / `.xterm-scrollable-element` 之外的 overlay 或父容器；
  - 记录 IME helper / composition-view 在多 pane + 持续输出期间的 owner 漂移；
  - 用 Electron 实机 + CDP/`agent-browser.cmd` 复现“中间 pane 失败、左右 pane 正常”的真实窗口布局，而不是只看抽象 split-pane。

## 2026-04-22 Architect Approval A: Create TASK-TERM-006

- 用户已明确批准推荐方向 A，本轮继续遵守 `architect-improvement-loop`：**先创建任务包，不直接改业务代码**。
- 已新增 `TASK-TERM-006`，目标从“继续修 wheel/IME”切换为“先补中间 Codex pane 持续输出场景的真实诊断闭环”。
- 本次任务包明确约束：
  - 只允许修改 `scripts/*` 与 `.harness/*`
  - 暂不允许改 `frontend/app/view/term/termwrap.ts` 或 `frontend/app/view/term/termutil.ts`
  - 优先把“滚轮失效、IME 错位、输出只能看到最新几行”拆成可观测的真实链路，而不是继续试错
- `TASK-TERM-006` 的核心验收不是“问题立刻修好”，而是回答以下四个问题：
  - 滚轮在持续输出期间究竟有没有命中当前中间 pane
  - 命中后是被 xterm 吃掉、被 app 吃掉，还是根本没有 scrollback
  - 当前可见滚动区域是不是纯 `xterm`，还是外层还有别的滚动容器
  - IME helper / composition-view 是否在多 pane + 持续输出期间发生 owner 漂移
- 下一步将基于该任务包补脚本与实机诊断，再根据证据拆下一包最小业务修复。

## 2026-04-22 TASK-TERM-006 Partial Diagnostic Result

- 已在不修改 `termwrap.ts` / `termutil.ts` 的前提下补强诊断脚本：
  - `scripts/smoke-terminal.runtime.js` 新增：
    - 中间 pane 目标选择改为按**几何位置**而不是 DOM 顺序；
    - `continuous-middle` 诊断：持续输出期间记录 `elementFromPoint` 命中元素、祖先链、滚动容器、目标/非目标 terminal 的 `viewportY` 变化；
    - `imeOwnershipLive` 诊断：在不 monkey patch `shouldAnchorImeForAgentTui` 的前提下记录 live ownership 快照。
  - `scripts/smoke-terminal-real-wheel.ps1` 新增：
    - `liveRealWheel` 场景，使用 CDP `Input.dispatchMouseEvent(mouseWheel)` 真实滚轮；
    - 诊断指标改为看 `baseY - viewportY` 的“离底部距离”，避免持续输出时因为 `baseY` 同步增长而误判。
- 本轮关键结果：
  - 常规 smoke：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260422-143509.json`
  - 真实滚轮 smoke：`D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260422-143832.json`
  - 两者都基于同一包：`make\win-unpacked\Wave.exe`，时间 `2026-04-22T11:45:35.2099308+08:00`，SHA256 `3A535573D27CC7F34D1C12931283AA5B0127229F7901C7A52238796D6A837AF6`
- 诊断结论收敛为：
  - 在**纯 xterm 的 3-pane normal-buffer 场景**下，中间 pane 的滚轮路由、active terminal 归属、持续输出期间滚动、以及真实鼠标滚轮都正常；
  - `screen-center`、`screen-right`、`view-right`、`scrollbar-center` 都能稳定命中目标 terminal，本轮未复现“中间 pane 自己滚不了”或“滚到别的 pane”；
  - `IME live` 在纯 shell terminal 下只得到 `ime_live_not_applicable`，因为 `shouldAnchorImeForAgentTui=false`，这意味着当前脚本还没有进入**真实 Codex / agent TUI** 的条件分支。
- 因此这轮最重要的判断是：
  - 用户手测中反复出现的问题，不像是“通用 xterm middle pane + 通用实时输出 + 通用真实滚轮”本身有 bug；
  - 更像是**真实 Codex / agent pane 特有状态**导致的问题，可能与：
    - agent TUI 的实际输出/重绘方式
    - `shouldAnchorImeForAgentTui()` 进入条件
    - agent pane 的真实可视滚动区域
    - 或 agent 命令进入后的应用态/协议态
    强相关。
- 下一步建议不再继续改基础 wheel/IME 逻辑，而是补一个更窄的后续任务，只做其中一种：
  - attach 到带真实 Codex pane 的 Wave 实例做只读诊断；或
  - 在 Wave 中拉起真实 agent 命令后再跑同一套 live diagnostic。

## 2026-04-22 TASK-TERM-006 Real Codex Pane Detection

- 已新增 `scripts/smoke-terminal-codex-pane.ps1`，用途是：
  - 直接连接正在运行的 Wave（或由脚本启动）；
  - 选中几何中间 terminal；
  - 向该 terminal 注入真实 `codex` 命令；
  - 等待 `Codex` 可见文本或 `shouldAnchorImeForAgentTui()` 进入激活态；
  - 输出 JSON 供后续诊断复用。
- 最新实测结果：
  - `D:\files\AI_output\waveterm-terminal-smoke\terminal-codex-pane-20260422-145534.json`
- 关键结论：
  - 真实 Codex pane 已稳定命中中间 terminal：`blockId = 46ef4ddb-3453-4166-8ab5-a144bc05e7ae`
  - `shouldAnchorImeForAgentTui()` 在真实 Codex pane 下为 `true`
  - `imeOwnerBlockId` 与命中元素 `hit.blockId` 都对齐到该中间 pane
  - 当前观测到的真实 Codex pane 仍是 `bufferType=normal`、`mouseTrackingMode=none`
- 当前仍未完全解决的部分：
  - 脚本内触发“真实 Codex 自己持续输出很多行”的路径还不稳定；`codex` UI 能起来，但自动发送 prompt 后不一定稳定产出长回答
  - 因此我们已经确认“真实 Codex pane 本身能被命中、IME owner 也能对齐”，但还没有完整覆盖“真实 Codex 长输出过程中”的滚轮/IME 行为
- 这说明下一步应该继续收窄为：
  - 只研究“真实 Codex 长输出如何稳定复现”；不要再回去盲改基础 wheel/IME 逻辑

## 2026-04-22 TASK-TERM-006 Real Codex Long Output + Raw Tail

- 为了稳定复现真实 Codex 长输出，本轮继续增强 `scripts/smoke-terminal-codex-pane.ps1`：
  - 支持直接使用 `codex --no-alt-screen "<prompt>"` 拉起交互态，并带初始 prompt；
  - 新增 `debugterm` 采样，把 terminal blockfile 的原始尾部序列一起写进 JSON。
- 最新关键产物：
  - `D:\files\AI_output\waveterm-terminal-smoke\terminal-codex-pane-20260422-150151.json`
- 这次结果非常关键：
  - 真实 Codex pane 仍然是中间 pane，`shouldAnchorIme=true`，`imeOwnerBlockId` 与命中元素仍然对齐；
  - 使用 `--no-alt-screen` 并给出长 prompt 后，Codex 已真实输出到 100+ 行内容；
  - 但运行态仍显示：
    - `bufferType=normal`
    - `mouseTrackingMode=none`
    - `baseY=0`
    - `viewportY=0`
    - `length=73`
  - 这意味着**可见内容虽然在刷新，但 xterm buffer 没有形成 scrollback**。
- 更关键的是，同一份 JSON 的 `debugTermTail` 已经拿到了原始序列证据：
  - 大量 `ESC[K`（清行）
  - 多次 `ESC[H`（回到左上角/重绘起点）
  - 多次 `?2026h` / `?2026l`（同步重绘事务）
- 这说明当前真实 Codex 路径不是“alternate screen 把历史吞掉”，而是：
  - **normal buffer 下的全屏重绘**
  - 而这种重绘在当前 Wave 路径里没有累积成 scrollback
- 这与用户反馈已经高度吻合：
  - “只能看到最新几行”
  - “滚轮没东西可滚”
  - 不是因为单纯 wheel listener 没命中，而是因为底层 scrollback 根本没长出来
- 当前最接近根因的判断：
  - 问题焦点已经从“wheel/IME 本身坏了”收敛到“Codex 的 full-screen normal-buffer repaint 为什么在 Wave 里不积累 scrollback”
  - 下一步应优先研究：
    - Wave / xterm 对这类 repaint 序列的处理边界
    - 与 Windows Terminal 的差异点
    - 是否需要对特定 repaint 模式做 scrollback 保留策略

## 2026-04-22 TASK-TERM-007 Agent Wheel Fallback

- 在继续动业务代码前，本轮又补了两条关键对照，避免误判：
  - 直接向 Wave 中的 xterm 发送 `CSI 6n` 后，已收到 `ESC[73;1R]`，说明 Codex 不是因为拿不到光标位置才退化；
  - 直接向真实 Codex 发送 `ESC[5~ / ESC[6~` 后，已确认 Codex 会在当前 UI 内部前后翻页，即“无 native scrollback”不等于“应用内完全不能滚”。
- 基于这两条证据，本轮不再尝试伪造 native scrollback，而是做最小修复：
  - `frontend/app/view/term/termutil.ts` 新增 `shouldRouteAgentTuiWheelToInput()`；
  - `frontend/app/view/term/termwrap.ts` 在 `agent TUI + normal buffer + mouseTrackingMode=none + baseY<=0 + length<=rows` 成立时，把 wheel 从 `terminal.scrollLines()` 切换为发送 `PageUp/PageDown` 输入序列；
  - `frontend/app/view/term/termutil.test.ts` 补了对应单测。
- 自动化验证结果：
  - 单测：`npx.cmd vitest run frontend/app/view/term/termutil.test.ts` 通过；
  - 目录包：`npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir` 通过；
  - 实机证据：`D:\files\AI_output\waveterm-terminal-smoke\terminal-codex-wheel-fallback-20260422-153137.json`
- 最新实机结论：
  - 在 fresh `Wave.exe` 中运行真实 `codex --no-alt-screen "List the numbers 1 through 180, one per line, then stop."` 后，运行态仍是 `baseY=0`、`length=73`；
  - 但对 `.xterm-screen` 派发一次 `WheelEvent(deltaY=-720)` 之后，可见内容会从只显示前部少量数字推进到更后面的 `9..76`；
  - 这说明当前 wheel 已不再对着空 scrollback 失效，而是成功驱动了 Codex 的内部分页。
- 当前剩余风险：
  - 这条修复恢复的是 **Codex 内部翻页能力**，不是 Windows Terminal 风格的 native scrollback；
  - 仍需用户在中间 pane、长对话、多轮继续追问的真实场景下做最终手测。

## 2026-04-22 TASK-TERM-007 Current Window / Bubble Fallback / IME Sync Follow-up

- 本轮不再只看独立 smoke，而是直接读取用户当前正在使用的 Wave 实例状态：
  - 已从 `C:\Users\yucohu\AppData\Local\waveterm\Data\db\waveterm.db` 定位到当前窗口 / tab / layout；
  - 已确认当前三栏 block 分别是：
    - 左：`443e542b-9066-4cf0-9ac6-b4225c72b721`
    - 中：`46ef4ddb-3453-4166-8ab5-a144bc05e7ae`
    - 右：`562f58be-e9e5-4940-bef2-71e79359ae63`
  - 已确认当前焦点在中间栏 `46ef...`。
- 为了不关闭用户窗口，本轮新增了一条宿主机诊断链路：
  - 直接读取 Wave 子进程环境块；
  - 成功拿到当前中间 pane 的 `WAVETERM_JWT` / `WAVETERM_BLOCKID`；
  - 再用 `wsh termscrollback` 直接读取用户真实 pane 内容。
- 关键新结论：
  - 当前用户实例里的中间 Codex pane 的 `termscrollback` 只有 `73` 行量级，`baseY=0`，仍然没有 native scrollback；
  - 这与用户“只能看到最新一页、滚不上去”的反馈完全一致；
  - 同时左/中/右三个 pane 的真实底层内容已经可读，不再是“我没看到用户正在操作哪一栏”。
- 基于这条真实实例证据，本轮继续收口了 `termwrap.ts`：
  - 将 connect 容器上的 wheel 兜底从过窄的 capture/mouse-tracking 限制，改为 **bubble fallback**，让整块 terminal 内容区域都能补接 wheel；
  - 为 agent TUI 检测增加 **latched** 状态，并把 `?2026h/l` 全屏重绘事务也作为持续命中信号，避免输出过程中 `isAgentTuiActive()` 闪断；
  - IME 定位不再二次重算光标网格坐标，而是复用 xterm 官方 `_syncTextArea()` 已算好的 `top/left/width/height`，只保留 owner/z-index 覆盖，避免再次把输入法候选框算偏。
- 验证结果：
  - 单测：`npx.cmd vitest run frontend/app/view/term/termutil.test.ts` 通过；
  - 因用户当前正在运行 `make\win-unpacked\Wave.exe`，默认目录包无法覆盖，已改为输出到 `make-smoke\win-unpacked\Wave.exe`，构建通过；
  - 独立数据目录 smoke：`D:\files\AI_output\waveterm-terminal-smoke\terminal-codex-pane-20260422-162244.json`
    - 已再次确认 fresh 实例下 `shouldAnchorIme=true`
    - 命中元素属于目标 Codex pane
    - 运行态仍是 `normal buffer + no native scrollback`
- 当前剩余风险：
  - clean-room CDP 里的“直接启动 Codex 并稳定做 wheel 断言”仍有启动时序波动；
  - 但这不影响当前代码层结论：真实用户窗口已被精确定位，且本轮补丁已经针对“整块区域 wheel 兜底 + agent 判定闪断 + IME 二次算偏”三条根因同时收口。

## 2026-04-22 TASK-TERM-007 Final Package Verification

- 本轮最终定位到一个非常关键的交付问题：**用户平时打开的默认 `make\win-unpacked\Wave.exe` 仍是旧包**。
  - 旧默认包 hash：`ED388EFE47F9487B6DFA8C797FBBEB1BF3D6F5F72AEA46144DD37FFD139299CC`
  - 旧默认包时间：`2026-04-22 16:19:12`
  - 同时 `make-smoke\win-unpacked\Wave.exe` 已是新包，hash 为 `D666DBB20FBF594A506714695ADE04E8FA44464E75FB0D11F8AF64439E0D7FA6`
- 因此本轮没有继续改 `termwrap.ts` 业务逻辑，而是先把交付链路补齐：
  - 重新执行 `npm.cmd run build:prod`
  - 再执行 `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
  - 重打后的默认 `make\win-unpacked\Wave.exe` 已更新为同一新 hash：`D666DBB20FBF594A506714695ADE04E8FA44464E75FB0D11F8AF64439E0D7FA6`
  - `make\win-unpacked\resources\app.asar` 已确认包含 `agentTuiHistoryLines` / `wave-agent-scrollback-overlay` / `extractAgentTuiHistoryLines`
- 随后对**默认 make 包**做了隔离数据目录 smoke，避免污染真实用户窗口：
  - 使用 `WAVETERM_DATA_HOME=D:\files\AI_output\waveterm-terminal-smoke\default-make-data`
  - 使用 `WAVETERM_CONFIG_HOME=D:\files\AI_output\waveterm-terminal-smoke\default-make-config`
  - 在 fresh `make\win-unpacked\Wave.exe` 中经 CDP 创建 terminal block 后，运行真实 `codex --no-alt-screen "List the numbers 1 through 180, one per line, then stop."`
- 默认包实机结论：
  - 运行态仍是用户真实问题对应的 `normal buffer + mouseTrackingMode=none + baseY=0 + viewportY=0 + length=62`
  - 但 `captureAgentTuiHistorySnapshot()` 已在默认包中累计出 `194` 行历史
  - 对 `.xterm-screen` 派发一次 `WheelEvent(deltaY=-960)` 后，overlay 立即出现，`scrollHeight=3492 > clientHeight=1120`
  - overlay 同时包含早期输出（`1..20`）与后期输出（`170..180`），说明“只能看到最新一页”的问题已在默认包中被修复
- 证据文件：
  - `D:\files\AI_output\waveterm-terminal-smoke\terminal-codex-pane-20260422-181146.json`
  - `D:\files\AI_output\waveterm-terminal-smoke\last-default-make-port.txt`
- 最后已直接启动最新默认包供用户手测：
  - `make\win-unpacked\Wave.exe`
  - 当前启动实例 PID：`36624`
- 当前剩余风险：
  - 现方案恢复的是 **Codex 输出历史 overlay + wheel 查看能力**，不是 xterm native scrollback 自身增长；
  - 仍需用户在真实多轮会话里做最终主观体验确认，但“默认包仍是旧版本”这个交付问题已经收口。

## 2026-04-22 Architect Review: Overlay Regression Reframed As New Packet

- 用户最新三张截图把问题进一步收敛清楚了：当前不是“滚轮完全没反应”，而是**滚轮触发后终端被一层 fake history overlay 覆盖**，于是出现：
  - 字体/排版看起来变化；
  - 底部 live terminal 状态条消失；
  - 滚动前看到的是 Codex 原生 live TUI，滚动后看到的是另一套被重新拼出来的纯文本视图。
- 对照当前实现可直接定位到根因：
  - `termwrap.ts` 里存在 `.wave-agent-scrollback-overlay`
  - `captureAgentTuiHistorySnapshot()` 会把 `agentTuiHistoryLines` 累积成文本
  - `renderAgentScrollbackOverlay()` 再用 `overlay.textContent = ...` 重新盖在 terminal 上
- 这解释了为什么技术 smoke 会显示“能看到前面内容”，但用户主观体验仍明确判定为“还是不对”：
  - 当前方案解决的是“看得到更早文本”
  - 但破坏了“仍像一个正常终端那样渲染”的更高优先级体验目标
- 进一步与 upstream 基线比对后也确认：
  - upstream `wavetermdev/waveterm` 并没有 `agentTuiHistoryLines` / `.wave-agent-scrollback-overlay` 这套路径
  - 这部分属于本地修复过程中自己引入的新行为，不是官方原始逻辑
- 结合外部一手资料，本轮 architect 结论如下：
  - OpenAI Codex issue `#14277` 与 xterm.js issue `#5745` 都支持“xterm.js 宿主下无 native scrollback 更像上游能力缺口，而不是宿主一定要自己伪造一份 scrollback”
  - 因此不应继续沿着 fake overlay 路线打磨，而应回到“保留最小 wheel fallback，但不再重绘终端内容”的方向
- 用户已明确批准方向 A：
  - 删除 fake scrollback overlay
  - 恢复官方终端渲染路径
  - 保留最小的 `PageUp/PageDown` wheel fallback
  - 保留已验证有效的 IME 修复
- 基于此，已新建 `TASK-TERM-008`，作为当前唯一推进中的最小闭环。
## 2026-04-22 TASK-TERM-008 收口补记

- 已重新执行 `npm.cmd run build:prod` 与 `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`，默认交付包 `make\win-unpacked\Wave.exe` 已刷新。
- 默认交付包最新 SHA256：`BB7D7277A4F437B373F8B6F6E08B52DFB87BA5C2E2717F94A25F111EB12EC34A`。
- 再次确认当前机器上运行的 `Wave.exe` 都来自仓库路径 `D:\Project\260413\waveterm\make\win-unpacked\Wave.exe`，没有发现其它同名程序混用。
- 复核 `D:\files\AI_output\waveterm-terminal-smoke\task-term-008-native4-probe.json`：
  - `fakeOverlayExists=false`
  - `xtermOverlayExists=false`
  - `before.baseY=63`
  - `after.viewportY=10`
  - `head/historyHead` 连续保留早期输出
- 这说明当前实现已经不再通过 fake overlay 切换渲染，而是在同一个 live xterm 上形成可滚动 scrollback。
- 2026-04-22 22:21 / 22:22 追加 fresh attach smoke：
  - `D:\files\AI_output\waveterm-terminal-smoke\terminal-codex-pane-20260422-222136.json`
  - `D:\files\AI_output\waveterm-terminal-smoke\terminal-codex-pane-20260422-222213.json`
  两次都命中默认 `make\win-unpacked` 新包；这两份结果主要用于确认 fresh 包与 pane 命中，深度滚轮结论仍以前述 `task-term-008-native4-probe.json` 为准。
- 当前剩余风险不再是 fake overlay / 错误渲染切换，而是 Codex 上游 full-screen repaint 的时序波动：不同 prompt 与返回速度下，自动化不一定总能在固定超时内等到精确尾行，但这不等于 wheel / IME 回归。
## 2026-04-23 TASK-TERM-008 续修：前移 transcript 捕获起点

- 根据用户 2026-04-23 最新截图，确认当前残留问题不再是 fake overlay，而是 **scrollback 已可滚但最前面几段输出仍会被吞掉**。
- 根因继续收口到 `frontend/app/view/term/termwrap.ts`：此前 transcript 捕获依赖 `isAgentTuiActive()`，实际会晚于某些 Codex 首批 repaint；如果首批长输出先把旧行顶出当前窗口，再开始 capture，就会造成“滚得动，但最前几行/几段没有了”。
- 本轮修复：
  - 新增 `agentTuiTranscriptArmed`，把 transcript 捕获与 IME/agent 可见态解耦；
  - 在收到写入数据时，若已识别到 agent 命令且 shell 尚未回到 `ready`，或首批数据本身已带 `OpenAI Codex` / `?2026h/l` 信号，则提前 arm transcript capture；
  - `isAgentTuiActive()` 进入运行态时不再二次清空已提前建立的 transcript；
  - shell prompt 回来后同步 disarm，避免旧 session history 污染下一条普通命令。
- 本轮验证：
  - `npx.cmd vitest run frontend/app/view/term/termutil.test.ts`：22 passed
  - `npm.cmd run build:prod`：通过
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`：通过
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`：通过
- 备注：用于长中文输出场景的 page-level CDP 深挖脚本今天在本机上出现了单独的 websocket 连接异常，暂未形成新的结构化 probe JSON；但这不影响代码修复、默认包重打与仓库标准验证闭环。
## 2026-04-23 TASK-TERM-008 续修：保留空行与 prompt 上下文，并刷新默认包

- 根据用户“滚动几次后又会吞掉内容”的最新反馈，继续把根因收口到 transcript overlap 对重复代码块 / 空段落的误判：此前 `extractAgentTuiHistoryLines()` 过滤过猛，会删除内部空行与用户 prompt 上下文，导致相邻 snapshot 在重复行场景下更容易错误对齐，从而把中间段吞掉。
- 本轮修复：
  - `frontend/app/view/term/termutil.ts` 的 `extractAgentTuiHistoryLines()` 改为保留内部空行与用户 prompt 上下文，仅继续过滤 shell banner、明显瞬态 footer / status；
  - `frontend/app/view/term/termutil.test.ts` 补充对应断言，覆盖“保留 prompt context”与“保留内部空行”；
  - 重新重打默认交付包 `make\win-unpacked\Wave.exe`，并重新启动仓库内最新包，避免用户误开旧进程。
- 本轮验证：
  - `npx.cmd vitest run frontend/app/view/term/termutil.test.ts`：23 passed
  - `npm.cmd run build:prod`：通过
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`：通过
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`：通过
  - 默认交付包最新 SHA256：`EF535A17FED74786A876B1A2FFBE4A02CCA6F174FE6BC6AAB4DE9F034C250197`
  - 当前机器上运行的 `Wave.exe` 全部来自 `D:\Project\260413\waveterm\make\win-unpacked\Wave.exe`
- 剩余风险：
  - 自动化仍缺一个“长中文 / 长代码块滚多次后不吞段”的稳定结构化 probe；
  - 如果用户还可复现，下一刀只允许继续收口 transcript snapshot 的对齐与注入顺序，不回退到 overlay / fake history 路线。
## 2026-04-23 TASK-TERM-008 续修：修复滚动历史重复与乱序

- 根据用户新截图，当前问题从“吞掉内容”进一步定位为 **滚动历史中出现重复段、乱序段和插入段错位**，典型表现是同一个标题、同一句“但注意”、同一段估算过程在 scrollback 中连续出现多次。
- 根因判断：
  - 旧的 native scrollback injection 会把 `terminal.buffer.active` 的完整 buffer 当作下一轮 transcript 输入；
  - 这会把前一轮已经注入到 xterm scrollback 的合成历史再次当成真实 Codex 输出；
  - 再叠加 `agentTuiInjectedLineCount` 按“history 总长度 - 当前快照长度”推算待注入区间，在重复标题 / 空行 / 短段落场景下会产生重复和乱序。
- 本轮修复：
  - `frontend/app/view/term/termwrap.ts` 不再从完整 buffer 捕获 transcript，改为只捕获当前屏幕区间：`baseY..baseY+rows`；
  - hidden preview seed 同样只使用当前屏幕，不再把已注入 scrollback 喂回 preview；
  - 删除 `agentTuiInjectedLineCount` 路径，不再按累计长度推断待注入内容；
  - 新增 `appendDroppedPrefixLines()`，只在相邻两帧能明确重叠时，把“上一帧顶部确实滑出的行”加入待注入队列；
  - 对无法确认重叠的 repaint 窗口选择不注入，优先避免乱序/重复；
  - agent TUI 活跃时拦截 `CSI 3J` 清 scrollback，但保留 repaint transaction 标记，避免 Codex 清掉刚补进同一 live xterm 的真实 scrollback。
- 本轮验证：
  - `npx.cmd vitest run frontend/app/view/term/termutil.test.ts`：26 passed
  - `npm.cmd run build:prod`：通过
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`：通过
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`：通过
  - `git diff --check`：通过
  - 默认交付包最新 SHA256：`44B3656C610735F8CF34F69B0CD605315856F8EBE4F6AA29E72CB81966BD9B86`
  - `scripts\smoke-terminal-codex-pane.ps1` 已用默认 `make\win-unpacked\Wave.exe` 启动最新包并命中 Codex pane，结果文件：`D:\files\AI_output\waveterm-terminal-smoke\terminal-codex-pane-20260423-153157.json`
- 当前交付判断：
  - 这次修复优先解决用户截图中的“乱斗”根因：不再让注入历史反复喂回 transcript；
  - 若用户继续复现缺段，下一轮只允许针对“无重叠窗口如何安全补缺”做更保守的补齐，不允许恢复 overlay / fake history 或按长度猜测注入。
## 2026-04-23 TASK-TERM-008 续修：输出中手动滚动不再改写历史顶部

- 根据用户最新反馈，剩余问题发生在 **Codex 持续输出过程中，用户一旦开始滚动查看历史，后续 repaint / 写入会把当时的滚动位置当成新的历史基准**，从而表现为“滚动中的那个位置变成最顶部，继续输出后有内容被吞掉”。
- 根因收口：
  - 旧逻辑在 `?2026l` repaint transaction 结束时会无条件 `scrollToBottom()`；
  - 同时 transcript augmentation 写入期间没有显式保护用户当前 `viewportY`；
  - 所以当用户正在看历史时，后续输出既可能把视口拉回底部，也可能让写入后的 viewport 变化参与后续基准判断。
- 本轮修复：
  - `frontend/app/view/term/termwrap.ts` 新增 `agentTuiUserScrollLock`；
  - wheel 路径与 `terminal.onScroll()` 双重更新这把锁：只要 agent TUI 输出期间用户离开底部，就进入“用户正在查看历史”状态；
  - repaint transaction 完成时，若用户仍处于历史查看状态，则不再 `scrollToBottom()`；
  - `doTerminalWrite()` 在写入前记录当前 `viewportY`，写入后若用户处于历史查看状态，则把 viewport 恢复到原位置，而不是让写入过程改变它；
  - prompt 返回、truncate 或 transcript state reset 时同步清理这把锁。
- 本轮验证：
  - `npx.cmd vitest run frontend/app/view/term/termutil.test.ts`：26 passed
  - `npm.cmd run build:prod`：通过
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`：通过
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`：通过
  - 默认交付包最新 SHA256：`07A09E1CC845C107660110747F382922B83C506194D3ED6CCEC245C0ADAF4755`
- 当前状态：
  - 最新普通包已重新启动，当前机器运行中的 `Wave.exe` 均来自 `D:\Project\260413\waveterm\make\win-unpacked\Wave.exe`；
  - 请用户重点复测“输出还在继续时就开始滚轮往上翻”的场景，确认不再出现“滚到的位置被当成新顶部并吞历史”的问题。
## 2026-04-23 TASK-TERM-008 续修：恢复滚动响应，避免旧写入覆盖新滚动

- 根据用户最新截图，“输出中手动滚动保护”引入了一个新副作用：写入队列中的旧写入会在完成时恢复它开始前记录的 `viewportY`，如果用户在这次写入过程中继续滚动，旧写入会把用户刚滚到的新位置拉回去，于是表现为“滚动不了了”。
- 另一个同步发现的问题：当 native scrollback 尚未长出时，当前 wheel 路径会调用 `terminal.scrollLines()` 并消费事件，但 scrollback 为 0 时实际不会移动，也不会再把 PageUp/PageDown 交给 Codex。
- 本轮修复：
  - 新增 `agentTuiUserScrollVersion`，用户每次 wheel 滚动都会递增版本；
  - `doTerminalWrite()` 只有在写入期间用户没有再次滚动时，才允许恢复旧 `viewportY`；
  - 如果写入期间用户继续滚动，则旧写入不再覆盖新位置；
  - 新增 `shouldRouteAgentTuiWheelToInput()`：仅在 agent TUI active 且 `baseY<=0 / length<=rows+1` 的无 native scrollback 状态下，把 wheel 重新转成 `ESC[5~` / `ESC[6~` 发送给 Codex，避免 wheel 被宿主吞掉。
- 本轮验证：
  - `npx.cmd vitest run frontend/app/view/term/termutil.test.ts`：26 passed
  - `npm.cmd run build:prod`：通过
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`：通过
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`：通过
  - 默认交付包最新 SHA256：`35844E7E33D0D9FC5EA7F2D9F87B1B2A873A1F4144C8483B5EDB74D4C6F7D923`
- 当前状态：
  - 已关闭旧进程并启动最新默认包；
  - 这轮重点验证“持续输出时连续滚轮仍能移动”，以及“还没生成 native scrollback 时也能走 Codex 内部 PageUp/PageDown”。

## 2026-04-23 17:43 TASK-TERM-008 续修：恢复持续输出期间 native scrollback

- 根因：Codex 持续 repaint 输出时，隐藏 preview terminal 原先 scrollback: 0，首个大块输出把早期行在 preview 里也丢掉，导致 live xterm aseY 长时间为 0，滚轮无处可滚。
- 修复：rontend/app/view/term/termwrap.ts 将 agent preview terminal 改为保留 MaxTermScrollback，并从 preview buffer 的真实 scrollback prefix 生成待注入行；同时把 wheel 兜底从 capture 阶段收回到 bubble 阶段，避免抢占浏览器真实滚轮路径。
- 验证：
px.cmd vitest run frontend/app/view/term/termutil.test.ts 26 passed；
pm.cmd run build:prod 通过；electron-builder --win dir 通过；scripts\verify.ps1 通过；git diff --check 通过。
- 运行态证据：D:\files\AI_output\waveterm-terminal-smoke\terminal-codex-pane-20260423-173615.json 对应场景中 aseY=120、historyLen=120，DOM wheel 后 iewportY=120 -> 80。
- 默认交付包：make\win-unpacked\Wave.exe SHA256 $hash。

## 2026-04-23 19:05 TASK-TERM-008 续修：收紧 Codex transcript 过滤并重做滚轮验证

- 继续针对用户“第一轮正常、第二轮又乱了”的反馈回溯根因，确认当前 residual case 不只是 clear-scrollback，而是 **Codex repaint snapshot 中混入了 chrome / working 状态 / 默认建议词，导致 transcript merge 在跨轮或长输出后半段发生自污染**。
- 这轮修复点：
  - 	ermwrap.ts 不再把 live terminal 当前屏内容 seed 到 hidden preview，避免 PowerShell banner、旧 prompt 和已注入内容再次回流到 preview 基准；
  - 	ermutil.ts 新增
econcileAgentTuiSnapshotHistory() 的“历史前缀锚点”路径，用可见窗口前缀在既有 transcript 中定位，而不是在无重叠时盲目整屏拼接；
  - extractAgentTuiHistoryLines() 进一步过滤 Codex chrome、update banner、working 状态、默认 suggestion、shell/codex 启动命令与空白噪声，只保留用户 prompt + 实际回答行；
  - scripts/smoke-terminal-codex-pane.ps1 新增 wheel 断言与第二轮 CDP 输入探针，方便持续观察同一 Codex 会话内的跨轮状态。
- 当前运行态结果：
  - 	erminal-codex-pane-20260423-190056.json：aseY=24、historyLength=81，history tail 连续覆盖 FIRST_ROUND_LINE_021..080，wheel 后 iewportY: 24 -> 0；
  - 	erminal-codex-pane-20260423-185930.json：50 行输出时 aseY=0，无 native scrollback 属预期，history 中仅保留 prompt +  01..050，不再爆涨到数千行；
  - 默认交付包 make\win-unpacked\Wave.exe 最新 SHA256：1CE9850EB1EB8D2665FC8C5A8E68619F42FED9D01DA6604305BF0D72D4512CB9。
- 剩余风险：Codex TUI 的“第二轮 prompt 提交”在当前 CDP 自动化路径下仍然只稳定做到**文本进入输入框**，未稳定触发第二轮真实回答；因此跨轮验证目前仍需用户在最新包上做一次手工 smoke 确认，但代码层已去掉会污染第二轮 transcript 的主要噪声来源。
## 2026-04-23 19:26 TASK-TERM-008 续修：收紧误捕获并过滤默认建议词

- 新根因 1：PowerShell/PSReadLine 在命令行编辑 `codex --...` 时，旧逻辑仅因尾部文本包含 `codex` 就提前 arm transcript，导致输入过程被误当成 Codex TUI repaint。
- 新根因 2：Codex 默认 suggestion `Explain this codebase` 未被过滤，会在 repaint 合并时反复进入 transcript，造成用户看到的“乱斗 / 重复 / 吞行”。
- 本轮修复：
  - `termutil.ts` 新增纯函数 `shouldPrimeAgentTuiTranscriptCapture()`，只在 `running-command + agent 命令` 或强 UI marker（如 `OpenAI Codex`、`?2026h/l`）出现时才启动 transcript；
  - `termwrap.ts` 改为复用该纯函数，并把 `isAgentTuiActive()` 的 marker 判断收紧为强 marker，避免普通命令行输入被误判；
  - `extractAgentTuiHistoryLines()` 增加对 `Explain this codebase` / `› Explain this codebase` 的过滤，阻止默认建议词污染历史。
- 本轮验证：
  - `npx.cmd vitest run frontend/app/view/term/termutil.test.ts`：34 passed；
  - `npm.cmd run build:prod`：通过；
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`：通过；
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`：通过（本轮代码后至少已有 build/prod + 打包 + smoke 重新验证）；
  - 运行态 smoke：`D:\files\AI_output\waveterm-terminal-smoke\terminal-codex-pane-20260423-192604.json`，`baseY=24`、`agentTuiHistoryLength=81`、wheel `viewportY=24 -> 0`。
- 默认交付包：`make\win-unpacked\Wave.exe` SHA256=`A7BCEFA722BEED0C0682A8AAAB685967B478212466AE4C79EAC4FC704CE80E3E`。