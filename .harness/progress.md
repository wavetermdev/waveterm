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
