# Hands-on Mac check


Allow about 10–15 minutes for the checks, plus downloading and setup. This checks whether browser buttons and typing stay responsive in the newly built copy.


**Not yet performed:** these hands-on checks on the new Mac packages. Earlier automated checks passed: 49 focused tests and checks of all 19 downloadable packages. The earlier development copy was also confirmed fixed on the reporting Mac; that does not replace testing this new copy.


Use the November 9 test build linked below. Its [automated build completed successfully for all platforms](https://github.com/cjosewski/waveterm/actions/runs/42633567395). Submission to the main Wave Terminal project remains on hold until the hands-on results are reviewed.


## 1. Open the correct test copy — about 2 minutes


1. Open Apple menu → About This Mac. If it shows Chip with an Apple name, choose the Apple-chip download. If it shows Processor with Intel, choose Intel. Apple’s identification guide.
2. Download the Mac build bundle; sign-in may be required. Unpack that bundle, then choose the inner ZIP marked arm64 for a Mac with an Apple chip or x64 for a Mac with an Intel processor. If the download is no longer available, mark setup Blocked and request a current test copy.
3. Save your work and Quit Wave completely. Closing its window is not enough. Keep your installed copy. Unpack the chosen ZIP inside a new folder for this check; do not replace the installed app.
4. Open the Wave app inside that new folder directly in Finder. Do not use the Dock or search to launch it. Both old and new copies may show 0.14.5, so the version number alone does not identify this test copy.
5. This separate app copy still uses your existing Wave settings, history, and saved work. Use a new, throwaway tab for the checks. Do not delete saved data or change your usual settings.
6. If Wave offers an update, postpone it until after this check so you keep testing the supplied copy.


These test builds have not been approved through Apple’s distribution checks. If Apple says it cannot verify the developer or check the app, and this is the supplied test copy you intended to open: first attempt to open it, then use **System Settings → Privacy & Security → Open Anyway**, and confirm **Open**. Follow [Apple’s app-specific instructions](https://support.apple.com/en-us/102445). If the warning says the app is damaged or will harm your computer, or there is no app-specific option, **stop and report the exact message**. Do not turn off security protections.


## 2. Set up a throwaway tab — about 1 minute


1. Choose New Tab, or press Command+T.
2. In the side list, click the globe entry labeled web twice to create two browser panes. Call them A and B for this check. Add a terminal pane—the panel where you type commands—or reuse the new tab’s terminal if it already has one.
3. In each browser pane, use its address bar to visit example.com, then example.org, waiting for each page to load. This gives both panes a working Back and Forward history. A disabled arrow with no history is normal.
4. Bring Wave to the front by clicking an empty part of its top bar, away from buttons.


**What counts as a missed click:** while Wave is already at the front, click inside a web page, then click a browser control once. That action should work without a second click. The first click when returning from a different Mac app may only bring Wave forward; do not count that normal activation click as the browser defect.


## 3. Check the first toolbar click — about 3 minutes


Do **five Back/Forward pairs in A, then five in B**. Keep Wave at the front throughout. Finish all of these pairs before the address-bar checks below.


1. Click inside the page, away from links. Move straight to the left-pointing Back arrow and click once. The address should change to example.com.
2. After it loads, click inside the page again, then click the right-pointing Forward arrow once. It should return to example.org.


Use single clicks; record a miss before trying again. Do not click some other part of the toolbar first. This gives **20 measured Back/Forward actions**.


**After all 20 actions**, check the address bar **five times in A, then five times in B**: click inside the page, then click the address bar once. Press **Command+A**, type **example.org**, and press Return. Typing must stay in that address bar until you press Return. Keeping these ten submissions after the navigation checks prevents them from changing the history being tested.


In each pane, also click the page and then click the **circular Reload arrow** once. The page should reload and remain usable. If loading is too fast to tell, mark that item **Not checked** and explain why.


**Pass:** every measured first click works, no delayed action surprises you, and typing does not disappear or land in the other pane.


## 4. Switch panes and keep typing — about 2 minutes


Alternate between A and B for **ten switches**:


1. Click inside the other pane’s page, then click its address bar once.
2. Press Command+A and type example. Wait one second, then type .org. Check that the complete address stays in that same field, then press Return.
3. Watch the other pane: it should not take over your typing or repeatedly become selected by itself.


After the mouse checks, **click inside A’s page**, then press **Command+L**. Repeat by **clicking inside B’s page** before pressing Command+L. Each shortcut should select that pane’s address bar and allow typing. Record any earlier missed mouse click even if this keyboard shortcut works.


**Pass:** the pane you chose keeps your typing; both panes remain responsive through all ten switches.


## 5. Enlarge, restore, and return to the tab — about 2 minutes


Complete **five enlarge/restore rounds in total**: four quick rounds with the controls, then one round that also checks returning to the tab.


1. For each of rounds 1–4, click inside A’s page, then use its header control labeled Magnify when you pause the pointer over it. The pane should enlarge; the surrounding area may dim or blur.
2. Use the same pane’s control, now labeled Minimize, to restore it, as quickly as is comfortable. After each round, wait one second, then click B’s address bar and type an address. Count the first enlarge/restore pair as round 1.
3. For round 5, enlarge A. Create another throwaway tab with Command+T, then click the original test tab in the tab list to return.
4. A should still be enlarged. Click once in the dimmed area outside A to restore the normal layout, completing round 5. Check B’s address bar again.


**Pass:** each pane enlarges and restores as expected. After restoring, no dim or invisible layer remains that prevents clicks. Returning to the tab does not dismiss the wrong pane or leave controls blocked.


## 6. Return from another app, then close one test pane — about 2 minutes


1. Switch to Finder. Return by clicking an empty part of Wave’s top bar, away from buttons. Then click A’s page and its address bar, and type an address. Repeat three times. The toolbar click being tested is the one after Wave is already in front.
2. Enlarge B, then close only B using the X in B’s own pane header. Do not close the tab or app window. A and the terminal should remain.
3. In A, click the page, then the address bar, and type again. Closing B should not be necessary to make A work; A should already have worked in the earlier checks.
4. Click the terminal, type a few harmless letters such as check, and remove them with Backspace. Do not press Return. Repeat after clicking A and returning to the terminal.


**Pass:** returning from another app does not make controls stay unresponsive; closing B leaves no blocking layer; letters appear only in the pane you selected.


## If anything fails


Stop repeating the failed action once you have a clear example. Record the section, the last few clicks, whether Wave was already in front, and whether a second click or Command+L worked. A short recording is useful, but keep private pages and information out of it.


If the app will not open, the needed controls are missing, or the example pages cannot load, mark the test **blocked**, not passed or failed. If Wave stops responding, stop the check and report what happened; do not delete its settings or saved data.


An optional comparison with your usual installed copy can help: fully quit this test copy first, open the installed one directly, and repeat just the first-click sequence. Keep those results separate. Do not run both copies together. This comparison is not required to complete the checklist.


## Send back these results


Use **Pass**, **Fail**, **Blocked**, or **Not checked**. Mark each item **Not checked** until you perform it; do not treat an uncertain observation as a pass.


| Check | Result / count |
| --- | --- |
| Mac type and macOS version | Mac Studio Pro  27.0.1 |
| Test date; opened the newly unpacked copy directly | 11/9/26 |
| Back/Forward first-click actions | __20_ / 20 worked |
| Address-bar clicks and typing | Green |
| Reload in both panes | Green |
| Switching panes | ___10 / 10 worked |
| Command+L in both panes | Green |
| Enlarge/restore rounds | __5_ / 5 worked |
| Enlarged pane after leaving and returning to its tab | Green |
| Returning from Finder | _3__ / 3 worked |
| Closing only B; A and terminal still work | Green |
| Any missed click, lost typing, leftover dimming, or freeze | None. |



If something failed: **What did you click immediately before it? Was Wave already in front? Did a second click or Command+L help?**


Optional Windows/Linux spot check: in a throwaway tab, repeat the mouse-only parts of sections 3–5 and the harmless terminal typing check using the matching new build. These do not replace the Mac checks; record them separately.


