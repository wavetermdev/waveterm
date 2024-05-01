```yml
commands:
  - command: focus-application
    name: Wave
    comment: "Focus the Wave application to ensure it is the active window before attempting to click the plus icon."
queries:
  - query: view
    comment: "View the current state of the desktop to confirm that Wave is the active window."
```

```yml
commands:
  - command: click
    x: 366
    y: 217
    button: left
    click: single
    comment: "Click on the plus icon to add a new workspace in the Wave application."
```