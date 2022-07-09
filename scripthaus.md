# SH2 Commands

```bash
# @scripthaus command webpack-watch
# @scripthaus cd :playbook
node_modules/.bin/webpack --watch --config webpack.dev.js
```

```bash
# @scripthaus command webpack-electron-watch
# @scripthaus cd :playbook
node_modules/.bin/webpack --watch --config webpack.electron.js
```

```bash
# @scripthaus command electron-rebuild
# @scripthaus cd :playbook
node_modules/.bin/electron-rebuild
```

```bash
# @scripthaus command electron
# @scripthaus cd :playbook
node_modules/.bin/electron dist/emain-dev.js
```

```bash
# @scripthaus command devserver
# @scripthaus cd :playbook
node_modules/.bin/webpack-dev-server --config webpack.dev.js --host 0.0.0.0
```

```bash
# @scripthaus command typecheck
# @scripthaus cd :playbook
node_modules/.bin/tsc --jsx preserve --noEmit --esModuleInterop --target ES5 --experimentalDecorators --downlevelIteration src/sh2.ts
```
