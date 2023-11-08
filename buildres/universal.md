## MacOS Universal Build Notes

This doesn't work out of the box and doesn't seem to be well documented anywhere.
The basic idea is that we have to create separate x64 and a arm64 builds and
then link them together using @electron/universal.  Seems easy, but in
practice it isn't.

(1) The separate x64 and arm64 builds *cannot* be signed (osx-sign).  This
makes sense because once we lipo the executables together they need to be
resigned (their SHA sums will change).  If you accidentally sign them
@electron/universal will also refuse to work.

(2) We already deal with architecture specific builds with Go for wavesrv and
waveshell.  This upsets @electron/universal as well since these are *binaries*
and we don't want to lipo them together.

(3) Small differences in waveterm.js.  The non-executable files must be
*identical*.  Well, that's a problem when we inject build times into the files.
Other small differences can also happen (like different go toolchains, etc.).

(4) ASAR builds.  By default if there are differences in the "app" folder
@electron/universal plays some neat tricks to separate out the x64 from the
arm64 code using a app.asar stub.  That's great for standard electron builds
where the entrypoint is hardcoded to index.js.  Ours isn't so this doesn't work.

(5) ASAR builds and unpacked files.  I don't know all the details here, but
for Wave to work we have to have some files unpacked (not in ASAR format).
The reason is that we execute them directly (e.g. wavesrv and waveshell), they
aren't just loaded by electron.

(6) Ignoring and skipping files in @electron/universal is hard because
it just takes one minimatch pattern.

---

## Solution

1. Create unsigned builds on x64 and arm64
2. Move the builds to the core build machine and *extract* their "app" directories.
In theory because we aren't using any native node modules they function the same in
both environments.
3. Run @electron/universal on the two unsigned builds (without their app directories).
4. lipo wavesrv from x64 and arm64 manually to create a universal wavesrv binary.
5. Copy our extracted "app" directory (with the newly created universal "wavesrv")
back into the universal Wave.app created by @electron/universal.
6. Manually run osx-sign to sign the new universal build (make sure to
pass the wavesrv and waveshell programs as extra binaries).
7. Manually create the new universal dmg (using create-dmg).


