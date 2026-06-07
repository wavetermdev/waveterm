## 1. Backend — Error state on command failure

- [x] 1.1 In `pkg/blockcontroller/shellcontroller.go`, after the wait loop gets `exitCode`, check if block has `cmd` meta set and exitCode != 0, then write `{"cmd:lasterror": "exit code N"}` to block meta
- [x] 1.2 If exitCode == 0 and block has `cmd` meta set, clear `cmd:lasterror` from meta
- [x] 1.3 Add `MetaKey_CmdLastError` constant in `pkg/waveobj/metaconsts.go`

## 2. Frontend — Command Config Modal component

- [x] 2.1 Create `frontend/app/view/term/CommandConfigModal.tsx` with form fields: Command (textarea), Run on startup (checkbox), Clear output on start (checkbox), Environment Variables (textarea)
- [x] 2.2 Populate form initial values from block meta (`cmd`, `cmd:runonstart`, `cmd:clearonstart`, `cmd:env`)
- [x] 2.3 Implement env vars validation: parse `KEY=VALUE` per line, ignore blank/comment lines, show inline error for invalid lines
- [x] 2.4 Add Cancel button that closes dialog via `ModalsModel.popModal()`
- [x] 2.5 Register `CommandConfigModal` in `frontend/app/modals/modalregistry.tsx`
- [x] 2.6 Create `frontend/app/view/term/CommandConfigModal.scss` for dialog styling

## 3. Frontend — Menu integration

- [x] 3.1 In `frontend/app/view/term/term-model.ts`, replace "Run On Startup" submenu with a single "Configure Command..." menu item in `getSettingsMenuItems()`
- [x] 3.2 "Configure Command..." click handler calls `ModalsModel.pushModal("CommandConfigModal", { blockId })`

## 4. Frontend — Save & Restart flow

- [x] 4.1 In `CommandConfigModal.tsx`, add "Save & Restart" button that collects form values
- [x] 4.2 Build meta map: `{ cmd, cmd:runonstart, cmd:clearonstart, cmd:env }` from form fields
- [x] 4.3 Call `RpcApi.SetMetaCommand()` to write meta (include clearing `cmd:lasterror`)
- [x] 4.4 Call `RpcApi.ControllerDestroyCommand()` then `RpcApi.ControllerResyncCommand({ forcerestart: true })`
- [x] 4.5 Disable Save & Restart button during the restart sequence
- [x] 4.6 Handle empty command field: write empty/null to clear `cmd` meta (revert to interactive shell)

## 5. Frontend — Error state display

- [x] 5.1 In block header component, detect `blockData?.meta?.["cmd:lasterror"]` non-empty
- [x] 5.2 When error present, render header status icon in red/warning color
- [x] 5.3 Add tooltip on hover showing error message string

## 6. Build & Verify

- [x] 6.1 Run `npm run build:prod` — frontend build passes (no TS errors)
- [x] 6.2 Run `task package` — MSI installer builds successfully
- [ ] 6.3 Manual verification: open a term block, configure a command that fails, verify red header, edit and save, verify restart and normal header
